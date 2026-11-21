/**
 * Guided tour definition. Pure data plus a few helpers that read a project,
 * so the tour can be unit-tested and reused without React or browser APIs.
 *
 * Each step highlights one control (`targets`, matched against `data-guide`
 * attributes) and, unless it is explanatory, only advances once the user has
 * actually performed the action (`requirement`).
 */

import type { Project } from '../core/types';

export type GuideRequirement =
  | 'project-created'
  | 'node-added'
  | 'child-added'
  | 'node-edited'
  | 'markdown-written'
  | 'connection-created'
  | 'viewport-moved';

export interface GuideStep {
  id: string;
  title: string;
  body: string;
  tips?: string[];
  /** `data-guide` values to spotlight, in priority order. Empty = centered card. */
  targets: string[];
  /** Action the user must complete. `null` for explanatory steps. */
  requirement: GuideRequirement | null;
  /** Label for the button on explanatory steps. */
  nextLabel?: string;
}

export const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Flow',
    body: 'This short tour builds a real project map with you. Each step highlights the one control you need — everything else stays locked until you use it.',
    tips: ['It takes about a minute.', 'You can leave at any point with Skip tour.'],
    targets: [],
    requirement: null,
    nextLabel: 'Start the tour',
  },
  {
    id: 'create-project',
    title: 'Create your first project',
    body: 'A project holds one map. Click New project, give it a name, and it is stored on this device straight away.',
    tips: ['No account and no upload — your work stays local.'],
    targets: ['new-project', 'new-project-canvas'],
    requirement: 'project-created',
  },
  {
    id: 'add-node',
    title: 'Add a node',
    body: 'Nodes are the building blocks of the map. Add node creates a child of the project root, the starting point of every map.',
    tips: ['Drag the node anywhere on the canvas afterwards.'],
    targets: ['add-node'],
    requirement: 'node-added',
  },
  {
    id: 'add-child',
    title: 'Nest child nodes',
    body: 'With a node selected, Add child node creates the next level down. Repeat to go from project → module → feature → step. Depth is unlimited.',
    tips: ['The project tree on the left mirrors the same hierarchy.'],
    targets: ['add-child'],
    requirement: 'child-added',
  },
  {
    id: 'edit-details',
    title: 'Document the node',
    body: 'Rename the node, pick its type, and add a one-line description. Longer notes belong in the Markdown section just below.',
    tips: [
      'A node type only changes its appearance — it never restricts connections.',
      'Attach images from the panel, or drop image files onto the canvas.',
    ],
    targets: ['node-details'],
    requirement: 'node-edited',
  },
  {
    id: 'markdown',
    title: 'Write Markdown notes',
    body: 'Click Write to open the full-screen Markdown workspace, then switch between Write and Preview to see the rendered result.',
    tips: ['Escape closes the editor and every keystroke is autosaved.'],
    targets: ['markdown'],
    requirement: 'markdown-written',
  },
  {
    id: 'connect',
    title: 'Connect two nodes',
    body: 'Drag from the right handle of one node onto the left handle of another. Connections are independent of hierarchy and can cross branches.',
    tips: [
      'Dropping a connector on empty canvas creates a connected node in one move.',
      'To disconnect later, hover the line and press its × — or use the × next to the entry in the node’s Connected nodes list.',
    ],
    targets: ['canvas'],
    requirement: 'connection-created',
  },
  {
    id: 'canvas-nav',
    title: 'Move around the canvas',
    body: 'Drag empty canvas to pan, scroll or use the +/− controls to zoom, and fit the graph to view whenever you lose your place.',
    tips: ['The minimap in the corner always shows the whole map.'],
    targets: ['canvas'],
    requirement: 'viewport-moved',
  },
  {
    id: 'save-export',
    title: 'Saves are automatic — keep backups too',
    body: 'Every change is written to this device as you work, and the status line reports when it is saved. Use the project menu to export a JSON backup, and Settings at the bottom left to import one back.',
    tips: [
      'Browser storage can be cleared by you or the browser, so export anything important.',
      'Settings is also where you can replay this tour.',
    ],
    targets: ['storage', 'project-menu'],
    requirement: null,
    nextLabel: 'Got it',
  },
  {
    id: 'done',
    title: 'You are ready',
    body: 'That is the whole loop: create a project, nest nodes, document them, and connect the pieces. The tour will not appear again unless you ask for it.',
    targets: [],
    requirement: null,
    nextLabel: 'Finish tour',
  },
];

export interface GuideContext {
  projectCount: number;
  nodeCount: number;
  maxDepth: number;
  connectionCount: number;
  hasMarkdown: boolean;
  /** Changes whenever any node's editable text or type changes. */
  nodesSignature: string;
}

/**
 * Depth of the deepest node below the project root, where the root itself is
 * depth 0 and its direct children are depth 1.
 */
export function projectMaxDepth(project: Project): number {
  const childrenOf = new Map<string | null, string[]>();
  for (const node of project.nodes) {
    const siblings = childrenOf.get(node.parentId) ?? [];
    siblings.push(node.id);
    childrenOf.set(node.parentId, siblings);
  }
  const root = project.nodes.find((node) => node.parentId === null);
  if (!root) return 0;
  let maxDepth = 0;
  const walk = (nodeId: string, depth: number) => {
    maxDepth = Math.max(maxDepth, depth);
    for (const childId of childrenOf.get(nodeId) ?? []) {
      walk(childId, depth + 1);
    }
  };
  walk(root.id, 0);
  return maxDepth;
}

/** Compact fingerprint of everything a user can edit on a node. */
export function nodesSignature(project: Project): string {
  return project.nodes
    .map((node) =>
      [
        node.id,
        node.type,
        node.title,
        node.description,
        node.markdown.length,
        Object.values(node.details).join('|'),
      ].join(':'),
    )
    .join(';');
}

export function isRequirementMet(
  requirement: GuideRequirement | null,
  context: GuideContext,
  baselineSignature: string,
  viewportMoved: boolean,
): boolean {
  switch (requirement) {
    case null:
      return false;
    case 'project-created':
      return context.projectCount > 0;
    case 'node-added':
      return context.nodeCount >= 2;
    case 'child-added':
      return context.maxDepth >= 2;
    case 'node-edited':
      return context.nodesSignature !== baselineSignature;
    case 'markdown-written':
      return context.hasMarkdown;
    case 'connection-created':
      return context.connectionCount > 0;
    case 'viewport-moved':
      return viewportMoved;
  }
}

/** Steps that need a node selected for their target control to exist. */
export function stepNeedsSelection(step: GuideStep): boolean {
  return ['add-child', 'edit-details', 'markdown'].includes(step.id);
}
