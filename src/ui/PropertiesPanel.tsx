import { getRootNode, isDescendant } from '../core/graph';
import {
  CONNECTION_TYPES,
  CONNECTION_TYPE_LABELS,
  DETAIL_FIELDS,
  NODE_TYPES,
  NODE_TYPE_LABELS,
} from '../core/types';
import type {
  ConnectionType,
  DetailKey,
  NodeDetails,
  NodeType,
} from '../core/types';
import {
  useActiveProject,
  useFlowStore,
  useSelectedConnection,
  useSelectedNode,
} from '../state/store';
import { IconCopy, IconPencil, IconPlus, IconTrash, IconX } from './icons';
import { MarkdownView } from './MarkdownView';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PropertiesPanel() {
  const project = useActiveProject();
  const node = useSelectedNode();
  const connection = useSelectedConnection();

  const selectNode = useFlowStore((state) => state.selectNode);
  const selectConnection = useFlowStore((state) => state.selectConnection);
  const updateNode = useFlowStore((state) => state.updateNode);
  const duplicateNode = useFlowStore((state) => state.duplicateNode);
  const updateConnection = useFlowStore((state) => state.updateConnection);
  const deleteConnection = useFlowStore((state) => state.deleteConnection);
  const reparentNode = useFlowStore((state) => state.reparentNode);
  const addNode = useFlowStore((state) => state.addNode);
  const openDialog = useFlowStore((state) => state.openDialog);
  const requestFocus = useFlowStore((state) => state.requestFocus);
  const openMarkdownEditor = useFlowStore((state) => state.openMarkdownEditor);

  if (node && project) {
    const rootNode = getRootNode(project);
    const isRoot = rootNode?.id === node.id;
    const parentCandidates = project.nodes.filter(
      (candidate) =>
        candidate.id !== node.id && !isDescendant(project, node.id, candidate.id),
    );
    const links = project.connections.filter(
      (candidate) => candidate.source === node.id || candidate.target === node.id,
    );
    const detailCount = Object.values(node.details).filter(
      (value) => value.trim().length > 0,
    ).length;

    return (
      <aside className="properties" aria-label="Node details">
        <header className="panel-head">
          <div>
            <div className="eyebrow">NODE DETAILS</div>
            <h2>Properties</h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close details"
            onClick={() => selectNode(null)}
          >
            <IconX size={14} />
          </button>
        </header>

        <div className="panel-body">
          <label className="field">
            <span>Name</span>
            <input
              data-guide="node-details"
              value={node.title}
              onChange={(event) => updateNode(node.id, { title: event.target.value })}
              placeholder="Node name"
            />
          </label>

          <label className="field">
            <span>Type</span>
            <select
              value={node.type}
              onChange={(event) =>
                updateNode(node.id, { type: event.target.value as NodeType })
              }
            >
              {NODE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {NODE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Description</span>
            <textarea
              rows={3}
              value={node.description}
              onChange={(event) =>
                updateNode(node.id, { description: event.target.value })
              }
              placeholder="One line about what this covers"
            />
          </label>

          <section className="markdown-section">
            <div className="section-title">
              <span>Markdown</span>
              <button
                type="button"
                className="markdown-edit-btn"
                data-guide="markdown"
                onClick={() => openMarkdownEditor(node.id)}
              >
                <IconPencil size={11} /> {node.markdown?.trim() ? 'Edit' : 'Write'}
              </button>
            </div>
            {node.markdown?.trim() ? (
              <div className="markdown-preview">
                <MarkdownView markdown={node.markdown} />
              </div>
            ) : (
              <button
                type="button"
                className="markdown-empty"
                onClick={() => openMarkdownEditor(node.id)}
              >
                Add Markdown documentation for this node…
              </button>
            )}
          </section>

          <label className="field">
            <span>Parent node</span>
            <select
              value={node.parentId ?? ''}
              disabled={isRoot}
              onChange={(event) => {
                const value = event.target.value;
                reparentNode(node.id, value === '' ? null : value);
              }}
            >
              <option value="">{isRoot ? 'Top-level node (project root)' : 'Top-level node'}</option>
              {parentCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </option>
              ))}
            </select>
            {isRoot && (
              <p className="hint">The project root always sits at the top of the hierarchy.</p>
            )}
          </label>

          <details className="docs-section" open>
            <summary>
              <span>Documentation</span>
              <span className="count">{detailCount}/8</span>
            </summary>
            <div className="docs-fields">
              {DETAIL_FIELDS.map((field) => (
                <label className="field" key={field.key}>
                  <span>{field.label}</span>
                  <textarea
                    rows={2}
                    value={node.details[field.key]}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      updateNode(node.id, {
                        details: {
                          [field.key]: event.target.value,
                        } as Partial<Record<DetailKey, string>> as Partial<NodeDetails>,
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </details>

          <section className="linked-section">
            <div className="section-title">
              <span>Connected nodes</span>
              <span className="count">{links.length}</span>
            </div>
            {links.length === 0 ? (
              <p className="hint">
                Drag from a node handle on the canvas to create a cross-branch connection.
              </p>
            ) : (
              <ul className="linked-list">
                {links.map((link) => {
                  const outgoing = link.source === node.id;
                  const otherId = outgoing ? link.target : link.source;
                  const other = project.nodes.find(
                    (candidate) => candidate.id === otherId,
                  );
                  if (!other) return null;
                  const label =
                    link.label.trim() ||
                    (link.type ? CONNECTION_TYPE_LABELS[link.type] : '');
                  return (
                    <li key={link.id}>
                      <button
                        type="button"
                        className="linked-item"
                        onClick={() => {
                          selectConnection(link.id);
                          requestFocus(other.id);
                        }}
                      >
                        <span className="linked-arrow" aria-hidden>
                          {outgoing ? '→' : '←'}
                        </span>
                        <span className="linked-name">{other.title}</span>
                        {label && <span className="linked-label">{label}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <p className="meta-line">Updated {formatDate(node.updatedAt)}</p>
        </div>

        <footer className="panel-footer">
          <button
            type="button"
            className="btn btn-block"
            data-guide="add-child"
            onClick={() => addNode(node.id)}
          >
            <IconPlus size={14} /> Add child node
          </button>
          <div className="panel-footer-row">
            <button
              type="button"
              className="btn"
              disabled={isRoot}
              title={isRoot ? 'The project root cannot be duplicated.' : undefined}
              onClick={() => duplicateNode(node.id)}
            >
              <IconCopy size={13} /> Duplicate
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={isRoot}
              title={isRoot ? 'Delete the project instead of its root node.' : undefined}
              onClick={() => openDialog({ kind: 'delete-node', id: node.id })}
            >
              <IconTrash size={13} /> Delete
            </button>
          </div>
        </footer>
      </aside>
    );
  }

  if (connection && project) {
    const source = project.nodes.find((candidate) => candidate.id === connection.source);
    const target = project.nodes.find((candidate) => candidate.id === connection.target);

    return (
      <aside className="properties" aria-label="Connection details">
        <header className="panel-head">
          <div>
            <div className="eyebrow">CONNECTION DETAILS</div>
            <h2>Relationship</h2>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close details"
            onClick={() => selectConnection(null)}
          >
            <IconX size={14} />
          </button>
        </header>

        <div className="panel-body">
          <div className="connection-endpoints">
            <span>{source?.title ?? 'Unknown'}</span>
            <span className="linked-arrow" aria-hidden>
              →
            </span>
            <span>{target?.title ?? 'Unknown'}</span>
          </div>

          <label className="field">
            <span>Label</span>
            <input
              value={connection.label}
              placeholder="Optional label"
              onChange={(event) =>
                updateConnection(connection.id, { label: event.target.value })
              }
            />
          </label>

          <label className="field">
            <span>Relationship type</span>
            <select
              value={connection.type ?? ''}
              onChange={(event) =>
                updateConnection(connection.id, {
                  type:
                    event.target.value === ''
                      ? null
                      : (event.target.value as ConnectionType),
                })
              }
            >
              <option value="">No type</option>
              {CONNECTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {CONNECTION_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>

          <p className="hint">
            Connections are stored separately from hierarchy, so they can cross branches
            and survive re-parenting.
          </p>
          <p className="meta-line">Updated {formatDate(connection.updatedAt)}</p>
        </div>

        <footer className="panel-footer">
          <button
            type="button"
            className="btn btn-danger btn-block"
            onClick={() => deleteConnection(connection.id)}
          >
            <IconTrash size={13} /> Delete connection
          </button>
        </footer>
      </aside>
    );
  }

  // Collapsed when nothing is selected: the canvas uses the space instead.
  return null;
}
