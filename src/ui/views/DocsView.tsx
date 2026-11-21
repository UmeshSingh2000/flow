import { useMemo } from 'react';
import { NODE_TYPE_LABELS } from '../../core/types';
import { useActiveProject, useFlowStore } from '../../state/store';
import { MarkdownView } from '../MarkdownView';
import { buildRows, matchesSearch } from './rows';

/** The whole project read as one document, with a coverage summary on top. */
export function DocsView() {
  const project = useActiveProject();
  const search = useFlowStore((state) => state.search);
  const selectNode = useFlowStore((state) => state.selectNode);
  const openInCanvas = useFlowStore((state) => state.openInCanvas);
  const openMarkdownEditor = useFlowStore((state) => state.openMarkdownEditor);

  const { rows, documented, withImages } = useMemo(() => {
    if (!project) return { rows: [], documented: 0, withImages: 0 };
    const all = buildRows(project);
    return {
      rows: all.filter((row) => matchesSearch(row.node, search)),
      documented: all.filter((row) => row.node.markdown.trim()).length,
      withImages: all.filter((row) => row.node.images.length > 0).length,
    };
  }, [project, search]);

  if (!project) return null;

  return (
    <div className="view-scroll docs-view">
      <div className="docs-summary">
        <span>
          <strong>{documented}</strong> of {project.nodes.length} nodes documented
        </span>
        <span className="dot-sep" aria-hidden>
          ·
        </span>
        <span>
          <strong>{withImages}</strong> with images
        </span>
        <span className="dot-sep" aria-hidden>
          ·
        </span>
        <span>documentation is stored locally with the project</span>
      </div>

      {rows.map((row) => (
        <article className="docs-entry" key={row.node.id}>
          <header className="docs-entry-head">
            <button
              type="button"
              className="docs-entry-title"
              onClick={() => selectNode(row.node.id)}
              onDoubleClick={() => openInCanvas(row.node.id)}
              title="Double-click to open on the canvas"
            >
              <span className={`type-dot type-dot-${row.node.type}`} aria-hidden />
              <span>{row.node.title}</span>
            </button>
            <span className="docs-entry-type">{NODE_TYPE_LABELS[row.node.type]}</span>
            <button
              type="button"
              className="markdown-edit-btn"
              onClick={() => openMarkdownEditor(row.node.id)}
            >
              {row.node.markdown.trim() ? 'Edit' : 'Write'}
            </button>
          </header>
          {row.node.description && (
            <p className="docs-entry-description">{row.node.description}</p>
          )}
          {row.node.markdown.trim() ? (
            <MarkdownView markdown={row.node.markdown} />
          ) : (
            <p className="hint">No Markdown notes yet.</p>
          )}
          {row.node.images.length > 0 && (
            <div className="docs-entry-images">
              {row.node.images.map((image) => (
                <img key={image.id} src={image.dataUrl} alt={image.name} />
              ))}
            </div>
          )}
        </article>
      ))}

      {rows.length === 0 && (
        <p className="view-empty">No nodes match “{search.trim()}”.</p>
      )}
    </div>
  );
}
