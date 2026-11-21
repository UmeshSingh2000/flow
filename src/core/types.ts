/**
 * Framework-independent domain types for Flow.
 *
 * Nothing in `src/core` may import React, browser APIs, or storage code.
 * The web app and a future VS Code extension share this model.
 */

export const NODE_TYPES = [
  'project',
  'module',
  'feature',
  'sub-feature',
  'process',
  'decision',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  project: 'Project',
  module: 'Module',
  feature: 'Feature',
  'sub-feature': 'Sub-feature',
  process: 'Process',
  decision: 'Decision',
};

export const CONNECTION_TYPES = [
  'depends-on',
  'calls',
  'leads-to',
  'related-to',
] as const;

export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const CONNECTION_TYPE_LABELS: Record<ConnectionType, string> = {
  'depends-on': 'Depends on',
  calls: 'Calls',
  'leads-to': 'Leads to',
  'related-to': 'Related to',
};

/** Optional structured documentation attached to a node. */
export interface NodeDetails {
  purpose: string;
  inputs: string;
  outputs: string;
  preconditions: string;
  behavior: string;
  successResult: string;
  failureResult: string;
  notes: string;
}

export type DetailKey = keyof NodeDetails;

export const DETAIL_FIELDS: ReadonlyArray<{
  key: DetailKey;
  label: string;
  placeholder: string;
}> = [
  { key: 'purpose', label: 'Purpose', placeholder: 'Why does this exist?' },
  { key: 'inputs', label: 'Inputs', placeholder: 'What does it receive?' },
  { key: 'outputs', label: 'Outputs', placeholder: 'What does it produce?' },
  { key: 'preconditions', label: 'Preconditions', placeholder: 'What must be true first?' },
  { key: 'behavior', label: 'Main behavior', placeholder: 'What happens, step by step?' },
  { key: 'successResult', label: 'Success result', placeholder: 'What does success look like?' },
  { key: 'failureResult', label: 'Failure result', placeholder: 'How does it fail?' },
  { key: 'notes', label: 'Notes', placeholder: 'Anything else worth recording.' },
];

export interface Point {
  x: number;
  y: number;
}

/** An image attached to a node. Stored inline as a data URL so it travels with backups. */
export interface NodeImage {
  id: string;
  name: string;
  /** Always a `data:image/...` URL; validated on import. */
  dataUrl: string;
  width: number;
  height: number;
  addedAt: string;
}

/** Images are downscaled before storage, so a handful per node stays reasonable. */
export const MAX_IMAGES_PER_NODE = 6;
/** Roughly 3 MB of binary data; larger payloads are rejected on import. */
export const MAX_IMAGE_DATA_URL_LENGTH = 4_000_000;

export interface FlowNode {
  id: string;
  projectId: string;
  /** Hierarchy parent. `null` for top-level nodes (including the project root). */
  parentId: string | null;
  type: NodeType;
  title: string;
  description: string;
  /** Free-form Markdown documentation, rendered read-only in the properties panel. */
  markdown: string;
  images: NodeImage[];
  details: NodeDetails;
  position: Point;
  createdAt: string;
  updatedAt: string;
}

/**
 * A graph relationship between two nodes. Stored separately from hierarchy
 * (`parentId`) and from node positions, per FR-CONN-07.
 */
export interface FlowConnection {
  id: string;
  projectId: string;
  source: string;
  target: string;
  type: ConnectionType | null;
  label: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  nodes: FlowNode[];
  connections: FlowConnection[];
}

export interface WorkspaceSnapshot {
  projects: Project[];
  activeProjectId: string | null;
}
