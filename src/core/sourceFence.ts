/**
 * Parses a repository file reference out of a Markdown code-fence info string.
 *
 * Flow renders annotated fences as a link that opens the file in the VS Code
 * editor and selects the referenced lines. The annotation is deliberately part
 * of the Markdown so it travels with backups and MCP-authored documentation.
 *
 * Supported forms:
 *   ```ts file=src/auth/session.ts lines=24-38
 *   ```ts title="src/auth/session.ts:24-38"
 *   ```ts src/auth/session.ts#L24-L38
 */

export interface SourceFence {
  language: string;
  path: string;
  startLine: number | null;
  endLine: number | null;
}

const CODE_EXTENSION =
  /\.(?:[cm]?[jt]sx?|json|jsonc|md|mdx|css|scss|sass|less|html?|py|rb|go|rs|java|kt|kts|swift|php|sh|bash|zsh|yml|yaml|toml|ini|sql|graphql|gql|proto|c|h|cc|cpp|hpp|cs|vue|svelte)$/i;

const ATTRIBUTE = /([A-Za-z][\w-]*)=("[^"]*"|'[^']*'|[^\s]+)/g;

function parseRange(value: string): { start: number; end: number } | null {
  const match = /^L?(\d+)(?:\s*[-–]\s*L?(\d+))?$/i.exec(value.trim());
  if (!match) return null;
  const start = Number(match[1]);
  if (!Number.isFinite(start) || start < 1) return null;
  const end = match[2] ? Math.max(start, Number(match[2])) : start;
  return { start, end };
}

function splitInfo(info: string): { language: string; rest: string } {
  const raw = info.trim();
  const wrapped = /^\{\.?([^\s}]+)\s*(.*?)\}$/.exec(raw);
  if (wrapped) {
    return { language: wrapped[1].replace(/^\./, ''), rest: wrapped[2].trim() };
  }
  const parts = raw.split(/\s+/);
  const first = parts[0] ?? '';
  // No language: the fence starts directly with an attribute or path.
  if (first.includes('=') || CODE_EXTENSION.test(first)) {
    return { language: '', rest: raw };
  }
  return {
    language: first.replace(/^\./, ''),
    rest: raw.slice(first.length).trim(),
  };
}

export function parseSourceFence(info: string): SourceFence | null {
  if (!info.trim()) return null;
  const { language, rest } = splitInfo(info);

  const attributes = new Map<string, string>();
  for (const match of rest.matchAll(ATTRIBUTE)) {
    attributes.set(match[1].toLowerCase(), match[2].replace(/^["']|["']$/g, ''));
  }

  let path = attributes.get('file') ?? attributes.get('title') ?? attributes.get('path') ?? '';
  let lineValue = attributes.get('lines') ?? '';

  if (!path) {
    const bare = rest.split(/\s+/).find(
      (token) => !token.includes('=') && (token.includes('/') || CODE_EXTENSION.test(token)),
    );
    if (bare) path = bare;
  }
  if (!path || path.includes('://')) return null;

  // ```ts src/auth/session.ts#L24-L38
  const hash = /#L?(\d+)(?:-L?(\d+))?$/.exec(path);
  if (hash) {
    if (!lineValue) lineValue = `${hash[1]}${hash[2] ? `-${hash[2]}` : ''}`;
    path = path.slice(0, hash.index);
  }

  // ```ts title="src/auth/session.ts:24-38"
  if (!lineValue) {
    const colon = /^(.*?):(\d+)(?:-(\d+))?$/.exec(path);
    if (colon && (colon[1].includes('/') || CODE_EXTENSION.test(colon[1]))) {
      path = colon[1];
      lineValue = `${colon[2]}${colon[3] ? `-${colon[3]}` : ''}`;
    }
  }

  path = path.trim();
  if (!path) return null;
  const range = lineValue ? parseRange(lineValue) : null;
  return {
    language,
    path,
    startLine: range?.start ?? null,
    endLine: range?.end ?? null,
  };
}
