import { useMemo } from 'react';
import type { MouseEvent } from 'react';
import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import type { Tokens } from 'marked';
import { parseSourceFence } from '../core/sourceFence';
import { isVsCodeWebview, openSourceFile } from './vscodeBridge';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

function sourceRangeLabel(startLine: number | null, endLine: number | null): string {
  if (!startLine) return '';
  if (!endLine || endLine === startLine) return `L${startLine}`;
  return `L${startLine}–L${endLine}`;
}

function renderCodeBlock(token: Tokens.Code, canOpenSources: boolean): string {
  const source = parseSourceFence(token.lang ?? '');
  const language =
    source?.language || (token.lang ?? '').split(/\s+/)[0]?.replace(/^\./, '') || '';
  const code = token.escaped ? token.text : escapeHtml(token.text);
  const languageClass = /^[\w+#.-]+$/.test(language)
    ? ` class="language-${language}"`
    : '';
  const pre = `<pre><code${languageClass}>${code}</code></pre>`;

  if (!source || !canOpenSources) return pre;

  const path = escapeHtml(source.path);
  const range = sourceRangeLabel(source.startLine, source.endLine);
  return (
    `<div class="md-source">` +
    `<button type="button" class="md-source-open" data-source-path="${path}"` +
    (source.startLine ? ` data-source-start="${source.startLine}"` : '') +
    (source.endLine ? ` data-source-end="${source.endLine}"` : '') +
    ` title="Open ${path} in VS Code">` +
    `<span class="md-source-file">${path}</span>` +
    (range ? `<span class="md-source-range">${range}</span>` : '') +
    `<span class="md-source-action">Open in VS Code</span>` +
    `</button>${pre}</div>`
  );
}

function handleSourceClick(event: MouseEvent<HTMLDivElement>): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const trigger = target.closest<HTMLElement>('[data-source-path]');
  const sourcePath = trigger?.dataset.sourcePath;
  if (!trigger || !sourcePath) return;
  event.preventDefault();
  const start = Number(trigger.dataset.sourceStart);
  const end = Number(trigger.dataset.sourceEnd);
  openSourceFile(
    sourcePath,
    Number.isFinite(start) && start > 0 ? start : undefined,
    Number.isFinite(end) && end > 0 ? end : undefined,
  );
}

/**
 * Renders user-authored Markdown. Output is sanitized before insertion so a
 * node's notes can never inject script or event handlers into the app.
 * Annotated code fences become links that open the source file in VS Code.
 */
export function MarkdownView({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  const html = useMemo(() => {
    const parser = new Marked({ gfm: true, breaks: true });
    const canOpenSources = isVsCodeWebview();
    parser.use({
      renderer: {
        code(token: Tokens.Code) {
          return renderCodeBlock(token, canOpenSources);
        },
      },
    });
    const parsed = parser.parse(markdown, { async: false });
    return DOMPurify.sanitize(parsed, {
      ADD_ATTR: ['data-source-path', 'data-source-start', 'data-source-end'],
    });
  }, [markdown]);

  return (
    <div
      className={className ? `markdown-body ${className}` : 'markdown-body'}
      onClick={handleSourceClick}
      // Content is sanitized above; it never contains scripts or event handlers.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
