import type { NodeType } from '../core/types';

/** Fills used by the minimap and canvas chrome for each node type. */
export const NODE_COLORS: Record<NodeType, string> = {
  project: '#4f46e5',
  module: '#7c3aed',
  feature: '#2563eb',
  'sub-feature': '#0891b2',
  process: '#d97706',
  decision: '#db2777',
};

/**
 * Picks the node sides an edge should attach to: the sides that face the other
 * node along the dominant axis. This is presentation only; stored connections
 * keep just their node ids.
 */
export function facingHandles(
  from: { x: number; y: number } | undefined,
  to: { x: number; y: number } | undefined,
): { source: string; target: string } {
  if (!from || !to) return { source: 'right-source', target: 'left-target' };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { source: 'right-source', target: 'left-target' }
      : { source: 'left-source', target: 'right-target' };
  }
  return dy >= 0
    ? { source: 'bottom-source', target: 'top-target' }
    : { source: 'top-source', target: 'bottom-target' };
}
