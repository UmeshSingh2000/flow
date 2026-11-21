import { IndexedDbStorage, openFlowDatabase } from './indexeddb';
import { MemoryStorage } from './memory';
import type { StorageAdapter } from './repository';

/**
 * Chooses the best available local adapter. IndexedDB is the default for the
 * web prototype; the failure path is an explicit, visible memory fallback
 * rather than a silent no-op (FR-DATA-08).
 */
export async function createStorage(): Promise<StorageAdapter> {
  try {
    const database = await openFlowDatabase();
    return new IndexedDbStorage(database);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    return new MemoryStorage(reason);
  }
}
