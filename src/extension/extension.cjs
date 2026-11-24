const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { ShareServer } = require('./shareServer.cjs');
const { CommandServer } = require('./commandServer.cjs');
const protocol = require('./protocol.cjs');
const installer = require('./installer.cjs');
const setup = require('./setup.cjs');

const THEME_STATE_KEY = 'flow.theme';
const SETUP_PROMPT_KEY = 'flow.setupOffered';
const PANEL_READY_TIMEOUT_MS = 20_000;
const COMMAND_TIMEOUT_MS = 30_000;
const APPLY_TIMEOUT_MS = 120_000;

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

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0] ?? null;
  const workspacePath = workspaceFolder ? workspaceFolder.uri.fsPath : null;
  const workspaceName = workspacePath
    ? path.basename(workspacePath) || 'Workspace'
    : null;
  const appDataDir = protocol.dataDir();
  const workspaceKey = workspacePath ? protocol.workspaceKey(workspacePath) : null;

  // If the user already installed the terminal CLI, keep its stable copy in
  // sync with this extension version. This never installs it implicitly.
  installer.refreshCliTools({
    extensionPath: context.extensionPath,
    appDataDir,
  });

  let panel = null;
  let panelReady = null;
  let commandServer = null;
  const pendingCommands = new Map();

  function makeReadyState() {
    let resolve;
    const promise = new Promise((settle) => {
      resolve = settle;
    });
    return { promise, resolve, done: false };
  }

  function currentLinkedProjectId() {
    if (!workspaceKey) return null;
    try {
      return protocol.getWorkspaceEntry(appDataDir, workspaceKey)?.projectId ?? null;
    } catch {
      return null;
    }
  }

  function buildBootstrap() {
    const savedTheme = context.globalState.get(THEME_STATE_KEY);
    return {
      theme: isValidTheme(savedTheme) ? savedTheme : null,
      hostTheme: hostFlowTheme(),
      workspace:
        workspacePath && workspaceName
          ? {
              projectId: currentLinkedProjectId(),
              workspaceName,
            }
          : null,
    };
  }

  function openFlowPanel({ reveal = true } = {}) {
    if (panel) {
      if (reveal) panel.reveal();
      return panel;
    }

    const created = vscode.window.createWebviewPanel(
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
    panel = created;
    panelReady = makeReadyState();
    const owner = created;

    created.webview.html = getWebviewHtml(context, created.webview, buildBootstrap());
    created.webview.onDidReceiveMessage(
      (message) => {
        void handleWebviewMessage(owner, message);
      },
      undefined,
      context.subscriptions,
    );

    created.onDidDispose(
      () => {
        void shareServer.stopByOwner(owner);
        if (panel === created) {
          panel = null;
          panelReady = null;
        }
        for (const [requestId, pending] of pendingCommands) {
          clearTimeout(pending.timer);
          pending.reject(new Error('The Flow panel was closed.'));
          pendingCommands.delete(requestId);
        }
      },
      null,
      context.subscriptions,
    );

    if (reveal) created.reveal();
    return created;
  }

  function waitForPanelReady(timeoutMs = PANEL_READY_TIMEOUT_MS) {
    const ready = panelReady;
    if (!ready || ready.done) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Flow did not finish loading.'));
      }, timeoutMs);
      ready.promise.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  async function sendWebviewCommand(command, payload, options = {}) {
    const target = openFlowPanel();
    if (!target) throw new Error('Could not open the Flow panel.');
    await waitForPanelReady();
    const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
    const requestId = protocol.randomId('cmd');

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCommands.delete(requestId);
        reject(new Error('Flow did not respond to the command.'));
      }, timeoutMs);
      pendingCommands.set(requestId, { resolve, reject, timer });
      void target.webview.postMessage({
        type: 'flow:command',
        requestId,
        command,
        payload,
      });
    });
  }

  async function handleWebviewMessage(owner, message) {
    if (!message || typeof message !== 'object') return;

    const post = (payload) => {
      void owner.webview.postMessage(payload);
    };

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

        case 'flow:commandsReady':
          if (owner !== panel) return;
          if (panelReady && !panelReady.done) {
            panelReady.done = true;
            panelReady.resolve();
          }
          if (commandServer) void commandServer.drainQueue();
          return;

        case 'flow:workspaceProject': {
          if (!workspaceKey || !workspacePath || !workspaceName) return;
          if (typeof message.projectId !== 'string' || !message.projectId) return;
          if (message.projectId.length > 100) return;
          protocol.setWorkspaceEntry(appDataDir, workspaceKey, {
            projectId: message.projectId,
            workspacePath,
            name: workspaceName,
          });
          return;
        }

        case 'flow:commandResult': {
          const requestId =
            typeof message.requestId === 'string' ? message.requestId : '';
          const pending = pendingCommands.get(requestId);
          if (!pending) return;
          pendingCommands.delete(requestId);
          clearTimeout(pending.timer);
          pending.resolve({
            ok: message.ok === true,
            ...(message.result !== undefined ? { result: message.result } : {}),
            ...(Array.isArray(message.errors)
              ? {
                  errors: message.errors.filter(
                    (entry) => typeof entry === 'string',
                  ),
                }
              : {}),
          });
          return;
        }

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
  }

  /**
   * The workspace-linked project is the default target for reads and plans.
   * If the link is stale (the project was deleted), fall back to whichever
   * project the app opened for this workspace.
   */
  async function resolveCommandProjectId() {
    const status = await sendWebviewCommand('status', {});
    const projects =
      status && status.ok && status.result && Array.isArray(status.result.projects)
        ? status.result.projects
        : [];
    const mapped = currentLinkedProjectId();
    if (mapped && projects.some((project) => project && project.id === mapped)) {
      return mapped;
    }
    const active =
      status && status.ok && status.result ? status.result.activeProjectId : null;
    return typeof active === 'string' ? active : null;
  }

  async function handleCommand(request) {
    switch (request.command) {
      case 'ping':
        return {
          ok: true,
          result: {
            protocol: protocol.PROTOCOL_VERSION,
            workspace: workspacePath,
            projectId: currentLinkedProjectId(),
          },
        };

      case 'open':
        openFlowPanel();
        return { ok: true, result: { opened: true, workspace: workspacePath } };

      case 'status':
        return sendWebviewCommand('status', {});

      case 'list': {
        const projectId = await resolveCommandProjectId();
        return sendWebviewCommand('list', { ...request.payload, projectId });
      }

      case 'get': {
        const projectId = await resolveCommandProjectId();
        return sendWebviewCommand('get', { ...request.payload, projectId });
      }

      case 'apply': {
        const projectId = await resolveCommandProjectId();
        let backupPath = null;
        let backupError = null;

        // A real apply gets a portable backup in Flow's app-data directory
        // first. Dry runs, reads, and previews never write anything.
        if (request.payload.dryRun !== true && projectId) {
          try {
            const snapshot = await sendWebviewCommand(
              'snapshot',
              { projectId },
              { timeoutMs: APPLY_TIMEOUT_MS },
            );
            if (snapshot && snapshot.ok && snapshot.result && snapshot.result.backup) {
              try {
                backupPath = protocol.writeProjectBackup(
                  appDataDir,
                  projectId,
                  snapshot.result.backup,
                );
              } catch (error) {
                backupError = errorText(error);
              }
            } else {
              backupError =
                (snapshot && snapshot.errors && snapshot.errors[0]) ||
                'Could not create a pre-apply backup.';
            }
          } catch (error) {
            backupError = errorText(error);
          }
        }

        const response = await sendWebviewCommand(
          'apply',
          { ...request.payload, projectId },
          { timeoutMs: APPLY_TIMEOUT_MS },
        );
        if (response && response.result && typeof response.result === 'object') {
          response.result.backupPath = backupPath;
          response.result.backupError = backupError;
        }
        return response;
      }

      case 'link': {
        if (!workspaceKey || !workspacePath || !workspaceName) {
          return {
            ok: false,
            errors: ['Open a folder or workspace before linking a Flow project.'],
          };
        }
        const status = await sendWebviewCommand('status', {});
        const active =
          status && status.ok && status.result ? status.result.activeProjectId : null;
        if (typeof active !== 'string' || !active) {
          return { ok: false, errors: ['There is no active Flow project to link.'] };
        }
        const entry = protocol.setWorkspaceEntry(appDataDir, workspaceKey, {
          projectId: active,
          workspacePath,
          name: workspaceName,
        });
        return {
          ok: true,
          result: { projectId: entry.projectId, workspacePath },
        };
      }

      default:
        return {
          ok: false,
          errors: [`Unknown command "${request.command}".`],
        };
    }
  }

  function safeCommand(action) {
    Promise.resolve()
      .then(action)
      .catch((error) => {
        vscode.window.showErrorMessage(errorText(error));
      });
  }

  let setupChannel = null;
  function getSetupChannel() {
    if (!setupChannel) {
      setupChannel = vscode.window.createOutputChannel('Flow Setup');
      context.subscriptions.push(setupChannel);
    }
    return setupChannel;
  }

  async function runSetup() {
    const channel = getSetupChannel();
    channel.show(true);
    channel.appendLine('Flow setup started.');
    channel.appendLine(`Workspace: ${workspacePath || '(none)'}`);
    channel.appendLine(`App data: ${appDataDir}`);

    const result = await setup.setupAll({
      extensionPath: context.extensionPath,
      appDataDir,
      workspacePath,
      env: process.env,
      platform: process.platform,
      execFileImpl: require('child_process').execFile,
    });

    if (workspacePath) {
      openFlowPanel();
      try {
        await waitForPanelReady(15_000);
      } catch {
        /* the summary still reports the remaining steps */
      }
    }

    const lines = [];
    if (result.cli.ok) {
      lines.push(`Terminal CLI: installed at ${result.cli.shimPath}.`);
      if (!result.cli.nodeFound) {
        lines.push('Node.js was not found on PATH; install Node.js 20 or newer.');
      }
      if (!result.cli.onPath) {
        lines.push(`Add ${result.cli.installDir} to PATH.`);
      }
      if (result.cli.shadowedBy) {
        lines.push(
          `CLI warning: ${result.cli.shadowedBy} appears earlier in PATH and will be used instead. Remove it or reorder PATH.`,
        );
      }
    } else if (result.cli.conflict) {
      lines.push(
        'Terminal CLI: skipped because a different "flow" command already exists.',
      );
    } else {
      lines.push(
        `Terminal CLI: failed (${
          (result.cli.errors && result.cli.errors[0]) || 'unknown error'
        }).`,
      );
    }

    if (result.skill.ok) {
      lines.push(
        result.skillUpgraded
          ? 'Claude skill: updated in the Claude configuration.'
          : 'Claude skill: installed.',
      );
    } else if (result.skill.conflict) {
      lines.push(
        'Claude skill: skipped because existing files were not created by Flow.',
      );
    } else {
      lines.push('Claude skill: failed.');
    }

    switch (result.mcp.status) {
      case 'added':
        lines.push('MCP: registered with Claude Code (user scope).');
        break;
      case 'already':
        lines.push('MCP: already registered.');
        break;
      case 'claude-missing':
        lines.push(
          'MCP: Claude Code CLI not found; register later with the copied command.',
        );
        break;
      case 'cli-missing':
        lines.push('MCP: skipped because the terminal CLI was not installed.');
        break;
      case 'failed':
        lines.push(
          `MCP: registration failed. ${result.mcp.detail || 'Run the copied command manually.'}`,
        );
        break;
      default:
        break;
    }

    if (workspacePath) {
      lines.push('Flow project: linked to this workspace.');
    } else {
      lines.push('Open a folder in VS Code to link a Flow project.');
    }

    channel.appendLine('');
    channel.appendLine(lines.join('\n'));
    channel.appendLine('');

    const actions = [];
    if (
      result.mcp.command &&
      result.mcp.status !== 'added' &&
      result.mcp.status !== 'already'
    ) {
      actions.push('Copy MCP command');
    }
    if (result.cli.ok && !result.cli.onPath) actions.push('Copy PATH line');
    actions.push('Show details');

    const choice = await vscode.window.showInformationMessage(
      lines.join('\n'),
      ...actions,
    );
    if (choice === 'Copy MCP command') {
      await vscode.env.clipboard.writeText(result.mcp.command);
    } else if (choice === 'Copy PATH line') {
      await vscode.env.clipboard.writeText(result.cli.pathCommand);
    } else if (choice === 'Show details') {
      channel.show(true);
    }
  }

  async function offerSetup() {
    if (!workspacePath) return;
    if (context.globalState.get(SETUP_PROMPT_KEY)) return;
    await context.globalState.update(SETUP_PROMPT_KEY, true);

    const state = setup.isSetupComplete({
      appDataDir,
      env: process.env,
      platform: process.platform,
    });
    if (state.complete) return;

    const choice = await vscode.window.showInformationMessage(
      'Set up the Flow terminal CLI and Claude Code integration automatically?',
      'Set Up',
      'Not Now',
    );
    if (choice === 'Set Up') {
      await vscode.commands.executeCommand('flow.setupEverything');
    }
  }

  if (workspacePath) {
    try {
      protocol.ensurePrivateDir(appDataDir);
      commandServer = new CommandServer({
        workspacePath,
        appDataDir,
        handler: handleCommand,
      });
      context.subscriptions.push({
        dispose: () => {
          void commandServer?.dispose();
        },
      });
      commandServer
        .start()
        .then(() => commandServer.drainQueue())
        .catch((error) => {
          console.error('Flow command server did not start:', error);
        });
    } catch (error) {
      console.error('Flow command server is unavailable:', error);
    }
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      if (panel) {
        void panel.webview.postMessage({
          type: 'flow:hostTheme',
          theme: hostFlowTheme(),
        });
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flow.open', () => {
      openFlowPanel();
      void offerSetup();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flow.setupEverything', () =>
      safeCommand(runSetup),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flow.linkWorkspace', async () => {
      if (!workspacePath) {
        vscode.window.showWarningMessage(
          'Open a folder or workspace before linking a Flow project.',
        );
        return;
      }
      openFlowPanel();
      try {
        const response = await handleCommand({
          id: protocol.randomId('link'),
          command: 'link',
          workspace: workspacePath,
          payload: {},
        });
        if (response.ok) {
          vscode.window.showInformationMessage(
            'Linked this workspace to the active Flow project.',
          );
        } else {
          vscode.window.showErrorMessage(
            (response.errors && response.errors[0]) ||
              'Could not link the workspace.',
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(errorText(error));
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flow.installCli', () => safeCommand(async () => {
      let result = installer.installCli({
        extensionPath: context.extensionPath,
        appDataDir,
      });

      if (!result.ok && result.conflict) {
        const choice = await vscode.window.showWarningMessage(
          result.errors && result.errors[0]
            ? result.errors[0]
            : 'A different "flow" command already exists.',
          { modal: false },
          'Overwrite',
        );
        if (choice !== 'Overwrite') return;
        result = installer.installCli({
          extensionPath: context.extensionPath,
          appDataDir,
          force: true,
        });
      }

      if (!result.ok) {
        vscode.window.showErrorMessage(
          (result.errors && result.errors[0]) ||
            'Could not install the Flow terminal CLI.',
        );
        return;
      }

      const lines = [`Installed the flow command at ${result.shimPath}.`];
      if (!result.nodeFound) {
        lines.push(
          'Node.js was not found on PATH. Install Node.js 20 or newer; the CLI runs on Node.',
        );
      }
      if (!result.onPath) {
        lines.push(result.pathHint, result.pathCommand);
      } else {
        lines.push('Open a new terminal and run: flow status');
      }
      if (result.shadowedBy) {
        lines.push(
          `Another "flow" command at ${result.shadowedBy} appears earlier in PATH. Remove it (for example with npm unlink -g flow-docs) or reorder PATH.`,
        );
      }

      const actions = [];
      if (!result.onPath) actions.push('Copy PATH line');
      if (result.mcpCommand) actions.push('Copy MCP command');
      const choice = await vscode.window.showInformationMessage(
        lines.join('\n'),
        ...actions,
      );
      if (choice === 'Copy PATH line') {
        await vscode.env.clipboard.writeText(result.pathCommand);
      } else if (choice === 'Copy MCP command') {
        await vscode.env.clipboard.writeText(result.mcpCommand);
      }
    })),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flow.installClaudeIntegration', () => safeCommand(async () => {
      let result = installer.installClaudeIntegration();
      if (!result.ok && result.conflict) {
        const choice = await vscode.window.showWarningMessage(
          `Flow Claude files already exist:\n${result.files.join('\n')}\nOverwrite them?`,
          { modal: false },
          'Overwrite',
        );
        if (choice !== 'Overwrite') return;
        result = installer.installClaudeIntegration({ force: true });
      }
      if (!result.ok) {
        vscode.window.showErrorMessage(
          'Could not install the Flow Claude Code skill.',
        );
        return;
      }

      const command = installer.mcpCommandFor({ appDataDir });
      const nodeFound = Boolean(
        installer.nodeExecutableOnPath(process.env.PATH, process.platform),
      );
      const lines = [
        `Installed the Flow skill and /flow-help command in ${result.claudeHome}.`,
        'Restart Claude Code to load them.',
        'Register the MCP server with:',
        command,
      ];
      if (!nodeFound) {
        lines.push(
          'Node.js was not found on PATH. Install Node.js 20 or newer before using the CLI or MCP server.',
        );
      }
      lines.push('If the flow command is missing, run Flow: Install Terminal CLI first.');

      const choice = await vscode.window.showInformationMessage(
        lines.join('\n'),
        'Copy MCP command',
      );
      if (choice === 'Copy MCP command') {
        await vscode.env.clipboard.writeText(command);
      }
    })),
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
      return `${attribute}="${uri.toString()}"`;
    },
  );

  const nonce = getNonce();
  html = html.replace(
    '<head>',
    `<head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource}; connect-src ${webview.cspSource};">
    <script>window.__FLOW_THEME_BOOTSTRAP__ = ${
      JSON.stringify(bootstrap).replace(/</g, '\\u003c')
    };
    window.__FLOW_WORKSPACE__ = ${
      JSON.stringify(bootstrap.workspace).replace(/</g, '\\u003c')
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
