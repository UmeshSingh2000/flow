/**
 * Deterministic canvas layout.
 *
 * Plan-driven documentation creates nodes one at a time, which leaves a
 * staircase of positions that is correct but hard to read. This module computes
 * a tidy left-to-right tree layout from the hierarchy alone. Canvas positions
 * remain presentation data: hierarchy and connections are never changed.
 *
 * Like the rest of `src/core`, this has no React or browser dependencies so the
 * layout can be reused by a future VS Code view or an exported renderer.
 */

import { LEVEL_GAP, NODE_CARD_WIDTH } from './graph';
import type { FlowNode, Point, Project } from './types';

/** Height used when the canvas has not measured a node yet. */
export const DEFAULT_NODE_HEIGHT = 78;
/** Vertical breathing room between sibling subtrees. */
export const AUTO_LAYOUT_ROW_GAP = 28;
/** Space between top-level groups (normally there is only the project root). */
export const AUTO_LAYOUT_ROOT_GAP = 56;
export const AUTO_LAYOUT_MARGIN = 40;

export interface AutoLayoutOptions {
  /** Measured node heights, keyed by node id. Missing entries use the default. */
  nodeHeights?: Readonly<Record<string, number>>;
  /** Vertical gap between sibling subtrees. */
  rowGap?: number;
  /** Horizontal gap between hierarchy levels. */
  columnGap?: number;
  /** Padding around the laid-out tree. */
  margin?: number;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

/** Sibling order matches the tree: current vertical position, then title. */
function byCanvasOrder(a: FlowNode, b: FlowNode): number {
  return (
    a.position.y - b.position.y ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Returns new positions for every node in the project.
 *
 * Parents sit to the left of their children and are vertically centred on the
 * block of their descendants. A parentless or orphaned node is treated as a
 * top-level root, so even a partially damaged project still lays out.
 */
export function computeAutoLayout(
  project: Project,
  options: AutoLayoutOptions = {},
): Record<string, Point> {
  const rowGap = finiteOr(options.rowGap, AUTO_LAYOUT_ROW_GAP);
  const columnGap = finiteOr(options.columnGap, LEVEL_GAP);
  const margin = finiteOr(options.margin, AUTO_LAYOUT_MARGIN);
  const heights = options.nodeHeights;

  const heightOf = (node: FlowNode): number => {
    const measured = heights?.[node.id];
    return typeof measured === 'number' && Number.isFinite(measured) && measured > 0
      ? measured
      : DEFAULT_NODE_HEIGHT;
  };

  const byId = new Map(project.nodes.map((node) => [node.id, node]));
  const children = new Map<string, FlowNode[]>();
  const roots: FlowNode[] = [];

  for (const node of project.nodes) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && parent.id !== node.id) {
      const siblings = children.get(parent.id) ?? [];
      siblings.push(node);
      children.set(parent.id, siblings);
    } else {
      roots.push(node);
    }
  }

  for (const siblings of children.values()) siblings.sort(byCanvasOrder);
  roots.sort(byCanvasOrder);

  const positions: Record<string, Point> = {};
  const placed = new Set<string>();
  const subtreeHeights = new Map<string, number>();

  const subtreeHeight = (node: FlowNode, stack: Set<string>): number => {
    const cached = subtreeHeights.get(node.id);
    if (cached !== undefined) return cached;
    // Defensive: malformed data must not recurse forever.
    if (stack.has(node.id)) return heightOf(node);
    stack.add(node.id);
    const kids = children.get(node.id) ?? [];
    let content = 0;
    if (kids.length > 0) {
      for (const kid of kids) content += subtreeHeight(kid, stack);
      content += rowGap * (kids.length - 1);
    }
    stack.delete(node.id);
    const height = Math.max(heightOf(node), content);
    subtreeHeights.set(node.id, height);
    return height;
  };

  const place = (
    node: FlowNode,
    depth: number,
    top: number,
    stack: Set<string>,
  ): void => {
    if (placed.has(node.id)) return;
    const height = heightOf(node);
    const x = margin + depth * (NODE_CARD_WIDTH + columnGap);

    if (stack.has(node.id)) {
      positions[node.id] = { x, y: top };
      placed.add(node.id);
      return;
    }

    const kids = children.get(node.id) ?? [];
    const span = subtreeHeight(node, new Set());
    let childrenHeight = 0;
    for (const kid of kids) childrenHeight += subtreeHeight(kid, new Set());
    if (kids.length > 1) childrenHeight += rowGap * (kids.length - 1);

    stack.add(node.id);
    let cursor = top + Math.max(0, (span - childrenHeight) / 2);
    for (const kid of kids) {
      place(kid, depth + 1, cursor, stack);
      cursor += subtreeHeight(kid, new Set()) + rowGap;
    }
    stack.delete(node.id);

    positions[node.id] = { x, y: top + Math.max(0, (span - height) / 2) };
    placed.add(node.id);
  };

  let cursor = margin;
  const placeRoot = (node: FlowNode): void => {
    const span = subtreeHeight(node, new Set());
    place(node, 0, cursor, new Set());
    cursor += span + AUTO_LAYOUT_ROOT_GAP;
  };

  for (const root of roots) placeRoot(root);

  // A corrupt hierarchy (for example a cycle) may leave nodes unreachable from
  // any root. Place them as their own top-level groups rather than losing them.
  for (const node of project.nodes) {
    if (!placed.has(node.id)) placeRoot(node);
  }

  return positions;
}
