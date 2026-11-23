import { useEffect } from 'react';
import { getRootNode } from '../core/graph';
import {
  CONNECTION_TYPE_LABELS,
  DETAIL_FIELDS,
  NODE_TYPE_LABELS,
} from '../core/types';
import type {
  FlowConnection,
  FlowNode,
  Project,
} from '../core/types';
import { IconX } from './icons';
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

export interface SharedImageViewerState {
  nodeId: string;
  imageId: string;
}

/** Read-only properties panel for the guest viewer. */
export function SharedProperties({
  project,
  node,
  connection,
  onCloseNode,
  onCloseConnection,
  onOpenNode,
  onOpenImage,
}: {
  project: Project;
  node: FlowNode | null;
  connection: FlowConnection | null;
  onCloseNode(): void;
  onCloseConnection(): void;
  onOpenNode(nodeId: string): void;
  onOpenImage(nodeId: string, imageId: string): void;
}) {
  if (node) {
    const rootNode = getRootNode(project);
    const isRoot = rootNode?.id === node.id;
    const parent = node.parentId
      ? project.nodes.find((candidate) => candidate.id === node.parentId)
      : null;
    const links = project.connections.filter(
      (candidate) => candidate.source === node.id || candidate.target === node.id,
    );
    const detailCount = Object.values(node.details).filter(
      (value) => value.trim().length > 0,
    ).length;

    return (
      <aside className="properties shared-properties" aria-label="Node details">
        <header className="panel-head">
          <div>
            <div className="eyebrow">NODE DETAILS</div>
            <h2>Properties</h2>
          </div>
          <div className="panel-head-tools">
            <span className="read-only-badge">Read-only</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Close details"
              onClick={onCloseNode}
            >
              <IconX size={14} />
            </button>
          </div>
        </header>

        <div className="panel-body">
          <div className="shared-detail-title">{node.title}</div>

          <div className="field readonly-field">
            <span>Type</span>
            <p className="readonly-value type-value">
              <span className={`type-dot type-dot-${node.type}`} aria-hidden />
              {NODE_TYPE_LABELS[node.type]}
            </p>
          </div>

          {node.description.trim() && (
            <div className="field readonly-field">
              <span>Description</span>
              <p className="readonly-value">{node.description}</p>
            </div>
          )}

          <section className="markdown-section">
            <div className="section-title">
              <span>Markdown</span>
            </div>
            {node.markdown?.trim() ? (
              <div className="markdown-preview">
                <MarkdownView markdown={node.markdown} />
              </div>
            ) : (
              <p className="hint">No Markdown documentation.</p>
            )}
          </section>

          {node.images.length > 0 && (
            <section className="images-section">
              <div className="section-title">
                <span>Images</span>
                <span className="count">{node.images.length}</span>
              </div>
              <ul className="image-grid">
                {node.images.map((image) => (
                  <li key={image.id} className="image-cell">
                    <button
                      type="button"
                      className="image-thumb"
                      title={`View ${image.name}`}
                      onClick={() => onOpenImage(node.id, image.id)}
                    >
                      <img src={image.dataUrl} alt={image.name} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="field readonly-field">
            <span>Parent node</span>
            <p className="readonly-value">
              {isRoot
                ? 'Top-level node (project root)'
                : parent
                  ? parent.title
                  : 'Top-level node'}
            </p>
          </div>

          <details className="docs-section" open>
            <summary>
              <span>Documentation</span>
              <span className="count">{detailCount}/8</span>
            </summary>
            <div className="docs-fields">
              {DETAIL_FIELDS.map((field) => (
                <div className="field readonly-field" key={field.key}>
                  <span>{field.label}</span>
                  <p className="readonly-value">
                    {node.details[field.key].trim() || '—'}
                  </p>
                </div>
              ))}
            </div>
          </details>

          <section className="linked-section">
            <div className="section-title">
              <span>Connected nodes</span>
              <span className="count">{links.length}</span>
            </div>
            {links.length === 0 ? (
              <p className="hint">This node has no graph connections.</p>
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
                    <li key={link.id} className="linked-item">
                      <button
                        type="button"
                        className="linked-open"
                        onClick={() => onOpenNode(other.id)}
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
      </aside>
    );
  }

  if (connection) {
    const source = project.nodes.find(
      (candidate) => candidate.id === connection.source,
    );
    const target = project.nodes.find(
      (candidate) => candidate.id === connection.target,
    );

    return (
      <aside className="properties shared-properties" aria-label="Connection details">
        <header className="panel-head">
          <div>
            <div className="eyebrow">CONNECTION DETAILS</div>
            <h2>Relationship</h2>
          </div>
          <div className="panel-head-tools">
            <span className="read-only-badge">Read-only</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Close details"
              onClick={onCloseConnection}
            >
              <IconX size={14} />
            </button>
          </div>
        </header>

        <div className="panel-body">
          <div className="connection-endpoints">
            <span>{source?.title ?? 'Unknown'}</span>
            <span className="linked-arrow" aria-hidden>
              →
            </span>
            <span>{target?.title ?? 'Unknown'}</span>
          </div>

          <div className="field readonly-field">
            <span>Label</span>
            <p className="readonly-value">{connection.label.trim() || '—'}</p>
          </div>

          <div className="field readonly-field">
            <span>Relationship type</span>
            <p className="readonly-value">
              {connection.type ? CONNECTION_TYPE_LABELS[connection.type] : 'No type'}
            </p>
          </div>

          <p className="hint">
            Connections are stored separately from hierarchy, so they can cross
            branches and survive re-parenting.
          </p>
          <p className="meta-line">Updated {formatDate(connection.updatedAt)}</p>
        </div>
      </aside>
    );
  }

  return null;
}

/** Full-screen lightbox for the guest viewer. */
export function SharedImageViewer({
  project,
  viewer,
  onClose,
}: {
  project: Project;
  viewer: SharedImageViewerState | null;
  onClose(): void;
}) {
  useEffect(() => {
    if (!viewer) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [viewer, onClose]);

  if (!viewer) return null;
  const node = project.nodes.find((candidate) => candidate.id === viewer.nodeId);
  const image = node?.images.find((candidate) => candidate.id === viewer.imageId);
  if (!node || !image) return null;

  return (
    <div className="image-viewer" role="dialog" aria-modal="true" aria-label={image.name}>
      <div className="image-viewer-scrim" onClick={onClose} />
      <figure className="image-viewer-frame">
        <img src={image.dataUrl} alt={image.name} />
        <figcaption>
          <span className="image-viewer-name">{image.name}</span>
          <span className="image-viewer-meta">
            attached to “{node.title}”
            {image.width > 0 ? ` · ${image.width}×${image.height}` : ''}
          </span>
        </figcaption>
      </figure>
      <button
        type="button"
        className="image-viewer-close"
        aria-label="Close image"
        onClick={onClose}
      >
        <IconX size={16} />
      </button>
    </div>
  );
}
