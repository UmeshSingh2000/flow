/**
 * Pure graph operations. These functions never mutate their input; they return
 * new project objects. They contain no React, DOM, or storage dependencies so
 * the same logic can power a future VS Code webview (ARCH-01).
 */

import { createId } from './id';
import { MAX_IMAGES_PER_NODE } from './types';
import type {
  ConnectionType,
  FlowConnection,
  FlowNode,
  NodeDetails,
  NodeImage,
  NodeType,
  Point,
  Project,
} from './types';

/** Rendered width of a node card. Used for deterministic child placement. */
export const NODE_CARD_WIDTH = 232;
/** Horizontal distance between hierarchy levels. */
export const LEVEL_GAP = 96;
/** Vertical distance between sibling nodes. */
export const SIBLING_GAP = 112;

export function now(): string {
  return new Date().toISOString();
}

export function emptyDetails(): NodeDetails {
  return {
    purpose: '',
    inputs: '',
    outputs: '',
    preconditions: '',
    behavior: '',
    successResult: '',
    failureResult: '',
    notes: '',
  };
}

export function createNodeRecord(input: {
  projectId: string;
  parentId: string | null;
  type: NodeType;
  title: string;
  description?: string;
  position?: Point;
}): FlowNode {
  const timestamp = now();
  return {
    id: createId('n'),
    projectId: input.projectId,
    parentId: input.parentId,
    type: input.type,
    title: input.title,
    description: input.description ?? '',
    markdown: '',
    images: [],
    details: emptyDetails(),
    position: input.position ?? { x: 0, y: 0 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** A new project always has a project-root node so the map has a starting point. */
export function createProject(name: string, description = ''): Project {
  const id = createId('p');
  const timestamp = now();
  const root = createNodeRecord({
    projectId: id,
    parentId: null,
    type: 'project',
    title: name.trim() || 'Untitled project',
    description,
    position: { x: 0, y: 0 },
  });
  return {
    id,
    name: name.trim() || 'Untitled project',
    description,
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [root],
    connections: [],
  };
}

export function getRootNode(project: Project): FlowNode | undefined {
  return project.nodes.find((node) => node.parentId === null);
}

export function getNode(project: Project, id: string | null): FlowNode | undefined {
  if (!id) return undefined;
  return project.nodes.find((node) => node.id === id);
}

export function getChildren(project: Project, parentId: string | null): FlowNode[] {
  return project.nodes
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.position.y - b.position.y || a.title.localeCompare(b.title));
}

export function getDescendantIds(project: Project, nodeId: string): string[] {
  const result: string[] = [];
  const stack = [nodeId];
  const seen = new Set<string>([nodeId]);
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const node of project.nodes) {
      if (node.parentId === current && !seen.has(node.id)) {
        seen.add(node.id);
        result.push(node.id);
        stack.push(node.id);
      }
    }
  }
  return result;
}

export function getAncestorIds(project: Project, nodeId: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let current = getNode(project, nodeId);
  while (current?.parentId) {
    if (seen.has(current.parentId)) break;
    seen.add(current.parentId);
    result.push(current.parentId);
    current = getNode(project, current.parentId);
  }
  return result;
}

/** True when `nodeId` sits somewhere beneath `ancestorId` in the hierarchy. */
export function isDescendant(project: Project, ancestorId: string, nodeId: string): boolean {
  return getAncestorIds(project, nodeId).includes(ancestorId);
}

export function wouldCreateCycle(
  project: Project,
  nodeId: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === nodeId) return true;
  return isDescendant(project, nodeId, newParentId);
}

/** Sensible untitled names per node type. */
export function defaultNodeTitle(type: NodeType): string {
  switch (type) {
    case 'project':
      return 'New project';
    case 'module':
      return 'New module';
    case 'feature':
      return 'New feature';
    case 'sub-feature':
      return 'New sub-feature';
    case 'process':
      return 'New process';
    case 'decision':
      return 'New decision';
  }
}

