import { create } from 'zustand';
import { buildBackup } from '../core/validation';
import type { Project } from '../core/types';
import {
  isShareSupported,
  notifyAppReady,
  onShareEvent,
  startShare as startShareRequest,
  stopShare as stopShareRequest,
  updateShare,
  type ShareHandle,
} from '../ui/shareBridge';
import { useFlowStore } from './store';

const UPDATE_DEBOUNCE_MS = 450;

export interface ActiveShare extends ShareHandle {
  /** The project this share is bound to; switching projects ends the share. */
  projectId: string;
}

export interface ShareState {
  /** LAN sharing needs the Node extension host, not a plain browser tab. */
  supported: boolean;
  dialogOpen: boolean;
  phase: 'idle' | 'starting' | 'active' | 'stopping';
  share: ActiveShare | null;
  error: string | null;
  openDialog(): void;
  closeDialog(): void;
  clearError(): void;
  start(password?: string): Promise<void>;
  stop(reason?: string): Promise<void>;
}

let initialized = false;
let updateTimer: ReturnType<typeof setTimeout> | null = null;
let pendingProject: Project | null = null;

function scheduleUpdate(project: Project): void {
  pendingProject = project;
  if (updateTimer) clearTimeout(updateTimer);
  updateTimer = setTimeout(() => {
    updateTimer = null;
    const share = useShareStore.getState().share;
    const next = pendingProject;
    pendingProject = null;
    if (!share || !next || next.id !== share.projectId) return;
    updateShare(share.shareId, buildBackup([next]));
  }, UPDATE_DEBOUNCE_MS);
}

/**
 * Wires the sharer-side store to the app store. Called once when the editor
 * boots; a no-op in a plain browser without the extension host.
 */
export function initShareStore(): void {
  if (initialized) return;
  initialized = true;

  const supported = isShareSupported();
  useShareStore.setState({ supported });
  if (!supported) return;

  // A freshly loaded webview should not inherit a share left running by the
  // previous document.
  notifyAppReady();

  useFlowStore.subscribe((state, previous) => {
    const shareState = useShareStore.getState();
    const share = shareState.share;
    if (!share || shareState.phase !== 'active') return;

    const project = state.projects.find(
      (candidate) => candidate.id === share.projectId,
    );
    if (!project) {
      void useShareStore
        .getState()
        .stop('Sharing stopped because the shared project was deleted.');
      return;
    }
    if (state.activeProjectId !== share.projectId) {
      void useShareStore
        .getState()
        .stop('Sharing stopped because you switched projects.');
      return;
    }

    const previousProject = previous.projects.find(
      (candidate) => candidate.id === share.projectId,
    );
    if (previousProject === project) return;
    scheduleUpdate(project);
  });

  onShareEvent((event) => {
    const share = useShareStore.getState().share;
    if (!share || event.shareId !== share.shareId) return;
    if (event.kind === 'ended') {
      useShareStore.setState({
        phase: 'idle',
        share: null,
        error: event.reason,
      });
    } else {
      useShareStore.setState({ error: event.message });
    }
  });
}

export const useShareStore = create<ShareState>()((set, get) => ({
  supported: false,
  dialogOpen: false,
  phase: 'idle',
  share: null,
  error: null,

  openDialog() {
    set({ dialogOpen: true });
  },

  closeDialog() {
    set({ dialogOpen: false });
  },

  clearError() {
    set({ error: null });
  },

  async start(password) {
    const phase = get().phase;
    if (phase === 'starting' || phase === 'active' || phase === 'stopping') return;

    const state = useFlowStore.getState();
    const project = state.projects.find(
      (candidate) => candidate.id === state.activeProjectId,
    );
    if (!project) {
      set({ error: 'Open a project before sharing it.' });
      return;
    }

    set({ phase: 'starting', error: null });
    try {
      const info = await startShareRequest({
        snapshot: buildBackup([project]),
        password: password?.trim() ? password.trim() : undefined,
        theme: state.theme,
      });

      // The project may have changed while the host was starting the server.
      const current = useFlowStore.getState();
      const stillActive =
        current.activeProjectId === project.id &&
        current.projects.some((candidate) => candidate.id === project.id);
      if (!stillActive) {
        try {
          await stopShareRequest(info.shareId);
        } catch {
          /* the share will expire on its own */
        }
        set({
          phase: 'idle',
          share: null,
          error: 'Sharing stopped because you switched projects.',
        });
        return;
      }

      set({
        phase: 'active',
        share: { ...info, projectId: project.id },
        error: null,
      });
    } catch (error) {
      set({
        phase: 'idle',
        share: null,
        error:
          error instanceof Error ? error.message : 'Could not start sharing.',
      });
    }
  },

  async stop(reason) {
    const share = get().share;
    if (!share) {
      set({ phase: 'idle' });
      return;
    }
    if (get().phase === 'stopping') return;

    if (updateTimer) {
      clearTimeout(updateTimer);
      updateTimer = null;
    }
    pendingProject = null;

    set({ phase: 'stopping', error: reason ?? null });
    try {
      await stopShareRequest(share.shareId);
    } catch {
      // The host may already have stopped it (expiry, panel closed); the local
      // state still needs to reflect that the share is over.
    }
    set({ phase: 'idle', share: null });
    if (reason) useFlowStore.getState().notify(reason, 'info');
  },
}));
