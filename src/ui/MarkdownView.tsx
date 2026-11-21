import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

/**
 * Renders user-authored Markdown. Output is sanitized before insertion so a
 * node's notes can never inject script or event handlers into the app.
 */
export function MarkdownView({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  const html = useMemo(() => {
    const parsed = marked.parse(markdown, { async: false });
    return DOMPurify.sanitize(parsed);
  }, [markdown]);

  return (
    <div
      className={className ? `markdown-body ${className}` : 'markdown-body'}
      // Content is sanitized above; it never contains scripts or event handlers.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