export function defaultChildType(parentType: NodeType): NodeType {
  switch (parentType) {
    case 'project':
      return 'module';
    case 'module':
      return 'feature';
    case 'feature':
      return 'sub-feature';
    case 'sub-feature':
      return 'sub-feature';
    case 'process':
      return 'process';
    case 'decision':
      return 'process';
  }
}

function nextChildPosition(project: Project, parent: FlowNode): Point {
  const siblings = getChildren(project, parent.id);
  const x = parent.position.x + NODE_CARD_WIDTH + LEVEL_GAP;
  const y =
    siblings.length > 0
      ? Math.max(...siblings.map((sibling) => sibling.position.y)) + SIBLING_GAP
      : parent.position.y;
  return { x, y };
}

export interface AddChildResult {
  project: Project;
  node: FlowNode;
}

/**
 * Adds a child node. `parentId` of `null` targets the project root.
 * Placement is deterministic but the user is free to drag the node afterwards.
 */
export function addChildNode(
  project: Project,
  parentId: string | null,
  options: {
    type?: NodeType;
    title?: string;
    description?: string;
  } = {},
): AddChildResult {
  const parent = parentId ? getNode(project, parentId) : getRootNode(project);
  if (!parent) {
    throw new Error('Parent node not found.');
  }
  const type = options.type ?? defaultChildType(parent.type);
  const node = createNodeRecord({
    projectId: project.id,
    parentId: parent.id,
    type,
    title: options.title ?? defaultNodeTitle(type),
    description: options.description ?? '',
    position: nextChildPosition(project, parent),
  });
  return {
    node,
    project: {
      ...project,
      nodes: [...project.nodes, node],
      updatedAt: now(),
    },
  };
}

/** Duplicates a single node (FR-NODE-07), keeping its fields and type. */
export function duplicateNode(project: Project, nodeId: string): AddChildResult | null {
  const node = getNode(project, nodeId);
  if (!node) return null;
  const timestamp = now();
  const copy: FlowNode = {
    ...node,
    id: createId('n'),
    title: `${node.title} copy`,
    details: { ...node.details },
    images: node.images.map((image) => ({ ...image, id: createId('img') })),
    position: { x: node.position.x + 28, y: node.position.y + 28 },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    node: copy,
    project: {
      ...project,
      nodes: [...project.nodes, copy],
      updatedAt: timestamp,
    },
  };
}

export function updateNode(
  project: Project,
  nodeId: string,
  patch: Partial<
    Omit<FlowNode, 'id' | 'projectId' | 'createdAt' | 'updatedAt' | 'details'>
  > & {
    details?: Partial<NodeDetails>;
  },
): Project {
  return {
    ...project,
    nodes: project.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            ...patch,
            details: { ...node.details, ...(patch.details ?? {}) },
            updatedAt: now(),
          }
        : node,
    ),
    updatedAt: now(),
  };
}

/** Attaches an image unless the node already holds the maximum. */
export function addImageToNode(
  project: Project,
  nodeId: string,
  image: NodeImage,
): ProjectResult {
  const node = getNode(project, nodeId);
  if (!node) return { ok: false, error: 'Node not found.' };
  if (node.images.length >= MAX_IMAGES_PER_NODE) {
    return {
      ok: false,
      error: `A node can hold at most ${MAX_IMAGES_PER_NODE} images. Remove one first.`,
    };
  }
  return {
    ok: true,
    project: {
      ...project,
      nodes: project.nodes.map((candidate) =>
        candidate.id === nodeId
          ? { ...candidate, images: [...candidate.images, image], updatedAt: now() }
          : candidate,
      ),
      updatedAt: now(),
    },
  };
}

export function removeImageFromNode(
  project: Project,
  nodeId: string,
  imageId: string,
): Project {
  return {
    ...project,
    nodes: project.nodes.map((node) =>
      node.id === nodeId
        ? {
            ...node,
            images: node.images.filter((image) => image.id !== imageId),
            updatedAt: now(),
          }
        : node,
    ),
    updatedAt: now(),
  };
}

export function moveNode(project: Project, nodeId: string, position: Point): Project {
  return {
    ...project,
    nodes: project.nodes.map((node) =>
      node.id === nodeId ? { ...node, position, updatedAt: now() } : node,
    ),
    updatedAt: now(),
  };
}

