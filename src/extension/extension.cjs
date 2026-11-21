const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

function activate(context) {
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

      panel.webview.html = getWebviewHtml(context, panel.webview);
    }),
  );
}

function getWebviewHtml(context, webview) {
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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource}; connect-src ${webview.cspSource};">`,
  );
  html = html.replace(/<script/, `<script nonce="${nonce}"`);

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
