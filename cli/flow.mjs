#!/usr/bin/env node
/**
 * Flow terminal control.
 *
 * Talks to the running VS Code extension over a per-user Unix socket (or
 * Windows named pipe). It never reads or writes the repository: the only
 * files it touches are in Flow's application-data directory. Commands that
 * arrive while Flow is closed are queued there and applied on next launch.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const protocol = require('../src/extension/protocol.cjs');
const {
  NODE_TYPE_NAMES,
  CONNECTION_TYPE_NAMES,
  SKILL_MARKDOWN,
  FLOW_HELP_COMMAND,
} = require('../src/extension/claudeIntegration.cjs');

const VERSION = readVersion();
const NO_SERVER_CODES = new Set(['ENOENT', 'ECONNREFUSED', 'ECONNRESET']);

const NODE_TYPES = NODE_TYPE_NAMES;
const CONNECTION_TYPES = CONNECTION_TYPE_NAMES;

function readVersion() {
  try {
    const raw = fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    return JSON.parse(raw).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/* ------------------------------------------------------------------ output */

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printError(message) {
  process.stderr.write(`flow: ${message}\n`);
}

function responseErrors(response) {
  if (response && Array.isArray(response.errors) && response.errors.length > 0) {
    return response.errors;
  }
  return ['The command failed without an error message.'];
}

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    json: false,
    dryRun: false,
    wait: false,
    force: false,
    includeMarkdown: false,
  };
  let command = args.shift() || 'help';
  if (command === '--help' || command === '-h') {
    return { command: 'help', options, positional: [] };
  }
  if (command === '--version' || command === '-v') {
    command = 'version';
  }
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--wait') options.wait = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--markdown') options.includeMarkdown = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--workspace') options.workspace = args[++index];
    else if (arg.startsWith('--workspace=')) options.workspace = arg.slice(12);
    else if (arg === '--type') options.type = args[++index];
    else if (arg.startsWith('--type=')) options.type = arg.slice(7);
    else if (arg === '--timeout') options.timeout = Number(args[++index]);
    else if (arg.startsWith('-')) throw new Error(`Unknown option "${arg}".`);
    else positional.push(arg);
  }

  return { command, options, positional };
}

/* --------------------------------------------------------------- workspace */

function looksLikeRepoRoot(dir) {
  try {
    return fs.existsSync(path.join(dir, '.git'));
  } catch {
    return false;
  }
}

function workspaceCandidates(start) {
  const candidates = [];
  let current = start;
  for (let depth = 0; depth < 20; depth += 1) {
    candidates.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return candidates;
}

/** Returns the nearest ancestor whose Flow command socket exists, if any. */
function findServingWorkspace(start) {
  const root = protocol.dataDir();
  for (const candidate of workspaceCandidates(start)) {
    try {
      const key = protocol.workspaceKey(candidate);
      if (fs.existsSync(protocol.socketPath(root, key))) {
        return protocol.normalizeWorkspace(candidate);
      }
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Finds the workspace the extension is serving. A subdirectory, an explicit
 * path, and the current directory all resolve to the nearest served ancestor.
 * Without a running server, fall back to the nearest git root.
 */
function resolveWorkspace(explicit) {
  const requested = explicit || process.env.FLOW_WORKSPACE;
  if (requested) {
    const normalized = protocol.normalizeWorkspace(requested);
    return findServingWorkspace(normalized) || normalized;
  }

  const start = path.resolve(process.cwd());
  const serving = findServingWorkspace(start);
  if (serving) return serving;

  const repo = workspaceCandidates(start).find(looksLikeRepoRoot);
  return protocol.normalizeWorkspace(repo || start);
}

/* ------------------------------------------------------------- transport */

function sendOverSocket(socketPath, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = '';
    const socket = net.connect(socketPath);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn(value);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error('Flow did not respond in time.'));
    }, timeoutMs);

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(message)}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      const index = buffer.indexOf('\n');
      if (index === -1) return;
      const line = buffer.slice(0, index).trim();
      try {
        const response = JSON.parse(line);
        finish(resolve, response);
      } catch {
        finish(reject, new Error('Flow returned an unreadable response.'));
      }
    });
    socket.on('error', (error) => finish(reject, error));
    socket.on('close', () => {
      if (!settled) finish(reject, new Error('Flow closed the connection.'));
    });
  });
}

