import { useMemo } from 'react';
import { useActiveProject, useFlowStore } from '../state/store';
import { IconChevronRight } from './icons';
import { buildTreeRows } from './treeModel';

export function ProjectTree() {
  const project = useActiveProject();
  const selectedNodeId = useFlowStore((state) => state.selectedNodeId);
  const expandedIds = useFlowStore((state) => state.expandedIds);
  const search = useFlowStore((state) => state.search);
  const selectNode = useFlowStore((state) => state.selectNode);
  const requestFocus = useFlowStore((state) => state.requestFocus);
  const toggleExpanded = useFlowStore((state) => state.toggleExpanded);

  const rows = useMemo(
    () => (project ? buildTreeRows(project, search, expandedIds) : []),
    [project, search, expandedIds],
  );

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
