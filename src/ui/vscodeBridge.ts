import {
  NODE_TYPES,
  ROOT_REF,
  type FlowNode,
  type Project,
} from '../core/types';
import { buildBackup } from '../core/validation';
import {
  applyTheme,
  flushStorage,
  hasExplicitTheme,
  useFlowStore,
  type Theme,
} from '../state/store';

/**
 * Thin bridge between the Flow app and the VS Code extension host, used only
 * when the app runs inside a webview. It keeps the persisted theme choice in
 * extension state (localStorage is unavailable in webviews) and lets the app
 * follow live VS Code color-theme changes until the user picks a theme.
 */

export interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

let cachedApi: VsCodeApi | null | undefined;

export function getVsCodeApi(): VsCodeApi | null {
  if (cachedApi === undefined) {
    // acquireVsCodeApi may only be called once per webview document.
    cachedApi = typeof window.acquireVsCodeApi === 'function'
      ? window.acquireVsCodeApi()
      : null;
  }
  return cachedApi;
}

/** True only when the app is running inside the VS Code extension webview. */
export function isVsCodeWebview(): boolean {
  return getVsCodeApi() !== null;
}

/** Subscribes to structured messages posted by the extension host. */
export function subscribeHostMessages(
  handler: (data: Record<string, unknown>) => void,
): () => void {
  const listener = (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    handler(data as Record<string, unknown>);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/**
 * Ask the extension host to open Flow's application-data folder in the OS file
 * manager. Returns false outside VS Code, where there is no folder to open.
 */
export function openDataFolder(): boolean {
  const api = getVsCodeApi();
  if (!api) return false;
  api.postMessage({ type: 'flow:openDataFolder' });
  return true;
}

interface PendingSourceRequest {
  timer: ReturnType<typeof setTimeout>;
}

const pendingSourceRequests = new Map<string, PendingSourceRequest>();
let sourceRequestCounter = 0;
let sourceRequestListenerInstalled = false;

function ensureSourceRequestListener(): void {
  if (sourceRequestListenerInstalled) return;
  sourceRequestListenerInstalled = true;
  subscribeHostMessages((data) => {
    if (data.type !== 'flow:openSourceResult') return;
    const requestId = typeof data.requestId === 'string' ? data.requestId : '';
    const pending = pendingSourceRequests.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingSourceRequests.delete(requestId);
    if (data.ok !== true) {
      const message =
        typeof data.error === 'string' && data.error
          ? data.error
          : 'Could not open the source file.';
      useFlowStore.getState().notify(message, 'error');
    }
  });
}

/**
 * Ask the extension host to open a workspace-relative source file and select
 * the given 1-based line range. Does nothing outside VS Code.
 *
 * The host acknowledges with `flow:openSourceResult`. A missing response means
 * the running extension host is older than the webview (a window reload is
 * needed), so the user gets an explicit message instead of a silent failure.
 */
export function openSourceFile(
  sourcePath: string,
  startLine?: number,
  endLine?: number,
): void {
  const api = getVsCodeApi();
  if (!api) return;
  ensureSourceRequestListener();
  sourceRequestCounter += 1;
  const requestId = `src_${Date.now().toString(36)}_${sourceRequestCounter}`;
  const timer = setTimeout(() => {
    pendingSourceRequests.delete(requestId);
    useFlowStore
      .getState()
      .notify(
        'The Flow extension host did not respond. Reload the VS Code window and try again.',
        'error',
      );
  }, 3000);
  pendingSourceRequests.set(requestId, { timer });
  api.postMessage({
    type: 'flow:openSourceFile',
    requestId,
    path: sourcePath,
    ...(typeof startLine === 'number' ? { startLine } : {}),
    ...(typeof endLine === 'number' ? { endLine } : {}),
  });
}

/** Copy text with the host clipboard inside VS Code, or the browser clipboard. */
export async function copyText(text: string): Promise<void> {
  const api = getVsCodeApi();
  if (api) {
    api.postMessage({ type: 'flow:copyText', text });
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* Clipboard access was denied; the value stays selectable. */
  }
}

export function initThemeBridge(): void {
  const api = getVsCodeApi();
  if (!api) return; // plain browser: localStorage path already handles this.

  let explicit = hasExplicitTheme();
  let applyingHostTheme = false;

  subscribeHostMessages((data) => {
    if (data.type !== 'flow:hostTheme') return;
    if (data.theme !== 'light' && data.theme !== 'dark') return;
    if (explicit) return; // the user's saved choice wins over the host theme.
    const theme = data.theme as Theme;
    applyingHostTheme = true;
    try {
      applyTheme(theme);
      useFlowStore.setState({ theme });
    } finally {
      applyingHostTheme = false;
    }
  });

  useFlowStore.subscribe((state, previous) => {
    if (state.theme === previous.theme || applyingHostTheme) return;
    explicit = true;
    api.postMessage({ type: 'flow:setTheme', theme: state.theme });
  });
}

/* --------------------------------------------------------- terminal commands */

const LIST_LIMIT = 2000;
const MAX_RESULT_BYTES = 6_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function projectFor(projectId: unknown): Project | null {
  const state = useFlowStore.getState();
  const id =
    typeof projectId === 'string' && projectId ? projectId : state.activeProjectId;
  return state.projects.find((candidate) => candidate.id === id) ?? null;
}

function resolveNode(project: Project, ref: unknown): FlowNode | null {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const value = ref.trim();
  if (value === ROOT_REF) {
    return project.nodes.find((node) => node.parentId === null) ?? null;
  }
  return (
    project.nodes.find((node) => node.externalKey === value) ??
    project.nodes.find((node) => node.id === value) ??
    null
  );
}

function nodePath(project: Project, node: FlowNode): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let current: FlowNode | undefined = node;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.externalKey || current.title);
    current = project.nodes.find((candidate) => candidate.id === current?.parentId);
  }
  return parts.join(' / ');
}