export type ProjectResult =
  | { ok: true; project: Project }
  | { ok: false; error: string };

export function reparentNode(
  project: Project,
  nodeId: string,
  newParentId: string | null,
): ProjectResult {
  const node = getNode(project, nodeId);
  if (!node) return { ok: false, error: 'Node not found.' };
  if (node.parentId === null) {
    return { ok: false, error: 'The project root cannot be re-parented.' };
  }
  if (newParentId !== null && !getNode(project, newParentId)) {
    return { ok: false, error: 'Target parent node not found.' };
  }
  if (newParentId === nodeId) {
    return { ok: false, error: 'A node cannot be its own parent.' };
  }
  if (wouldCreateCycle(project, nodeId, newParentId)) {
    return { ok: false, error: 'That would move the node beneath one of its own descendants.' };
  }
  return {
    ok: true,
    project: {
      ...project,
      nodes: project.nodes.map((candidate) =>
        candidate.id === nodeId
          ? { ...candidate, parentId: newParentId, updatedAt: now() }
          : candidate,
      ),
      updatedAt: now(),
    },
  };
}

export interface DeleteNodeResult {
  ok: true;
  project: Project;
  removedIds: string[];
}

export function deleteNode(project: Project, nodeId: string): DeleteNodeResult | {
  ok: false;
  error: string;
} {
  const node = getNode(project, nodeId);
  if (!node) return { ok: false, error: 'Node not found.' };
  const root = getRootNode(project);
  if (root?.id === nodeId) {
    return {
      ok: false,
      error: 'The project root cannot be deleted. Delete the project instead.',
    };
  }
  const removedIds = [nodeId, ...getDescendantIds(project, nodeId)];
  const removed = new Set(removedIds);
  return {
    ok: true,
    removedIds,
    project: {
      ...project,
      nodes: project.nodes.filter((candidate) => !removed.has(candidate.id)),
      connections: project.connections.filter(
        (connection) =>
          !removed.has(connection.source) && !removed.has(connection.target),
      ),
      updatedAt: now(),
    },
  };
}

export function canConnect(
  project: Project,
  source: string,
  target: string,
): { ok: true } | { ok: false; error: string } {
  if (source === target) {
    return { ok: false, error: 'A node cannot connect to itself.' };
  }
  if (!getNode(project, source) || !getNode(project, target)) {
    return { ok: false, error: 'Both nodes must exist.' };
  }
  const duplicate = project.connections.some(
    (connection) => connection.source === source && connection.target === target,
  );
  if (duplicate) {
    return { ok: false, error: 'A connection between these nodes already exists.' };
  }
  return { ok: true };
}

export function createConnection(
  project: Project,
  source: string,
  target: string,
  type: ConnectionType | null = null,
  label = '',
): (ProjectResult & { connection?: FlowConnection }) {
  const check = canConnect(project, source, target);
  if (!check.ok) return check;
  const timestamp = now();
  const connection: FlowConnection = {
    id: createId('c'),
    projectId: project.id,
    source,
    target,
    type,
    label,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    ok: true,
    connection,
    project: {
      ...project,
      connections: [...project.connections, connection],
      updatedAt: timestamp,
    },
  };
}

export function updateConnection(
  project: Project,
  connectionId: string,
  patch: Partial<Pick<FlowConnection, 'label' | 'type'>>,
): Project {
  return {
    ...project,
    connections: project.connections.map((connection) =>
      connection.id === connectionId
        ? { ...connection, ...patch, updatedAt: now() }
        : connection,
    ),
    updatedAt: now(),
  };
}

export function deleteConnection(project: Project, connectionId: string): Project {
  return {
    ...project,
    connections: project.connections.filter((connection) => connection.id !== connectionId),
    updatedAt: now(),
  };
}

/** Hierarchy links plus explicit connections, for the "N links" counter. */
export function countLinks(project: Project): number {
  const hierarchyLinks = project.nodes.filter((node) => node.parentId !== null).length;
  return hierarchyLinks + project.connections.length;
}
