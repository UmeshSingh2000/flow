'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const protocol = require('../src/extension/protocol.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLI = path.join(REPO_ROOT, 'cli', 'flow.mjs');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(args, options = {}) {
  const dataDir = options.dataDir || tempDir('flow-cli-data-');
  const cwd = options.cwd || tempDir('flow-cli-ws-');
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    env: {
      ...process.env,
      FLOW_DATA_DIR: dataDir,
      ...(options.claudeHome ? { CLAUDE_CONFIG_DIR: options.claudeHome } : {}),
    },
    encoding: 'utf8',
    input: options.input,
    timeout: 15000,
  });
  return { ...result, dataDir, cwd };
}

test('help --json lists commands', () => {
  const result = run(['help', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(Array.isArray(payload.commands));
  const names = payload.commands.map((entry) => entry.name);
  assert.ok(names.includes('apply'));
  assert.ok(names.includes('mcp'));
});

test('status fails clearly when Flow is not running', () => {
  const result = run(['status']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Flow is not running/);
});

test('apply queues when Flow is closed and reports a request id', () => {
  const dataDir = tempDir('flow-cli-queue-');
  const cwd = tempDir('flow-cli-queue-ws-');
  const planFile = path.join(cwd, 'plan.json');
  fs.writeFileSync(
    planFile,
    JSON.stringify({
      ops: [
        {
          op: 'upsert-node',
          key: 'module/auth',
          type: 'module',
          title: 'Auth',
          parent: '@root',
        },
      ],
    }),
  );

  const result = run(['apply', 'plan.json'], { dataDir, cwd });
  assert.equal(result.status, 3, result.stderr);
  const key = protocol.workspaceKey(cwd);
  const queued = protocol.listQueuedRequests(dataDir, key);
  assert.equal(queued.length, 1);
  const request = protocol.readJson(queued[0].file);
  assert.equal(request.command, 'apply');
  assert.equal(request.payload.dryRun, false);
  assert.equal(request.payload.provenance.tool, 'flow-cli');
});

test('dry-run does not queue and fails when Flow is closed', () => {
  const dataDir = tempDir('flow-cli-dry-');
  const cwd = tempDir('flow-cli-dry-ws-');
  fs.writeFileSync(
    path.join(cwd, 'plan.json'),
    JSON.stringify({
      ops: [
        { op: 'upsert-node', key: 'a', type: 'module', title: 'A', parent: '@root' },
      ],
    }),
  );

  const result = run(['apply', 'plan.json', '--dry-run'], { dataDir, cwd });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Flow is not running/);
  assert.equal(protocol.listQueuedRequests(dataDir, protocol.workspaceKey(cwd)).length, 0);
});

test('install-skill writes only to the Claude config directory', () => {
  const claudeHome = tempDir('flow-claude-');
  const result = run(['install-skill', '--force'], { claudeHome });
  assert.equal(result.status, 0, result.stderr);

  const skill = path.join(claudeHome, 'skills', 'flow', 'SKILL.md');
  const command = path.join(claudeHome, 'commands', 'flow-help.md');
  assert.ok(fs.existsSync(skill));
  assert.ok(fs.existsSync(command));
  assert.match(fs.readFileSync(skill, 'utf8'), /name: flow/);
  assert.match(fs.readFileSync(command, 'utf8'), /flow help/);
});

test('mcp responds to initialize over stdio', () => {
  const result = run(['mcp'], {
    cwd: REPO_ROOT,
    input: `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      },
    })}\n`,
  });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  const response = JSON.parse(lines[0]);
  assert.equal(response.id, 1);
  assert.equal(response.result.serverInfo.name, 'flow');
  assert.ok(response.result.capabilities.tools);
});

test('mcp exposes node lookup by stable node id', () => {
  const result = run(['mcp'], {
    cwd: REPO_ROOT,
    input:
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '0' },
        },
      })}\n` +
      `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`,
  });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  const response = JSON.parse(lines.find((line) => JSON.parse(line).id === 2));
  assert.equal(response.result.tools.length, 4);
  const tool = response.result.tools.find((entry) => entry.name === 'flow_get_node');
  assert.ok(tool);
  assert.ok(tool.inputSchema.properties.nodeId);
  assert.ok(tool.inputSchema.properties.key);
  assert.match(tool.description, /nodeId/i);
  assert.match(tool.description, /key/i);
});
