import { createId } from '../core/id';
import type { BackupFile } from '../core/validation';
import type { Theme } from '../state/store';
import {
  getVsCodeApi,
  isVsCodeWebview,
  subscribeHostMessages,
} from './vscodeBridge';

/**
 * Sharer-side bridge to the VS Code extension host. The host runs the actual
 * LAN server; the webview only sends snapshots and receives the share link.
 */

export interface ShareHandle {
  shareId: string;
  url: string;
  password: string;
  expiresAt: string;
  projectName: string;
}

/** Injected by the extension's share server into the guest viewer page. */
export interface ShareBootstrap {
  shareId: string;
  apiBase: string;
  theme: Theme;
  expiresAt: string;
}

declare global {
  interface Window {
    __FLOW_SHARE__?: ShareBootstrap;
  }
}

export type ShareEvent =
  | { kind: 'ended'; shareId: string; reason: string }
  | { kind: 'error'; shareId: string; message: string };

interface PendingRequest {
  resolve: (share: ShareHandle | null) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 8000;
const pending = new Map<string, PendingRequest>();
const eventHandlers = new Set<(event: ShareEvent) => void>();
let listening = false;

function normalizeShare(raw: unknown): ShareHandle | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const fields = ['shareId', 'url', 'password', 'expiresAt', 'projectName'] as const;
  for (const field of fields) {
    if (typeof record[field] !== 'string') return null;
  }
  return {
    shareId: record.shareId as string,
    url: record.url as string,
    password: record.password as string,
    expiresAt: record.expiresAt as string,
    projectName: record.projectName as string,
  };
}

function ensureListener(): void {
  if (listening) return;
  listening = true;

  subscribeHostMessages((data) => {
    if (data.type === 'flow:shareStatus') {
      const requestId = typeof data.requestId === 'string' ? data.requestId : '';
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      clearTimeout(entry.timer);
      if (data.ok === true) {
        entry.resolve(normalizeShare(data.share));
      } else {
        entry.reject(
          new Error(
            typeof data.error === 'string' ? data.error : 'Sharing failed.',
          ),
        );
      }
      return;
    }

    if (data.type === 'flow:shareEnded' && typeof data.shareId === 'string') {
      const reason =
        typeof data.reason === 'string' ? data.reason : 'Sharing ended.';
      for (const handler of eventHandlers) {
        handler({ kind: 'ended', shareId: data.shareId, reason });
      }
      return;
    }

    if (data.type === 'flow:shareError' && typeof data.shareId === 'string') {
      const message =
        typeof data.error === 'string' ? data.error : 'Could not update the share.';
      for (const handler of eventHandlers) {
        handler({ kind: 'error', shareId: data.shareId, message });
      }
    }
  });
}

function request(
  message: Record<string, unknown>,
): Promise<ShareHandle | null> {
  const api = getVsCodeApi();
  if (!api) {
    return Promise.reject(
      new Error('LAN sharing is available in the Flow VS Code extension.'),
    );
  }
  ensureListener();
  const requestId = createId('share');
  return new Promise<ShareHandle | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('The extension host did not answer the share request.'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
    api.postMessage({ ...message, requestId });
  });
}

export function isShareSupported(): boolean {
  return isVsCodeWebview();
}

export async function startShare(input: {
  snapshot: BackupFile;
  password?: string;
  theme: Theme;
}): Promise<ShareHandle> {
  const share = await request({
    type: 'flow:shareStart',
    snapshot: input.snapshot,
    password: input.password ?? null,
    theme: input.theme,
  });
  if (!share) throw new Error('The extension host returned an invalid share.');
  return share;
}

export async function stopShare(shareId: string): Promise<void> {
  await request({ type: 'flow:shareStop', shareId });
}

export function updateShare(shareId: string, snapshot: BackupFile): void {
  const api = getVsCodeApi();
  if (!api) return;
  api.postMessage({ type: 'flow:shareUpdate', shareId, snapshot });
}

/** Clears shares left behind by a previous webview document. */
export function notifyAppReady(): void {
  getVsCodeApi()?.postMessage({ type: 'flow:appReady' });
}

export async function copyText(text: string): Promise<void> {
  const api = getVsCodeApi();
  if (api) {
    api.postMessage({ type: 'flow:copyText', text });
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* Clipboard access was denied; the value stays selectable in the dialog. */
  }
}

export function onShareEvent(handler: (event: ShareEvent) => void): () => void {
  ensureListener();
  eventHandlers.add(handler);
  return () => eventHandlers.delete(handler);
}

/* ------------------------------------------------------------ guest viewer */

export interface ShareSnapshotResponse {
  backup: BackupFile;
  updatedAt: string;
  expiresAt: string;
}

export type ShareFetchResult =
  | { kind: 'ok'; data: ShareSnapshotResponse; etag: string | null }
  | { kind: 'unchanged' }
  | { kind: 'wrong-password' }
  | { kind: 'ended'; message: string }
  | { kind: 'rate-limited'; message: string }
  | { kind: 'error'; message: string };

export async function fetchShareSnapshot(
  apiBase: string,
  password: string,
  etag: string | null,
): Promise<ShareFetchResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/snapshot`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'X-Flow-Share-Key': password,
        ...(etag ? { 'If-None-Match': etag } : {}),
      },
    });
  } catch {
    return {
      kind: 'error',
      message: 'Could not reach the computer sharing this board. Check that you are on the same network.',
    };
  }

  if (response.status === 304) return { kind: 'unchanged' };
  if (response.status === 401) {
    return { kind: 'wrong-password' };
  }
  if (response.status === 404 || response.status === 410) {
    return { kind: 'ended', message: 'This share has ended.' };
  }
  if (response.status === 429) {
    return {
      kind: 'rate-limited',
      message: 'Too many attempts. Wait a minute and try again.',
    };
  }
  if (!response.ok) {
    return { kind: 'error', message: `The shared board could not be loaded (${response.status}).` };
  }

  try {
    const data = (await response.json()) as ShareSnapshotResponse;
    return {
      kind: 'ok',
      data,
      etag: response.headers.get('ETag'),
    };
  } catch {
    return { kind: 'error', message: 'The shared board returned unreadable data.' };
  }
}
