import type { Project, WorkspaceSnapshot } from '../core/types';

/**
 * Storage boundary required by FR-DATA-09 / ARCH-02.
 *
 * The web app talks only to this interface. Swapping in a SQLite-WASM/OPFS
 * adapter — or a native SQLite adapter inside a VS Code extension — does not
 * touch the domain logic or the UI.
 */
export interface StorageAdapter {
  /** Human-readable adapter name surfaced in the storage indicator. */
  readonly kind: string;
  /** False when the adapter cannot persist across sessions. */
  readonly persistent: boolean;
  /** Optional warning to surface in the UI (for example a memory fallback). */
  readonly warning: string | null;

  loadWorkspace(): Promise<WorkspaceSnapshot | null>;
  saveProject(project: Project): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  saveActiveProjectId(projectId: string | null): Promise<void>;
}
