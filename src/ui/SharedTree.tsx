import { useMemo, useState } from 'react';
import type { Project } from '../core/types';
import { IconChevronRight, IconSearch, IconX } from './icons';
import { buildTreeRows } from './treeModel';

/** Read-only mirror of the project tree: navigation and expand/collapse only. */
export function SharedTree({
  project,
  selectedNodeId,
  onSelectNode,
}: {
  project: Project;
  selectedNodeId: string | null;
  onSelectNode(nodeId: string): void;
}) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState('');

  const rows = useMemo(
    () => buildTreeRows(project, search, expandedIds),
    [project, search, expandedIds],
  );

  const toggleExpanded = (nodeId: string) => {
    setExpandedIds((current) => ({
      ...current,
      [nodeId]: current[nodeId] === false,
    }));
  };

  return (
    <>
      <div className="search-box">
        <IconSearch size={13} className="search-icon" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search nodes..."
          aria-label="Search nodes by title or description"
        />
        {search && (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search"
            onClick={() => setSearch('')}
          >
            <IconX size={11} />
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="tree-empty">
          {search.trim() ? `No nodes match “${search.trim()}”.` : 'This project has no nodes.'}
        </p>
      ) : (
        <nav className="tree" aria-label="Project structure">
          {rows.map(({ node, depth, hasChildren }) => {
            const isSelected = node.id === selectedNodeId;
            const isExpanded = search.trim() ? true : expandedIds[node.id] !== false;
            return (
              <div
                key={node.id}
                className={`tree-row${isSelected ? ' is-selected' : ''}`}
                style={{ paddingLeft: 6 + depth * 14 }}
                role="treeitem"
                aria-selected={isSelected}
                aria-expanded={hasChildren ? isExpanded : undefined}
                tabIndex={0}
                onClick={() => onSelectNode(node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectNode(node.id);
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
      )}
    </>
  );
}
