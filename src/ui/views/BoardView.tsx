import { useMemo } from 'react';
import { NODE_TYPES, NODE_TYPE_LABELS } from '../../core/types';
import { useActiveProject, useFlowStore } from '../../state/store';
import { buildRows, matchesSearch } from './rows';

/** Nodes grouped into a column per type — handy for spotting gaps at a glance. */
export function BoardView() {
  const project = useActiveProject();
  const search = useFlowStore((state) => state.search);
  const selectedNodeId = useFlowStore((state) => state.selectedNodeId);
  const selectNode = useFlowStore((state) => state.selectNode);
  const openInCanvas = useFlowStore((state) => state.openInCanvas);

  const columns = useMemo(() => {
    if (!project) return [];
    const rows = buildRows(project).filter((row) => matchesSearch(row.node, search));
    return NODE_TYPES.map((type) => ({
      type,
      rows: rows.filter((row) => row.node.type === type),
    })).filter((column) => column.rows.length > 0);
  }, [project, search]);

  if (!project) return null;

  return (
    <div className="board">
      {columns.map((column) => (
        <section className="board-column" key={column.type}>
          <header className="board-column-head">
            <span className={`type-dot type-dot-${column.type}`} aria-hidden />
            <span>{NODE_TYPE_LABELS[column.type]}</span>
            <span className="board-count">{column.rows.length}</span>
          </header>
          <div className="board-cards">
            {column.rows.map((row) => (
              <button
                key={row.node.id}
                type="button"
                className={`board-card${row.node.id === selectedNodeId ? ' is-selected' : ''}`}
                onClick={() => selectNode(row.node.id)}
                onDoubleClick={() => openInCanvas(row.node.id)}
                title="Double-click to open on the canvas"
              >
                <span className="board-card-title">{row.node.title}</span>
                {row.node.description && (
                  <span className="board-card-description">{row.node.description}</span>
                )}
                <span className="board-card-meta">
                  {row.parent && <span>in {row.parent.title}</span>}
                  {row.children > 0 && (
                    <span>
                      {row.children} child{row.children === 1 ? '' : 'ren'}
                    </span>
                  )}
                  {row.connections > 0 && <span>{row.connections} link{row.connections === 1 ? '' : 's'}</span>}
                  {row.node.markdown.trim() && <span className="doc-badge">Markdown</span>}
                  {row.node.images.length > 0 && (
                    <span className="doc-badge">{row.node.images.length} img</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {columns.length === 0 && (
        <p className="view-empty">No nodes match “{search.trim()}”.</p>
      )}
    </div>
  );
}