function isNoServer(error) {
  return Boolean(error && NO_SERVER_CODES.has(error.code));
}

async function call(command, payload, options = {}) {
  const workspace = options.workspace || resolveWorkspace();
  const root = protocol.dataDir();
  const key = protocol.workspaceKey(workspace);
  const id = protocol.randomId('req');
  const message = { id, command, workspace, payload: payload || {} };
  const socketPath = protocol.socketPath(root, key);
  const timeoutMs = options.timeoutMs || 30_000;

  try {
    const response = await sendOverSocket(socketPath, message, timeoutMs);
    return { response, workspace, id, key, root, queued: false };
  } catch (error) {
    if (options.queue && isNoServer(error)) {
      protocol.ensurePrivateDir(root);
      protocol.queueRequest(root, key, message);
      return { response: null, workspace, id, key, root, queued: true };
    }
    if (isNoServer(error)) {
      throw new Error(
        `Flow is not running for ${workspace}. Open this folder in VS Code with the Flow extension enabled.`,
      );
    }
    throw error;
  }
}

function requireOk(response) {
  if (!response) throw new Error('No response from Flow.');
  return response.ok === true;
}

/* --------------------------------------------------------------- display */

const COMMANDS = [
  {
    name: 'help',
    usage: 'flow help [--json]',
    description: 'List the available commands.',
  },
  {
    name: 'version',
    usage: 'flow version',
    description: 'Print the CLI version.',
  },
  {
    name: 'status',
    usage: 'flow status',
    description: 'Show the linked project, node counts, and storage state.',
  },
  {
    name: 'list',
    usage: 'flow list [--type <type>] [--markdown] [--json]',
    description: 'List nodes in the active project with keys, types, and paths.',
  },
  {
    name: 'get',
    usage: 'flow get <key|id> [--json]',
    description: 'Show one node, including Markdown and its connections.',
  },
  {
    name: 'apply',
    usage: 'flow apply <plan.json|-> [--dry-run] [--json]',
    description: 'Validate and apply a batch plan (atomic; queued if Flow is closed).',
  },
  {
    name: 'open',
    usage: 'flow open',
    description: 'Open or reveal the Flow panel in VS Code.',
  },
  {
    name: 'link',
    usage: 'flow link',
    description: 'Link the current workspace to the active Flow project.',
  },
  {
    name: 'result',
    usage: 'flow result <id> [--wait] [--json]',
    description: 'Read the result of a command that was queued while Flow was closed.',
  },
  {
    name: 'mcp',
    usage: 'flow mcp',
    description: 'Run the Model Context Protocol server over stdio.',
  },
  {
    name: 'install-skill',
    usage: 'flow install-skill [--force]',
    description: 'Install the Claude Code skill and /flow-help command under ~/.claude.',
  },
];

function printHelp() {
  process.stdout.write(`Flow terminal control v${VERSION}\n\n`);
  process.stdout.write('Usage: flow <command> [options]\n\n');
  for (const entry of COMMANDS) {
    process.stdout.write(`  ${entry.usage}\n      ${entry.description}\n`);
  }
  process.stdout.write(
    '\nCommands require the Flow VS Code extension in this workspace.\n' +
      'Apply is queued when Flow is closed and runs the next time VS Code starts.\n' +
      'Nothing is written to the repository; all state lives in Flow\'s app-data directory.\n',
  );
}

function printStatus(result) {
  process.stdout.write(`Project: ${result.activeProjectName || '(none)'}\n`);
  process.stdout.write(`  id: ${result.activeProjectId || '(none)'}\n`);
  if (result.workspaceProjectId) {
    process.stdout.write(`  linked to this workspace: ${result.workspaceProjectId}\n`);
  }
  process.stdout.write(`  nodes: ${result.nodeCount}\n`);
  process.stdout.write(`  connections: ${result.connectionCount}\n`);
  process.stdout.write(`  projects in app: ${result.projectCount}\n`);
  process.stdout.write(
    `  storage: ${result.storageKind}${result.persistent ? '' : ' (not persistent!)'}\n`,
  );
  if (result.storageWarning) process.stdout.write(`  warning: ${result.storageWarning}\n`);
}

