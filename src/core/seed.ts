/**
 * A small demo project so a first launch is not an empty canvas.
 * Mirrors the seeded "Product architecture" map from the design reference.
 */

import { createId } from './id';
import { now } from './graph';
import type { FlowConnection, FlowNode, NodeType, Project } from './types';

export function seedProject(): Project {
  const projectId = createId('p');
  const timestamp = now();

  const node = (
    title: string,
    type: NodeType,
    description: string,
    x: number,
    y: number,
    parentId: string | null,
  ): FlowNode => ({
    id: createId('n'),
    projectId,
    parentId,
    type,
    title,
    description,
    details: {
      purpose: '',
      inputs: '',
      outputs: '',
      preconditions: '',
      behavior: '',
      successResult: '',
      failureResult: '',
      notes: '',
    },
    position: { x, y },
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const root = node('Flow', 'project', 'Offline-first project workspace', 0, 330, null);
  const workspace = node('Workspace', 'feature', 'A clear home for every project', 328, 150, root.id);
  const visualCanvas = node('Visual canvas', 'feature', 'Map architecture as a flexible graph', 328, 430, root.id);
  const localStorage = node('Local storage', 'feature', 'Keep project work close and available', 328, 710, root.id);

  const projectTree = node('Project tree', 'sub-feature', 'Scan and select any part', 656, 120, workspace.id);
  const nodeEditor = node('Node editor', 'sub-feature', 'Keep names and notes in context', 656, 380, visualCanvas.id);
  const connections = node('Connections', 'sub-feature', 'Show relationships across branches', 656, 540, visualCanvas.id);
  const browserSave = node('Browser save', 'sub-feature', 'Changes stay on this device', 656, 760, localStorage.id);
  const sqliteReady = node('SQLite-ready', 'sub-feature', 'A local-first foundation', 656, 920, localStorage.id);

  const connection = (
    source: string,
    target: string,
    type: FlowConnection['type'],
    label: string,
  ): FlowConnection => ({
    id: createId('c'),
    projectId,
    source,
    target,
    type,
    label,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return {
    id: projectId,
    name: 'Product architecture',
    description: 'A map of how it all fits',
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [
      root,
      workspace,
      visualCanvas,
      localStorage,
      projectTree,
      nodeEditor,
      connections,
      browserSave,
      sqliteReady,
    ],
    connections: [connection(nodeEditor.id, browserSave.id, 'leads-to', 'autosaves')],
  };
}
