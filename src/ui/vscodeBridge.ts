import { applyTheme, hasExplicitTheme, useFlowStore, type Theme } from '../state/store';

/**
 * Thin bridge between the Flow app and the VS Code extension host, used only
 * when the app runs inside a webview. It keeps the persisted theme choice in
 * extension state (localStorage is unavailable in webviews) and lets the app
 * follow live VS Code color-theme changes until the user picks a theme.
 */

export interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

let cachedApi: VsCodeApi | null | undefined;

export function getVsCodeApi(): VsCodeApi | null {
  if (cachedApi === undefined) {
    // acquireVsCodeApi may only be called once per webview document.
    cachedApi = typeof window.acquireVsCodeApi === 'function'
      ? window.acquireVsCodeApi()
      : null;
  }
  return cachedApi;
}

/** True only when the app is running inside the VS Code extension webview. */
export function isVsCodeWebview(): boolean {
  return getVsCodeApi() !== null;
}

/** Subscribes to structured messages posted by the extension host. */
export function subscribeHostMessages(
  handler: (data: Record<string, unknown>) => void,
): () => void {
  const listener = (event: MessageEvent) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    handler(data as Record<string, unknown>);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export function initThemeBridge(): void {
  const api = getVsCodeApi();
  if (!api) return; // plain browser: localStorage path already handles this.

  let explicit = hasExplicitTheme();
  let applyingHostTheme = false;

  subscribeHostMessages((data) => {
    if (data.type !== 'flow:hostTheme') return;
    if (data.theme !== 'light' && data.theme !== 'dark') return;
    if (explicit) return; // the user's saved choice wins over the host theme.
    const theme = data.theme as Theme;
    applyingHostTheme = true;
    try {
      applyTheme(theme);
      useFlowStore.setState({ theme });
    } finally {
      applyingHostTheme = false;
    }
  });

  useFlowStore.subscribe((state, previous) => {
    if (state.theme === previous.theme || applyingHostTheme) return;
    explicit = true;
    api.postMessage({ type: 'flow:setTheme', theme: state.theme });
  });
}
