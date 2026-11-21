import type { Project, WorkspaceSnapshot } from '../core/types';
import type { StorageAdapter } from './repository';

const DB_NAME = 'flow-workspace';
const DB_VERSION = 1;
const PROJECTS_STORE = 'projects';
const META_STORE = 'meta';
const ACTIVE_PROJECT_KEY = 'activeProjectId';

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
  });
}

export function openFlowDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this browser.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECTS_STORE)) {
        database.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        database.createObjectStore(META_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Could not open the local Flow database.'));
    request.onblocked = () =>
      reject(new Error('The local Flow database is blocked by another tab.'));
  });
}

/**
 * Browser-managed local persistence. Projects are stored as structured
 * documents; the adapter can later be replaced by SQLite-WASM + OPFS without
 * changes to the domain layer.
 */
export class IndexedDbStorage implements StorageAdapter {
  readonly kind = 'IndexedDB';
  readonly persistent = true;
  readonly warning: string | null = null;

  constructor(private readonly database: IDBDatabase) {}

  async loadWorkspace(): Promise<WorkspaceSnapshot | null> {
    const transaction = this.database.transaction([PROJECTS_STORE, META_STORE], 'readonly');
    const projects = await requestToPromise(
      transaction.objectStore(PROJECTS_STORE).getAll() as IDBRequest<Project[]>,
    );
    const activeProjectId = await requestToPromise(
      transaction.objectStore(META_STORE).get(ACTIVE_PROJECT_KEY) as IDBRequest<
        string | null | undefined
      >,
    );
    if (projects.length === 0) return null;
    return { projects, activeProjectId: activeProjectId ?? null };
  }

  async saveProject(project: Project): Promise<void> {
    const transaction = this.database.transaction(PROJECTS_STORE, 'readwrite');
    transaction.objectStore(PROJECTS_STORE).put(project);
    await transactionDone(transaction);
  }

  async deleteProject(projectId: string): Promise<void> {
    const transaction = this.database.transaction(PROJECTS_STORE, 'readwrite');
    transaction.objectStore(PROJECTS_STORE).delete(projectId);
    await transactionDone(transaction);
  }

  async saveActiveProjectId(projectId: string | null): Promise<void> {
    const transaction = this.database.transaction(META_STORE, 'readwrite');
    const store = transaction.objectStore(META_STORE);
    if (projectId === null) store.delete(ACTIVE_PROJECT_KEY);
    else store.put(projectId, ACTIVE_PROJECT_KEY);
    await transactionDone(transaction);
  }
}
