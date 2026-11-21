import { useEffect, useRef, useState } from 'react';
import { useActiveProject, useFlowStore } from '../state/store';
import { IconX } from './icons';
import { MarkdownView } from './MarkdownView';

type EditorMode = 'write' | 'preview';

/**
 * Full-screen Markdown workspace for a single node, animated up from the
 * bottom. Write and Preview are separate modes toggled from the header.
 * Edits go straight through the store, so autosave applies as usual.
 */
export function MarkdownEditor() {
  const nodeId = useFlowStore((state) => state.markdownEditorNodeId);
  const close = useFlowStore((state) => state.closeMarkdownEditor);
  const updateNode = useFlowStore((state) => state.updateNode);
  const project = useActiveProject();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<EditorMode>('write');

  const node = nodeId
    ? (project?.nodes.find((candidate) => candidate.id === nodeId) ?? null)
    : null;

  // Every newly opened node starts in the editor.
  useEffect(() => {
    if (nodeId) {
      setMode('write');
      const timer = window.setTimeout(() => textareaRef.current?.focus(), 80);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [nodeId]);

  // Keep focus in the textarea when switching back to Write.
  useEffect(() => {
    if (mode === 'write' && nodeId) {
      textareaRef.current?.focus();
    }
  }, [mode, nodeId]);

  if (!node) return null;

  const markdown = node.markdown ?? '';
  const modeButton = (value: EditorMode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      className={mode === value ? 'is-active' : undefined}
      onClick={() => setMode(value)}
    >
      {label}
    </button>
  );

  return (
    <section
      className="markdown-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={`Markdown editor for ${node.title}`}
    >
      <header className="sheet-head">
        <div className="sheet-title">
          <span className="eyebrow">MARKDOWN</span>
          <h2>{node.title}</h2>
        </div>
        <div className="sheet-actions">
          <div className="mode-toggle" role="tablist" aria-label="Editor mode">
            {modeButton('write', 'Write')}
            {modeButton('preview', 'Preview')}
          </div>
          <span className="sheet-hint">
            {markdown.trim().length} characters · saved locally
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close Markdown editor"
            onClick={close}
          >
            <IconX size={14} />
          </button>
        </div>
      </header>

      <div className="sheet-body">
        {mode === 'write' ? (
          <div className="sheet-write">
            <textarea
              ref={textareaRef}
              className="markdown-input"
              value={markdown}
              placeholder={'# Heading\n\nWrite Markdown documentation for this node…'}
              spellCheck
              onChange={(event) =>
                updateNode(node.id, { markdown: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  close();
                }
              }}
            />
          </div>
        ) : (
          <div className="sheet-preview">
            <div className="sheet-preview-inner">
              {markdown.trim() ? (
                <MarkdownView markdown={markdown} />
              ) : (
                <p className="hint">
                  Nothing to preview yet. Switch to Write and start typing.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