function printTree(nodes) {
  const byParent = new Map();
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    const parent = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(node);
  }
  const lines = [];
  const walk = (parent, depth) => {
    for (const node of byParent.get(parent) || []) {
      const key = node.externalKey ? `  ${node.externalKey}` : '';
      lines.push(
        `${'  '.repeat(depth)}- [${node.type}] ${node.title}${key}  (${node.id})`,
      );
      walk(node.id, depth + 1);
    }
  };
  walk(null, 0);
  process.stdout.write(lines.length ? `${lines.join('\n')}\n` : '(no nodes)\n');
}

function printApply(result) {
  const summary = result.summary || {};
  const prefix = result.dryRun ? 'Dry run' : 'Applied';
  process.stdout.write(
    `${prefix}: ${summary.created || 0} created, ${summary.updated || 0} updated, ` +
      `${summary.unchanged || 0} unchanged, ${summary.connected || 0} connected\n`,
  );
  for (const change of result.changes || []) {
    const mark =
      change.action === 'created' ? '+' : change.action === 'updated' ? '~' : '=';
    const label = change.key || change.title || change.nodeId || '';
    const id = change.action === 'created' && change.nodeId ? `  (${change.nodeId})` : '';
    process.stdout.write(`  ${mark} ${change.operation} ${label}${id}\n`);
  }
  if (result.backupPath) {
    process.stdout.write(`backup: ${result.backupPath}\n`);
  }
  if (result.backupError) {
    process.stdout.write(`warning: pre-apply backup failed: ${result.backupError}\n`);
  }
  if (result.dryRun) {
    process.stdout.write('No changes were saved. Remove --dry-run to apply.\n');
  }
}

/* ------------------------------------------------------------------ plans */

function readPlanFile(file) {
  let text;
  if (file === '-') {
    text = fs.readFileSync(0, 'utf8');
  } else {
    const resolved = path.resolve(file);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error(`${file} is not a file.`);
    if (stat.size > protocol.MAX_MESSAGE_BYTES) {
      throw new Error('The plan file is too large.');
    }
    text = fs.readFileSync(resolved, 'utf8');
  }
  if (text.length > protocol.MAX_MESSAGE_BYTES) {
    throw new Error('The plan is too large.');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The plan file is not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The plan must be a JSON object.');
  }
  if (!Array.isArray(parsed.ops)) {
    throw new Error('The plan must contain an "ops" array.');
  }
  const provenance =
    parsed.provenance && typeof parsed.provenance === 'object'
      ? parsed.provenance
      : {
          tool: 'flow-cli',
          ...(Array.isArray(parsed.sourceFiles) ? { sourceFiles: parsed.sourceFiles } : {}),
          ...(typeof parsed.commit === 'string' ? { commit: parsed.commit } : {}),
        };
  return { ops: parsed.ops, provenance };
}

/* -------------------------------------------------------------------- mcp */

const PLAN_OP_SCHEMA = {
  type: 'object',
  properties: {
    op: {
      type: 'string',
      enum: ['upsert-node', 'update-node', 'reparent-node', 'connect'],
    },
    key: {
      type: 'string',
      description:
        'Stable external key such as "module/auth". Required for upsert-node, update-node, and reparent-node.',
    },
    title: { type: 'string' },
    type: {
      type: 'string',
      enum: [...NODE_TYPES, ...CONNECTION_TYPES],
      description: 'Node type for node operations; connection type for connect.',
    },
    parent: {
      type: ['string', 'null'],
      description: 'Parent external key, node id, "@root", or null for top level.',
    },
    description: { type: 'string' },
    markdown: {
      type: 'string',
      description:
        'Markdown documentation. When a code fence quotes repository code, annotate it with ' +
        'file=<workspace-relative path> lines=<start>-<end>, for example ' +
        '```ts file=src/auth/session.ts lines=24-38. Flow renders that header as a link that ' +
        'opens the file in VS Code and selects the range.',
    },
    details: {
      type: 'object',
      description:
        'purpose, inputs, outputs, preconditions, behavior, successResult, failureResult, notes',
    },
    position: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
    },
    source: { type: 'string', description: 'Connect: source key or node id.' },
    target: { type: 'string', description: 'Connect: target key or node id.' },
    label: { type: 'string' },
    sourceFiles: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Workspace-relative source files backing this node; Flow lists them as openable links.',
    },
  },
  required: ['op'],
};

