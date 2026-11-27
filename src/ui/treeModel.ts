import { getAncestorIds } from '../core/graph';
import type { FlowNode, Project } from '../core/types';

export interface TreeRow {
  node: FlowNode;
  depth: number;
  hasChildren: boolean;
}

function buildChildrenMap(project: Project): Map<string | null, FlowNode[]> {
  const ids = new Set(project.nodes.map((node) => node.id));
  const map = new Map<string | null, FlowNode[]>();
  for (const node of project.nodes) {
    const key = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    const list = map.get(key);
    if (list) list.push(node);
    else map.set(key, [node]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.position.y - b.position.y || a.title.localeCompare(b.title));
  }
  return map;
}

/**
 * Flattens the hierarchy into visible rows. A search keeps matching nodes and
 * their ancestors, and forces matching branches open. `expandedIds` treats a
 * missing key as expanded, so new nodes are visible by default.
 */
export function buildTreeRows(
  project: Project,
  search: string,
  expandedIds: Record<string, boolean>,
): TreeRow[] {
  const childrenMap = buildChildrenMap(project);
  const query = search.trim().toLowerCase();
  let allowed: Set<string> | null = null;

  if (query) {
    allowed = new Set<string>();
    for (const node of project.nodes) {
      if (
        node.title.toLowerCase().includes(query) ||
        node.description.toLowerCase().includes(query) ||
        node.id.toLowerCase().includes(query)
      ) {
        allowed.add(node.id);
        for (const ancestorId of getAncestorIds(project, node.id)) {
          allowed.add(ancestorId);
        }
      }
    }
  }

  const result: TreeRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const node of childrenMap.get(parentId) ?? []) {
      if (allowed && !allowed.has(node.id)) continue;
      const children = childrenMap.get(node.id) ?? [];
      result.push({ node, depth, hasChildren: children.length > 0 });
      const isExpanded = query ? true : expandedIds[node.id] !== false;
      if (children.length > 0 && isExpanded) {
        walk(node.id, depth + 1);
      }
    }
  };
  walk(null, 0);
  return result;
}