function nodeSummary(project: Project, node: FlowNode, includeMarkdown: boolean) {
  return {
    id: node.id,
    externalKey: node.externalKey ?? null,
    parentId: node.parentId,
    type: node.type,
    title: node.title,
    path: nodePath(project, node),
    description: node.description,
    markdownLength: node.markdown.length,
    imageCount: node.images.length,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    provenance: node.provenance ?? null,
    ...(includeMarkdown
      ? { markdown: node.markdown, details: node.details }
      : {}),
  };
}

function statusResult() {
  const state = useFlowStore.getState();
  const project =
    state.projects.find((candidate) => candidate.id === state.activeProjectId) ?? null;
  return {
    activeProjectId: project?.id ?? null,
    activeProjectName: project?.name ?? null,
    workspaceProjectId: state.workspaceProjectId,
    projectCount: state.projects.length,
    nodeCount: project?.nodes.length ?? 0,
    connectionCount: project?.connections.length ?? 0,
    storageKind: state.storageKind,
    persistent: state.persistent,
    storageWarning: state.storageWarning,
    saveState: state.saveState,
    projects: state.projects.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      nodeCount: candidate.nodes.length,
      connectionCount: candidate.connections.length,
      updatedAt: candidate.updatedAt,
    })),
  };
}

function listResult(payload: Record<string, unknown>) {
  const project = projectFor(payload.projectId);
  if (!project) return { ok: false as const, errors: ['No Flow project is open.'] };
  const type = typeof payload.type === 'string' ? payload.type : null;
  if (type && !(NODE_TYPES as readonly string[]).includes(type)) {
    return {
      ok: false as const,
      errors: [`Unknown node type "${type}".`],
    };
  }
  const includeMarkdown = payload.includeMarkdown === true;
  const nodes = project.nodes
    .filter((node) => !type || node.type === type)
    .slice(0, LIST_LIMIT)
    .map((node) => nodeSummary(project, node, includeMarkdown));
  return {
    ok: true as const,
    result: {
      projectId: project.id,
      projectName: project.name,
      total: project.nodes.length,
      returned: nodes.length,
      truncated: nodes.length === LIST_LIMIT && project.nodes.length > LIST_LIMIT,
      nodes,
    },
  };
}