const MCP_TOOLS = [
  {
    name: 'flow_status',
    description:
      'Show the Flow project linked to this workspace, its node counts, and storage state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'flow_list_nodes',
    description:
      'List the nodes (documentation map) of the active Flow project, with stable node ids, external keys, and paths.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: NODE_TYPES },
        includeMarkdown: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'flow_get_node',
    description:
      'Read one Flow node by stable node id or external key, including Markdown and connections. ' +
      'Provide either "nodeId" or "key". The canvas, node details, and flow_list_nodes all show the node id.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'Stable node id such as "n_..." shown on the node card and in node details.',
        },
        key: {
          type: 'string',
          description: 'Stable external key such as "module/auth".',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'flow_apply_plan',
    description:
      'Validate and apply a batch of documentation operations to the active Flow project. ' +
      'Use dryRun (the default) first. Operations are atomic and idempotent: upsert-node by external key. ' +
      'The result includes createdNodes with the stable node id assigned to each node the plan created.',
    inputSchema: {
      type: 'object',
      properties: {
        ops: {
          type: 'array',
          description:
            'Operations: upsert-node, update-node, reparent-node, connect. ' +
            'Node types: ' +
            NODE_TYPES.join(', ') +
            '. Connection types: ' +
            CONNECTION_TYPES.join(', ') +
            '.',
          items: PLAN_OP_SCHEMA,
        },
        dryRun: { type: 'boolean', default: true },
        provenance: { type: 'object' },
      },
      required: ['ops'],
      additionalProperties: false,
    },
  },
];

function mcpResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function mcpError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function runMcp(workspace) {
  const send = (message) => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  };

  const toolCall = async (name, args) => {
    if (name === 'flow_status') return call('status', {}, { workspace });
    if (name === 'flow_list_nodes') {
      return call(
        'list',
        {
          ...(args.type ? { type: args.type } : {}),
          ...(args.includeMarkdown === true ? { includeMarkdown: true } : {}),
        },
        { workspace },
      );
    }
    if (name === 'flow_get_node') {
      const nodeId = typeof args.nodeId === 'string' ? args.nodeId.trim() : '';
      const key = typeof args.key === 'string' ? args.key.trim() : '';
      if (!nodeId && !key) {
        throw new Error('flow_get_node needs a "nodeId" or "key".');
      }
      return call('get', nodeId ? { nodeId } : { ref: key }, { workspace });
    }
    if (name === 'flow_apply_plan') {
      if (!Array.isArray(args.ops) || args.ops.length === 0) {
        throw new Error('flow_apply_plan needs a non-empty "ops" array.');
      }
      return call(
        'apply',
        {
          ops: args.ops,
          dryRun: args.dryRun !== false,
          provenance:
            args.provenance && typeof args.provenance === 'object'
              ? args.provenance
              : { tool: 'flow-mcp' },
        },
        { timeoutMs: 120_000, workspace },
      );
    }
    throw new Error(`Unknown tool "${name}".`);
  };

  const handle = async (message) => {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') return;
    const id = message.id;
    const method = message.method;

    if (method === 'initialize') {
      send(
        mcpResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'flow', version: VERSION },
        }),
      );
      return;
    }
    if (method === 'notifications/initialized' || id === undefined) return;
    if (method === 'ping') {
      send(mcpResponse(id, {}));
      return;
    }
    if (method === 'tools/list') {
      send(mcpResponse(id, { tools: MCP_TOOLS }));
      return;
    }
    if (method === 'tools/call') {
      const name = message.params && message.params.name;
      const args =
        message.params && typeof message.params.arguments === 'object'
          ? message.params.arguments
          : {};
      try {
        const { response, queued, workspace } = await toolCall(name, args);
        if (queued) {
          send(
            mcpResponse(id, {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    ok: false,
                    errors: [
                      `Flow is not running for ${workspace}. Open the Flow panel in VS Code first.`,
                    ],
                  }),
                },
              ],
              isError: true,
            }),
          );
          return;
        }
        const payload = response || { ok: false, errors: ['No response from Flow.'] };
        send(
          mcpResponse(id, {
            content: [{ type: 'text', text: JSON.stringify(payload) }],
            isError: payload.ok !== true,
          }),
        );
      } catch (error) {
        send(
          mcpResponse(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ok: false,
                  errors: [error instanceof Error ? error.message : 'Tool call failed.'],
                }),
              },
            ],
            isError: true,
          }),
        );
      }
      return;
    }

    send(mcpError(id, -32601, `Method not found: ${String(method)}`));
  };

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        try {
          void handle(JSON.parse(line));
        } catch {
          send(mcpError(null, -32700, 'Parse error'));
        }
      }
      index = buffer.indexOf('\n');
    }
  });

  await new Promise((resolve) => {
    process.stdin.on('end', resolve);
    process.stdin.on('close', resolve);
  });
}

