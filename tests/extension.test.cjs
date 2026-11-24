'use strict';

/**
 * Extension-host integration test with a mocked `vscode` module. Exercises the
 * real command server, workspace linking, webview bootstrap, and command
 * routing without launching VS Code.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const protocol = require('../src/extension/protocol.cjs');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sendRequest(socketPath, request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    let buffer = '';
    socket.setEncoding('utf8');
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Timed out waiting for the extension host.'));
    }, 5000);
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const index = buffer.indexOf('\n');
      if (index === -1) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(buffer.slice(0, index)));
      } catch (error) {
        reject(error);
      }
      socket.end();
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitFor(check, timeoutMs = 3000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let value = false;
      try {
        value = check();
      } catch {
        value = false;
      }
      if (value) resolve(value);
      else if (Date.now() - started > timeoutMs) reject(new Error('Timed out.'));
      else setTimeout(tick, 20);
    };
    tick();
  });
}

test('extension host links the workspace and routes commands to the webview', async (t) => {
  const workspace = tempDir('flow-ext-ws-');
  const dataDir = tempDir('flow-ext-data-');
  const extensionPath = tempDir('flow-ext-root-');
  const webviewDir = path.join(extensionPath, '.flow-extension', 'webview');
  fs.mkdirSync(path.join(webviewDir, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(webviewDir, 'index.html'),
    '<!doctype html><html><head></head><body><div id="root"></div><script type="module" src="./assets/app.js"></script></body></html>',
  );
  fs.writeFileSync(path.join(webviewDir, 'assets', 'app.js'), 'console.log(1);');
  process.env.FLOW_DATA_DIR = dataDir;

  const commands = new Map();
  const sentToWebview = [];
  let webviewHandler = null;

  const panel = {
    webview: {
      html: '',
      cspSource: 'vscode-resource:',
      onDidReceiveMessage(handler) {
        webviewHandler = handler;
        return { dispose() {} };
      },
      postMessage(message) {
        sentToWebview.push(message);
        if (message.type === 'flow:command') {
          setTimeout(() => {
            let result;
            if (message.command === 'snapshot') {
              result = {
                projectId: 'p_test',
                backup: {
                  format: 'flow-backup',
                  version: 4,
                  exportedAt: new Date().toISOString(),
                  projects: [],
                },
              };
            } else if (message.command === 'apply') {
              result = {
                ok: true,
                dryRun: message.payload.dryRun === true,
                errors: [],
                changes: [],
                summary: { created: 0, updated: 0, unchanged: 0, connected: 0 },
                projectId: 'p_test',
                persisted: true,
              };
            } else {
              result = {
                activeProjectId: 'p_test',
                activeProjectName: 'Test',
                workspaceProjectId: 'p_test',
                projectCount: 1,
                nodeCount: 1,
                connectionCount: 0,
                storageKind: 'IndexedDB',
                persistent: true,
                storageWarning: null,
                saveState: 'saved',
                projects: [{ id: 'p_test', name: 'Test' }],
              };
            }
            webviewHandler?.({
              type: 'flow:commandResult',
              requestId: message.requestId,
              ok: true,
              result,
            });
          }, 0);
        }
        return Promise.resolve(true);
      },
      asWebviewUri(uri) {
        return { toString: () => `mock://${uri.fsPath || 'resource'}` };
      },
    },
    reveal() {},
    onDidDispose() {
      return { dispose() {} };
    },
  };

  const vscodeMock = {
    ViewColumn: { One: 1 },
    ColorThemeKind: { Light: 1, HighContrastLight: 2, Dark: 3 },
    Uri: {
      joinPath(base, ...parts) {
        return { fsPath: [base && base.fsPath, ...parts].filter(Boolean).join('/') };
      },
    },
    env: { clipboard: { writeText: async () => {} } },
    commands: {
      registerCommand(name, handler) {
        commands.set(name, handler);
        return { dispose() {} };
      },
    },
    window: {
      activeColorTheme: { kind: 3 },
      createWebviewPanel() {
        setTimeout(() => {
          webviewHandler?.({
            type: 'flow:workspaceProject',
            projectId: 'p_test',
            workspaceName: null,
          });
          webviewHandler?.({ type: 'flow:commandsReady' });
        }, 10);
        return panel;
      },
      onDidChangeActiveColorTheme() {
        return { dispose() {} };
      },
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: () => undefined,
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: workspace } }],
    },
  };

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') return vscodeMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
  });

  const extension = require('../src/extension/extension.cjs');
  const context = {
    extensionPath,
    extensionUri: { fsPath: extensionPath },
    subscriptions: [],
    globalState: {
      get: () => undefined,
      update: async () => {},
    },
  };
  t.after(() => {
    for (const disposable of context.subscriptions) {
      try {
        disposable.dispose();
      } catch {
        /* ignore */
      }
    }
  });

  extension.activate(context);
  assert.ok(commands.has('flow.open'));
  assert.ok(commands.has('flow.linkWorkspace'));
  assert.ok(commands.has('flow.installCli'));
  assert.ok(commands.has('flow.installClaudeIntegration'));
  assert.ok(commands.has('flow.setupEverything'));

  const key = protocol.workspaceKey(workspace);
  const socketPath = protocol.socketPath(dataDir, key);
  await waitFor(() => fs.existsSync(socketPath));

  // The server opens the panel and waits for the mock webview to boot.
  const status = await sendRequest(socketPath, {
    id: 'req_status',
    command: 'status',
    workspace,
  });
  assert.equal(status.ok, true);
  assert.equal(status.result.activeProjectId, 'p_test');

  const entry = protocol.getWorkspaceEntry(dataDir, key);
  assert.equal(entry.projectId, 'p_test');

  const apply = await sendRequest(socketPath, {
    id: 'req_apply',
    command: 'apply',
    workspace,
    payload: {
      ops: [
        {
          op: 'upsert-node',
          key: 'module/auth',
          type: 'module',
          title: 'Auth',
          parent: '@root',
        },
      ],
      dryRun: false,
    },
  });
  assert.equal(apply.ok, true);
  assert.equal(apply.result.projectId, 'p_test');
  assert.ok(apply.result.backupPath);
  assert.equal(fs.existsSync(apply.result.backupPath), true);
  assert.equal(apply.result.backupError, null);

  const applyMessage = sentToWebview.find(
    (message) => message.type === 'flow:command' && message.command === 'apply',
  );
  assert.ok(applyMessage);
  assert.equal(applyMessage.payload.projectId, 'p_test');
  assert.equal(applyMessage.payload.ops.length, 1);

  const bootstrapScript = panel.webview.html;
  assert.match(bootstrapScript, /__FLOW_WORKSPACE__/);
  assert.match(bootstrapScript, /"workspaceName":"/);
});
