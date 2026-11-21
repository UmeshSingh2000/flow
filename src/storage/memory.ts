import type { Project, WorkspaceSnapshot } from '../core/types';
import type { StorageAdapter } from './repository';

/**
 * In-memory fallback used when IndexedDB is unavailable (for example a
 * restrictive private-browsing mode). The UI surfaces this loudly instead of
 * pretending the data is safe.
 */
export class MemoryStorage implements StorageAdapter {
  readonly kind = 'Temporary memory';
  readonly persistent = false;
  readonly warning: string;

  private projects = new Map<string, Project>();
  private activeProjectId: string | null = null;

  constructor(reason: string) {
    this.warning = `Local database unavailable (${reason}). Changes are kept in memory only and will be lost when this tab closes. Export a backup to keep your work.`;
  }

  async loadWorkspace(): Promise<WorkspaceSnapshot | null> {
    const projects = [...this.projects.values()].map((project) => structuredClone(project));
    if (projects.length === 0) return null;
    return { projects, activeProjectId: this.activeProjectId };
  }

  async saveProject(project: Project): Promise<void> {
    this.projects.set(project.id, structuredClone(project));
  }

  async deleteProject(projectId: string): Promise<void> {
    this.projects.delete(projectId);
  }

  async saveActiveProjectId(projectId: string | null): Promise<void> {
    this.activeProjectId = projectId;
  }
}