/* ----------------------------------------------------------- claude skill */

function installSkill(force) {
  const claudeHome =
    process.env.CLAUDE_CONFIG_DIR && process.env.CLAUDE_CONFIG_DIR.trim()
      ? path.resolve(process.env.CLAUDE_CONFIG_DIR.trim())
      : path.join(os.homedir(), '.claude');
  const skillFile = path.join(claudeHome, 'skills', 'flow', 'SKILL.md');
  const commandFile = path.join(claudeHome, 'commands', 'flow-help.md');
  const written = [];
  const skipped = [];

  const write = (file, content) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && !force) {
      skipped.push(file);
      return;
    }
    fs.writeFileSync(file, content, { mode: 0o644 });
    written.push(file);
  };

  write(skillFile, SKILL_MARKDOWN);
  write(commandFile, FLOW_HELP_COMMAND);

  for (const file of written) process.stdout.write(`wrote ${file}\n`);
  for (const file of skipped) {
    process.stdout.write(`exists ${file} (use --force to overwrite)\n`);
  }
}

/* ------------------------------------------------------------------- main */

async function main() {
  const { command, options, positional } = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  switch (command) {
    case 'help':
      if (options.json) printJson({ version: VERSION, commands: COMMANDS });
      else printHelp();
      return;

    case 'version':
      if (options.json) printJson({ version: VERSION });
      else process.stdout.write(`${VERSION}\n`);
      return;

    case 'status': {
      const { response, queued, id } = await call('status', {}, { timeoutMs: 15_000 });
      if (queued) {
        if (options.json) printJson({ queued: true, id });
        else process.stdout.write(`Queued ${id}. Flow is not running.\n`);
        process.exitCode = 3;
        return;
      }
      if (options.json) printJson(response);
      else if (!requireOk(response)) throw new Error(responseErrors(response).join('\n'));
      else printStatus(response.result);
      if (!requireOk(response)) process.exitCode = 1;
      return;
    }

    case 'list': {
      const { response, queued, id } = await call(
        'list',
        {
          ...(options.type ? { type: options.type } : {}),
          ...(options.includeMarkdown ? { includeMarkdown: true } : {}),
        },
        { timeoutMs: 20_000 },
      );
      if (queued) {
        if (options.json) printJson({ queued: true, id });
        else process.stdout.write(`Queued ${id}. Flow is not running.\n`);
        process.exitCode = 3;
        return;
      }
      if (options.json) printJson(response);
      else if (!requireOk(response)) throw new Error(responseErrors(response).join('\n'));
      else printTree(response.result.nodes);
      if (!requireOk(response)) process.exitCode = 1;
      return;
    }

    case 'get': {
      const ref = positional[0];
      if (!ref) throw new Error('Usage: flow get <key|id>');
      const { response, queued, id } = await call('get', { ref }, { timeoutMs: 20_000 });
      if (queued) {
        if (options.json) printJson({ queued: true, id });
        else process.stdout.write(`Queued ${id}. Flow is not running.\n`);
        process.exitCode = 3;
        return;
      }
      if (options.json) {
        printJson(response);
      } else if (!requireOk(response)) {
        throw new Error(responseErrors(response).join('\n'));
      } else {
        const node = response.result.node;
        process.stdout.write(`${node.title} [${node.type}] ${node.id}\n`);
        if (node.externalKey) process.stdout.write(`key: ${node.externalKey}\n`);
        process.stdout.write(`path: ${node.path}\n`);
        if (node.markdown) process.stdout.write(`\n${node.markdown}\n`);
        if (response.result.connections.length > 0) {
          process.stdout.write('\nconnections:\n');
          for (const connection of response.result.connections) {
            process.stdout.write(
              `  ${connection.sourceKey} -> ${connection.targetKey}` +
                `${connection.type ? ` (${connection.type})` : ''}\n`,
            );
          }
        }
      }
      if (!requireOk(response)) process.exitCode = 1;
      return;
    }

    case 'apply': {
      const file = positional[0];
      if (!file) throw new Error('Usage: flow apply <plan.json|-> [--dry-run]');
      const plan = readPlanFile(file);
      const dryRun = options.dryRun;
      const { response, queued, id } = await call(
        'apply',
        { ops: plan.ops, dryRun, provenance: plan.provenance },
        { timeoutMs: options.timeout || 120_000, queue: !dryRun },
      );
      if (queued) {
        if (options.json) printJson({ queued: true, id });
        else {
          process.stdout.write(`Queued ${id}. It will run when Flow next starts.\n`);
          process.stdout.write(`Check later with: flow result ${id} --wait\n`);
        }
        process.exitCode = 3;
        return;
      }
      if (options.json) printJson(response);
      else if (!requireOk(response)) throw new Error(responseErrors(response).join('\n'));
      else printApply(response.result);
      if (!requireOk(response)) process.exitCode = 1;
      return;
    }

    case 'open': {
      const { response, queued, id } = await call('open', {}, { timeoutMs: 15_000 });
      if (queued) {
        process.stdout.write(`Queued ${id}. Start VS Code to open Flow.\n`);
        process.exitCode = 3;
        return;
      }
      if (!requireOk(response)) throw new Error(responseErrors(response).join('\n'));
      if (options.json) printJson(response);
      else process.stdout.write('Flow is open.\n');
      return;
    }

    case 'link': {
      const { response, queued, id } = await call('link', {}, { timeoutMs: 30_000 });
      if (queued) {
        process.stdout.write(`Queued ${id}. Flow is not running.\n`);
        process.exitCode = 3;
        return;
      }
      if (!requireOk(response)) throw new Error(responseErrors(response).join('\n'));
      if (options.json) printJson(response);
      else {
        process.stdout.write(
          `Linked ${response.result.workspacePath} to ${response.result.projectId}.\n`,
        );
      }
      return;
    }

    case 'result': {
      const id = positional[0];
      if (!id) throw new Error('Usage: flow result <id> [--wait]');
      const workspace = resolveWorkspace();
      const root = protocol.dataDir();
      const key = protocol.workspaceKey(workspace);
      const timeoutMs = options.timeout || 120_000;
      const deadline = Date.now() + timeoutMs;
      let result = protocol.readResult(root, key, id);
      while (!result && options.wait && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        result = protocol.readResult(root, key, id);
      }
      if (!result) {
        throw new Error(
          options.wait
            ? `No result for ${id} yet. Is Flow running in this workspace?`
            : `No result for ${id}. Use --wait to keep checking.`,
        );
      }
      if (options.json) printJson(result);
      else if (result.ok !== true) {
        throw new Error(responseErrors(result).join('\n'));
      } else if (result.result && result.result.dryRun !== undefined) {
        printApply(result.result);
      } else {
        printJson(result.result ?? result);
      }
      if (result.ok !== true) process.exitCode = 1;
      return;
    }

    case 'mcp':
      await runMcp(options.workspace);
      return;

    case 'install-skill':
      installSkill(options.force);
      return;

    default:
      printError(`Unknown command "${command}".`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  printError(error instanceof Error ? error.message : 'Unexpected error.');
  process.exitCode = 1;
});
