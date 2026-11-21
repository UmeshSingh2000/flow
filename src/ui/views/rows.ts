import type { FlowNode, Project } from '../../core/types';

export interface NodeRow {
  node: FlowNode;
  parent: FlowNode | null;
  children: number;
  connections: number;
  depth: number;
  /** Position in the map (depth-first from the roots), used as the default order. */
  order: number;
}

/** Flattens the project into rows the table, board and docs views all share. */
export function buildRows(project: Project): NodeRow[] {
  const byId = new Map(project.nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string | null, FlowNode[]>();
  for (const node of project.nodes) {
    const key = node.parentId && byId.has(node.parentId) ? node.parentId : null;
    const siblings = childrenOf.get(key) ?? [];
    siblings.push(node);
    childrenOf.set(key, siblings);
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort((a, b) => a.position.y - b.position.y || a.title.localeCompare(b.title));
  }

  const connectionCount = new Map<string, number>();
  for (const connection of project.connections) {
    connectionCount.set(connection.source, (connectionCount.get(connection.source) ?? 0) + 1);
    connectionCount.set(connection.target, (connectionCount.get(connection.target) ?? 0) + 1);
  }

  const rows: NodeRow[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    for (const node of childrenOf.get(parentId) ?? []) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      rows.push({
        node,
        parent: node.parentId ? (byId.get(node.parentId) ?? null) : null,
        children: (childrenOf.get(node.id) ?? []).length,
        connections: connectionCount.get(node.id) ?? 0,
        depth,
        order: rows.length,
      });
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);

  // Defensive: surface any node whose parent chain was broken rather than hiding it.
  for (const node of project.nodes) {
    if (seen.has(node.id)) continue;
    rows.push({
      node,
      parent: null,
      children: 0,
      connections: connectionCount.get(node.id) ?? 0,
      depth: 0,
      order: rows.length,
    });
  }

  return rows;
}

export function matchesSearch(node: FlowNode, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    node.title.toLowerCase().includes(needle) ||
    node.description.toLowerCase().includes(needle) ||
    node.markdown.toLowerCase().includes(needle)
  );
}
