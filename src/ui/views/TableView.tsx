import { useMemo, useState } from 'react';
import { NODE_TYPE_LABELS } from '../../core/types';
import { useActiveProject, useFlowStore } from '../../state/store';
import { buildRows, matchesSearch } from './rows';
import type { NodeRow } from './rows';

type SortKey =
  | 'order'
  | 'title'
  | 'type'
  | 'parent'
  | 'children'
  | 'connections'
  | 'updated';

const SORTERS: Record<SortKey, (a: NodeRow, b: NodeRow) => number> = {
  order: (a, b) => a.order - b.order,
  title: (a, b) => a.node.title.localeCompare(b.node.title),
  type: (a, b) =>
    NODE_TYPE_LABELS[a.node.type].localeCompare(NODE_TYPE_LABELS[b.node.type]) ||
    a.node.title.localeCompare(b.node.title),
  parent: (a, b) => (a.parent?.title ?? '').localeCompare(b.parent?.title ?? ''),
  children: (a, b) => a.children - b.children,
  connections: (a, b) => a.connections - b.connections,
  updated: (a, b) => a.node.updatedAt.localeCompare(b.node.updatedAt),
};

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: 'title', label: 'Node' },
  { key: 'type', label: 'Type' },
  { key: 'parent', label: 'Parent' },
  { key: 'children', label: 'Children', className: 'is-numeric' },
  { key: 'connections', label: 'Links', className: 'is-numeric' },
  { key: 'updated', label: 'Updated', className: 'is-numeric' },
];

export function TableView() {
  const project = useActiveProject();
  const search = useFlowStore((state) => state.search);
  const selectedNodeId = useFlowStore((state) => state.selectedNodeId);
  const selectNode = useFlowStore((state) => state.selectNode);
  const openInCanvas = useFlowStore((state) => state.openInCanvas);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'order',
    dir: 'asc',
  });

  const rows = useMemo(() => {
    if (!project) return [];
    const all = buildRows(project).filter((row) => matchesSearch(row.node, search));
    const sorter = SORTERS[sort.key];
    const sorted = [...all].sort(sorter);
    return sort.dir === 'desc' ? sorted.reverse() : sorted;
  }, [project, search, sort]);

  if (!project) return null;

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  };

  return (
    <div className="view-scroll">
      <table className="node-table">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                className={column.className}
                aria-sort={
                  sort.key === column.key
                    ? sort.dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <button type="button" onClick={() => toggleSort(column.key)}>
                  {column.label}
                  {sort.key === column.key && (
                    <span className="sort-mark">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </th>
            ))}
            <th>Documentation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.node.id}
              className={row.node.id === selectedNodeId ? 'is-selected' : undefined}
              onClick={() => selectNode(row.node.id)}
              onDoubleClick={() => openInCanvas(row.node.id)}
              title="Double-click to open on the canvas"
            >
              <td>
                <span
                  className="title-cell"
                  style={{ paddingLeft: Math.min(row.depth, 6) * 12 }}
                >
                  <span className={`type-dot type-dot-${row.node.type}`} aria-hidden />
                  <span className="table-title">{row.node.title}</span>
                </span>
                {row.node.description && (
                  <span className="table-description">{row.node.description}</span>
                )}
              </td>
              <td>{NODE_TYPE_LABELS[row.node.type]}</td>
              <td className="is-muted">{row.parent?.title ?? '—'}</td>
              <td className="is-numeric">{row.children}</td>
              <td className="is-numeric">{row.connections}</td>
              <td className="is-numeric is-muted">
                {new Date(row.node.updatedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </td>
              <td>
                <span className="doc-badges">
                  {row.node.markdown.trim() && <span className="doc-badge">Markdown</span>}
                  {row.node.images.length > 0 && (
                    <span className="doc-badge">
                      {row.node.images.length} image{row.node.images.length === 1 ? '' : 's'}
                    </span>
                  )}
                  {Object.values(row.node.details).some((value) => value.trim()) && (
                    <span className="doc-badge">Fields</span>
                  )}
                  {!row.node.markdown.trim() &&
                    row.node.images.length === 0 &&
                    !Object.values(row.node.details).some((value) => value.trim()) && (
                      <span className="is-muted">—</span>
                    )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="view-empty">No nodes match “{search.trim()}”.</p>
      )}
    </div>
  );
}
