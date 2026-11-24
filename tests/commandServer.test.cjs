'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { CommandServer } = require('../src/extension/commandServer.cjs');
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
      reject(new Error('Timed out waiting for the command server.'));
    }, 3000);

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
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

test('serves commands over the workspace socket and rejects other workspaces', async (t) => {
  const workspace = tempDir('flow-cmd-ws-');
  const appData = tempDir('flow-cmd-data-');
  const other = tempDir('flow-cmd-other-');

  const server = new CommandServer({
    workspacePath: workspace,
    appDataDir: appData,
    handler: async (request) => ({
      ok: true,
      result: { command: request.command, payload: request.payload },
    }),
    logger: { error: () => {} },
  });
  t.after(() => server.dispose());

  const socketPath = await server.start();
  assert.equal(socketPath, protocol.socketPath(appData, protocol.workspaceKey(workspace)));

  const response = await sendRequest(socketPath, {
    id: 'req_1',
    command: 'ping',
    workspace,
    payload: { hello: true },
  });
  assert.equal(response.ok, true);
  assert.equal(response.result.command, 'ping');
  assert.deepEqual(response.result.payload, { hello: true });

  const rejected = await sendRequest(socketPath, {
    id: 'req_2',
    command: 'ping',
    workspace: other,
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.errors.join('\n'), /linked to/);

  const invalid = await sendRequest(socketPath, {
    id: 'req_3',
    command: 'not-a-command',
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.errors.join('\n'), /Unknown command/);
});

test('accepts requests from a subdirectory of the workspace', async (t) => {
  const workspace = tempDir('flow-cmd-sub-');
  const child = path.join(workspace, 'nested');
  fs.mkdirSync(child);
  const appData = tempDir('flow-cmd-subdata-');

  const server = new CommandServer({
    workspacePath: workspace,
    appDataDir: appData,
    handler: async () => ({ ok: true, result: { nested: true } }),
    logger: { error: () => {} },
  });
  t.after(() => server.dispose());
  const socketPath = await server.start();

  const response = await sendRequest(socketPath, {
    id: 'req_sub',
    command: 'ping',
    workspace: child,
  });
  assert.equal(response.ok, true);
});

test('a second server for the same workspace does not steal the live socket', async (t) => {
  const workspace = tempDir('flow-cmd-dupe-');
  const appData = tempDir('flow-cmd-dupedata-');
  const makeServer = () =>
    new CommandServer({
      workspacePath: workspace,
      appDataDir: appData,
      handler: async () => ({ ok: true, result: { alive: true } }),
      logger: { error: () => {} },
    });

  const first = makeServer();
  t.after(() => first.dispose());
  const socketPath = await first.start();

  const second = makeServer();
  t.after(() => second.dispose());
  await assert.rejects(second.start(), /EADDRINUSE|address already in use/i);

  const response = await sendRequest(socketPath, {
    id: 'req_alive',
    command: 'ping',
    workspace,
  });
  assert.equal(response.ok, true);
  assert.equal(response.result.alive, true);
});

test('drains queued requests and writes results', async (t) => {
  const workspace = tempDir('flow-cmd-queue-');
  const appData = tempDir('flow-cmd-queuedata-');
  const key = protocol.workspaceKey(workspace);

  const server = new CommandServer({
    workspacePath: workspace,
    appDataDir: appData,
    handler: async (request) => ({
      ok: true,
      result: { command: request.command },
    }),
    logger: { error: () => {} },
  });
  t.after(() => server.dispose());
  await server.start();

  protocol.queueRequest(appData, key, {
    id: 'queued_1',
    command: 'ping',
    workspace,
    payload: {},
  });

  await server.drainQueue();

  const result = protocol.readResult(appData, key, 'queued_1');
  assert.equal(result.ok, true);
  assert.equal(result.result.command, 'ping');
  assert.equal(protocol.listQueuedRequests(appData, key).length, 0);
});
