const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { ShareServer } = require('./shareServer.cjs');

const THEME_STATE_KEY = 'flow.theme';

function hostFlowTheme() {
  const kind = vscode.window.activeColorTheme.kind;
  if (kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight) {
    return 'light';
  }
  return 'dark';
}

function isValidTheme(theme) {
  return theme === 'light' || theme === 'dark';
}

function errorText(error) {
  return error instanceof Error ? error.message : 'Unexpected error.';
}

function activate(context) {
  const shareServer = new ShareServer({
    webviewRoot: path.join(context.extensionPath, '.flow-extension', 'webview'),
  });
  context.subscriptions.push({
    dispose: () => {
      void shareServer.dispose();
    },
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('flow.open', () => {
      const panel = vscode.window.createWebviewPanel(
        'flow',
        'Flow',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, '.flow-extension', 'webview'),
          ],
        },
      );
      const owner = panel;

      const savedTheme = context.globalState.get(THEME_STATE_KEY);
      const bootstrap = {
        theme: isValidTheme(savedTheme) ? savedTheme : null,
        hostTheme: hostFlowTheme(),
      };
      panel.webview.html = getWebviewHtml(context, panel.webview, bootstrap);

      const post = (payload) => {
        void panel.webview.postMessage(payload);
      };

      panel.webview.onDidReceiveMessage(
        async (message) => {
          if (!message || typeof message !== 'object') return;

          try {
            switch (message.type) {
              case 'flow:setTheme':
                if (isValidTheme(message.theme)) {
                  await context.globalState.update(THEME_STATE_KEY, message.theme);
                }
                return;

              case 'flow:copyText':
                if (typeof message.text === 'string' && message.text.length <= 100000) {
                  await vscode.env.clipboard.writeText(message.text);
                }
                return;

              case 'flow:appReady':
                // A reloaded webview must not leave an orphaned share running.
                await shareServer.stopByOwner(owner);
                return;

              case 'flow:shareStart': {
                const requestId =
                  typeof message.requestId === 'string' ? message.requestId : null;
                try {
                  const share = await shareServer.start({
                    snapshot: message.snapshot,
                    password: message.password,
                    theme: isValidTheme(message.theme) ? message.theme : hostFlowTheme(),
                    owner,
                  });
                  if (requestId) {
                    post({ type: 'flow:shareStatus', requestId, ok: true, share });
                  }
                } catch (error) {
                  if (requestId) {
                    post({
                      type: 'flow:shareStatus',
                      requestId,
                      ok: false,
                      error: errorText(error),
                    });
                  }
                }
                return;
              }

              case 'flow:shareUpdate': {
                if (typeof message.shareId !== 'string') return;
                try {
                  await shareServer.update({
                    shareId: message.shareId,
                    snapshot: message.snapshot,
                    owner,
                  });
                } catch (error) {
                  post({
                    type: 'flow:shareError',
                    shareId: message.shareId,
                    error: errorText(error),
                  });
                }
                return;
              }

              case 'flow:shareStop': {
                const requestId =
                  typeof message.requestId === 'string' ? message.requestId : null;
                if (typeof message.shareId === 'string') {
                  await shareServer.stop(message.shareId, owner);
                }
                if (requestId) {
                  post({ type: 'flow:shareStatus', requestId, ok: true });
                }
                return;
              }

              default:
                return;
            }
          } catch (error) {
            console.error('Flow message failed:', error);
          }
        },
        undefined,
        context.subscriptions,
      );

      panel.onDidDispose(
        () => {
          void shareServer.stopByOwner(owner);
        },
        null,
        context.subscriptions,
      );

      context.subscriptions.push(
        vscode.window.onDidChangeActiveColorTheme(() => {
          panel.webview.postMessage({ type: 'flow:hostTheme', theme: hostFlowTheme() });
        }),
      );
    }),
  );
}

function getWebviewHtml(context, webview, bootstrap) {
  const webviewRoot = vscode.Uri.joinPath(
    context.extensionUri,
    '.flow-extension',
    'webview',
  );
  const indexPath = path.join(
    context.extensionPath,
    '.flow-extension',
    'webview',
    'index.html',
  );
  let html = fs.readFileSync(indexPath, 'utf8');

  html = html.replace(
    /(src|href)="([^"]+)"/g,
    (match, attribute, resourcePath) => {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(resourcePath) || resourcePath.startsWith('data:')) {
        return match;
      }

      const uri = webview.asWebviewUri(
        vscode.Uri.joinPath(webviewRoot, resourcePath.replace(/^\.?\//, '')),
      );
      return `${attribute}="${uri.toString()}"`
    },
  );

  const nonce = getNonce();
  html = html.replace(
    '<head>',
    `<head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource}; connect-src ${webview.cspSource};">
    <script>window.__FLOW_THEME_BOOTSTRAP__ = ${
      JSON.stringify(bootstrap).replace(/</g, '\\u003c')
    };</script>`,
  );
  html = html.replace(/<script(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`);

  return html;
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function deactivate() {}

module.exports = { activate, deactivate };
