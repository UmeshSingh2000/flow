import { useMemo } from 'react';
import { getAncestorIds } from '../core/graph';
import type { FlowNode, Project } from '../core/types';
import { useActiveProject, useFlowStore } from '../state/store';
import { IconChevronRight } from './icons';

interface TreeRow {
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

export function ProjectTree() {
  const project = useActiveProject();
  const selectedNodeId = useFlowStore((state) => state.selectedNodeId);
  const expandedIds = useFlowStore((state) => state.expandedIds);
  const search = useFlowStore((state) => state.search);
  const selectNode = useFlowStore((state) => state.selectNode);
  const requestFocus = useFlowStore((state) => state.requestFocus);
  const toggleExpanded = useFlowStore((state) => state.toggleExpanded);

  const rows = useMemo<TreeRow[]>(() => {
    if (!project) return [];
    const childrenMap = buildChildrenMap(project);
    const query = search.trim().toLowerCase();
    let allowed: Set<string> | null = null;

    if (query) {
      allowed = new Set<string>();
      for (const node of project.nodes) {
        if (
          node.title.toLowerCase().includes(query) ||
          node.description.toLowerCase().includes(query)
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
  }, [project, search, expandedIds]);

  if (!project) {
    return <p className="tree-empty">Create a project to see its structure.</p>;
  }
  if (rows.length === 0) {
    return <p className="tree-empty">No nodes match “{search.trim()}”.</p>;
  }

  return (
    <nav className="tree" aria-label="Project structure">
      {rows.map(({ node, depth, hasChildren }) => {
        const isSelected = node.id === selectedNodeId;
        const isExpanded = expandedIds[node.id] !== false;
        return (
          <div
            key={node.id}
            className={`tree-row${isSelected ? ' is-selected' : ''}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            role="treeitem"
            aria-selected={isSelected}
            aria-expanded={hasChildren ? isExpanded : undefined}
            tabIndex={0}
            onClick={() => {
              selectNode(node.id);
              requestFocus(node.id);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                selectNode(node.id);
                requestFocus(node.id);
              }
            }}
          >
            {hasChildren ? (
              <button
                type="button"
                className={`tree-chevron${isExpanded ? ' is-open' : ''}`}
                aria-label={isExpanded ? 'Collapse branch' : 'Expand branch'}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleExpanded(node.id);
                }}
              >
                <IconChevronRight size={10} />
              </button>
            ) : (
              <span className="tree-chevron-spacer" />
            )}
            <span className={`type-dot type-dot-${node.type}`} aria-hidden />
            <span className="tree-title">{node.title}</span>
          </div>
        );
      })}
    </nav>
  );
}
