/**
 * Test-only bundle entry. `npm test` compiles this to `.test-build/core.cjs`
 * with Rolldown so the pure TypeScript core can run under node:test without a
 * TypeScript loader (the project imports are extensionless).
 */
export * from '../../src/core/operations';
export { computeAutoLayout } from '../../src/core/layout';
export { parseSourceFence } from '../../src/core/sourceFence';
export {
  createConnection,
  createNodeRecord,
  createProject,
  deleteNode,
  duplicateNode,
  getNode,
  getRootNode,
  updateNode,
} from '../../src/core/graph';
