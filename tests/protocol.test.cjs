'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const protocol = require('../src/extension/protocol.cjs');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('dataDir honours FLOW_DATA_DIR and platform defaults', () => {
  const override = tempDir('flow-data-');
  assert.equal(
    protocol.dataDir({ FLOW_DATA_DIR: override }, 'linux', '/home/test'),
    override,
  );
  assert.equal(
    protocol.dataDir({}, 'linux', '/home/test'),
    path.join('/home/test', '.local', 'share', 'flow'),
  );
  assert.equal(
    protocol.dataDir({ XDG_DATA_HOME: '/xdg' }, 'linux', '/home/test'),
    path.join('/xdg', 'flow'),
  );
  assert.equal(
    protocol.dataDir({}, 'darwin', '/Users/test'),
    path.join('/Users/test', 'Library', 'Application Support', 'flow'),
  );
});

test('workspace keys are stable, distinct, and support subdirectories', () => {
  const root = tempDir('flow-ws-');
  const child = path.join(root, 'packages', 'app');
  fs.mkdirSync(child, { recursive: true });

  const rootKey = protocol.workspaceKey(root);
  assert.match(rootKey, /^[a-f0-9]{16}$/);
  assert.equal(rootKey, protocol.workspaceKey(root));
  assert.notEqual(rootKey, protocol.workspaceKey(child));

  const normalizedRoot = protocol.normalizeWorkspace(root);
  assert.equal(protocol.isInsideWorkspace(normalizedRoot, protocol.normalizeWorkspace(child)), true);
  assert.equal(protocol.isInsideWorkspace(normalizedRoot, protocol.normalizeWorkspace(os.tmpdir())), false);
});

test('workspace map round-trips and is written with private permissions', () => {
  const root = tempDir('flow-map-');
  const workspace = tempDir('flow-map-ws-');
  const key = protocol.workspaceKey(workspace);

  assert.equal(protocol.getWorkspaceEntry(root, key), null);
  protocol.setWorkspaceEntry(root, key, {
    projectId: 'p_demo',
    workspacePath: workspace,
    name: 'demo',
  });

  const entry = protocol.getWorkspaceEntry(root, key);
  assert.equal(entry.projectId, 'p_demo');
  assert.equal(entry.name, 'demo');
  assert.ok(entry.linkedAt);

  if (process.platform !== 'win32') {
    const mode = fs.statSync(path.join(root, 'workspaces.json')).mode & 0o777;
    assert.equal(mode, 0o600);
  }

  assert.equal(protocol.removeWorkspaceEntry(root, key), true);
  assert.equal(protocol.getWorkspaceEntry(root, key), null);
});

test('pre-apply backups stay outside the workspace and sanitize project ids', () => {
  const root = tempDir('flow-backup-');
  const backup = {
    format: 'flow-backup',
    version: 4,
    exportedAt: new Date().toISOString(),
    projects: [],
  };

  const file = protocol.writeProjectBackup(root, 'p_demo', backup);
  assert.ok(file.startsWith(`${protocol.backupDir(root)}${path.sep}`));
  assert.equal(fs.existsSync(file), true);
  assert.deepEqual(protocol.readJson(file), backup);

  const weird = protocol.writeProjectBackup(root, '../../evil', backup);
  assert.ok(weird.startsWith(`${protocol.backupDir(root)}${path.sep}`));
  assert.equal(path.basename(weird).includes('..'), false);

  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }

  protocol.writeProjectBackup(root, 'p_second', backup);
  protocol.cleanupBackups(root, 1);
  const remaining = fs
    .readdirSync(protocol.backupDir(root))
    .filter((name) => name.endsWith('.flow.json'));
  assert.equal(remaining.length, 1);
});

test('requests are validated before they reach a handler', () => {
  assert.equal(protocol.validateRequest(null).ok, false);
  assert.equal(protocol.validateRequest({ id: 'x', command: 'nope' }).ok, false);
  assert.equal(protocol.validateRequest({ id: '', command: 'ping' }).ok, false);
  assert.equal(
    protocol.validateRequest({ id: 'x', command: 'apply', payload: [] }).ok,
    false,
  );

  const valid = protocol.validateRequest({
    id: 'req_1',
    command: 'apply',
    workspace: '/tmp/example',
    payload: { ops: [] },
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.request.command, 'apply');
});

test('line decoder handles partial chunks and rejects invalid JSON', () => {
  const messages = [];
  const errors = [];
  const decode = protocol.createLineDecoder({
    onMessage: (message) => messages.push(message),
    onError: (error) => errors.push(error.message),
  });

  decode('{"a":');
  decode('1}\n{"b":2}\nnot json\n');
  assert.deepEqual(messages, [{ a: 1 }, { b: 2 }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /valid JSON/);
});

test('line decoder enforces the message size limit', () => {
  const messages = [];
  const errors = [];
  const decode = protocol.createLineDecoder({
    maxBytes: 16,
    onMessage: (message) => messages.push(message),
    onError: (error) => errors.push(error.message),
  });
  decode('{"long":"012345678901234567890"}\n');
  assert.equal(messages.length, 0);
  assert.match(errors[0], /exceeds/);
});