function getResult(payload: Record<string, unknown>) {
  const project = projectFor(payload.projectId);
  if (!project) return { ok: false as const, errors: ['No Flow project is open.'] };
  const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId.trim() : '';
  const ref = nodeId || payload.ref || payload.externalKey || payload.id || ROOT_REF;
  const node = nodeId
    ? project.nodes.find((candidate) => candidate.id === nodeId)
    : resolveNode(project, ref);
  if (!node) {
    return { ok: false as const, errors: [`No node matches "${String(ref)}".`] };
  }
  const connections = project.connections
    .filter(
      (connection) => connection.source === node.id || connection.target === node.id,
    )
    .map((connection) => ({
      id: connection.id,
      source: connection.source,
      sourceKey:
        project.nodes.find((candidate) => candidate.id === connection.source)
          ?.externalKey ?? connection.source,
      target: connection.target,
      targetKey:
        project.nodes.find((candidate) => candidate.id === connection.target)
          ?.externalKey ?? connection.target,
      type: connection.type,
      label: connection.label,
    }));
  return {
    ok: true as const,
    result: {
      projectId: project.id,
      node: {
        ...nodeSummary(project, node, true),
        images: node.images.map((image) => ({
          id: image.id,
          name: image.name,
          width: image.width,
          height: image.height,
        })),
      },
      connections,
    },
  };
}

function snapshotResult(payload: Record<string, unknown>) {
  const project = projectFor(payload.projectId);
  if (!project) {
    return { ok: false as const, errors: ['No Flow project is open.'] };
  }
  return {
    ok: true as const,
    result: { projectId: project.id, backup: buildBackup([project]) },
  };
}

async function applyResult(payload: Record<string, unknown>) {
  const store = useFlowStore.getState();
  const result = store.applyExternalPlan({
    ops: payload.ops,
    dryRun: payload.dryRun === true,
    provenance: payload.provenance,
    projectId:
      typeof payload.projectId === 'string' ? payload.projectId : undefined,
  });

  let persisted = true;
  if (result.ok && !result.dryRun) {
    await flushStorage();
    persisted = useFlowStore.getState().saveState === 'saved';
  }
  if (!persisted) {
    return {
      ok: false as const,
      errors: [
        ...result.errors,
        'The plan was applied in memory but could not be saved. Export a backup before closing Flow.',
      ],
      result: { ...result, persisted },
    };
  }
  return { ok: result.ok, errors: result.errors, result: { ...result, persisted } };
}

export function initCommandBridge(): void {
  const api = getVsCodeApi();
  if (!api) return;

  let commandsReadyPosted = false;
  let lastWorkspaceProjectId: string | null = null;

  const announce = () => {
    const state = useFlowStore.getState();
    if (state.status !== 'ready') return;
    // Report the link before signalling readiness so a queued apply uses the
    // project this app actually created or opened.
    if (
      state.workspaceProjectId &&
      state.workspaceProjectId !== lastWorkspaceProjectId
    ) {
      lastWorkspaceProjectId = state.workspaceProjectId;
      api.postMessage({
        type: 'flow:workspaceProject',
        projectId: state.workspaceProjectId,
        workspaceName: null,
      });
    }
    if (!commandsReadyPosted) {
      commandsReadyPosted = true;
      api.postMessage({ type: 'flow:commandsReady' });
    }
  };

  announce();
  useFlowStore.subscribe(announce);

  subscribeHostMessages((data) => {
    if (data.type !== 'flow:command') return;
    const requestId = typeof data.requestId === 'string' ? data.requestId : '';
    if (!requestId) return;
    const command = typeof data.command === 'string' ? data.command : '';
    const payload = isRecord(data.payload) ? data.payload : {};

    void (async () => {
      let response: { ok: boolean; result?: unknown; errors?: string[] };
      try {
        switch (command) {
          case 'status':
            response = { ok: true, result: statusResult() };
            break;
          case 'list':
            response = listResult(payload);
            break;
          case 'get':
            response = getResult(payload);
            break;
          case 'snapshot':
            response = snapshotResult(payload);
            break;
          case 'apply':
            response = await applyResult(payload);
            break;
          default:
            response = {
              ok: false,
              errors: [`Unknown Flow command "${command}".`],
            };
        }
      } catch (error) {
        response = {
          ok: false,
          errors: [error instanceof Error ? error.message : 'Flow command failed.'],
        };
      }

      let result = response.result;
      try {
        // Snapshots exist to back up whatever the project holds, so they are
        // exempt from the normal response-size guard.
        if (
          command !== 'snapshot' &&
          result !== undefined &&
          JSON.stringify(result).length > MAX_RESULT_BYTES
        ) {
          result = { error: 'The response is too large. Request less data.' };
          response = { ok: false, errors: ['The response is too large.'] };
        }
      } catch {
        result = undefined;
      }

      api.postMessage({
        type: 'flow:commandResult',
        requestId,
        ok: response.ok,
        ...(result !== undefined ? { result } : {}),
        ...(response.errors ? { errors: response.errors } : {}),
      });
    })();
  });
}
