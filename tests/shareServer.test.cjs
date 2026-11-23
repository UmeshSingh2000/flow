'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ShareServer } = require('../src/extension/shareServer.cjs');

function makeWebviewRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-share-test-'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><html><head><title>Flow</title></head><body><div id="root"></div><script type="module" src="./assets/app.js"></script><link rel="stylesheet" href="./assets/app.css"></body></html>',
  );
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log("viewer");');
  fs.writeFileSync(path.join(root, 'assets', 'app.css'), 'body{margin:0}');
  return root;
}

function emptyDetails() {
  return {
    purpose: '',
    inputs: '',
    outputs: '',
    preconditions: '',
    behavior: '',
    successResult: '',
    failureResult: '',
    notes: '',
  };
}

function makeSnapshot(name = 'Demo project') {
  return {
    format: 'flow-backup',
    version: 3,
    exportedAt: new Date().toISOString(),
    projects: [
      {
        id: 'p1',
        name,
        description: '',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        nodes: [
          {
            id: 'root',
            projectId: 'p1',
            parentId: null,
            type: 'project',
            title: 'Root',
            description: '',
            markdown: '',
            images: [],
            details: emptyDetails(),
            position: { x: 0, y: 0 },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        connections: [],
      },
    ],
  };
}

function createServer(options = {}) {
  const webviewRoot = options.webviewRoot || makeWebviewRoot();
  return new ShareServer({
    webviewRoot,
    bindHost: '127.0.0.1',
    urlHost: '127.0.0.1',
    ...options,
  });
}

function withHeaders(key, extra = {}) {
  return { headers: { 'X-Flow-Share-Key': key, ...extra } };
}

test('serves the viewer page with an injected bootstrap and static assets', async (t) => {
  const server = createServer();
  t.after(() => server.dispose());
  const share = await server.start({
    snapshot: makeSnapshot(),
    theme: 'dark',
    owner: 'test',
  });
  const base = `http://127.0.0.1:${share.port}`;

  const page = await fetch(`${base}/s/${share.shareId}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /__FLOW_SHARE__/);
  assert.match(html, /"theme":"dark"/);
  assert.match(html, /src="\/s\/assets\/app\.js"/);
  assert.match(html, /href="\/s\/assets\/app\.css"/);
  assert.match(page.headers.get('content-security-policy') || '', /nonce-/);

  const asset = await fetch(`${base}/s/assets/app.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type') || '', /javascript/);
  assert.equal(await asset.text(), 'console.log("viewer");');

  const unknown = await fetch(`${base}/s/doesnotexist0`);
  assert.equal(unknown.status, 410);
});

test('requires the password and serves the snapshot with an ETag', async (t) => {
  const server = createServer();
  t.after(() => server.dispose());
  const share = await server.start({ snapshot: makeSnapshot(), owner: 'test' });
  const url = `http://127.0.0.1:${share.port}/api/shares/${share.shareId}/snapshot`;

  const missing = await fetch(url);
  assert.equal(missing.status, 401);

  const wrong = await fetch(url, withHeaders('definitely-wrong'));
  assert.equal(wrong.status, 401);

  const good = await fetch(url, withHeaders(share.password));
  assert.equal(good.status, 200);
  const etag = good.headers.get('etag');
  assert.ok(etag);
  const payload = await good.json();
  assert.equal(payload.backup.projects[0].name, 'Demo project');

  const unchanged = await fetch(url, withHeaders(share.password, { 'If-None-Match': etag }));
  assert.equal(unchanged.status, 304);
});

test('updates the snapshot behind a running share', async (t) => {
  const server = createServer();
  t.after(() => server.dispose());
  const share = await server.start({ snapshot: makeSnapshot('Before'), owner: 'test' });
  await server.update({
    shareId: share.shareId,
    snapshot: makeSnapshot('After'),
    owner: 'test',
  });

  const response = await fetch(
    `http://127.0.0.1:${share.port}/api/shares/${share.shareId}/snapshot`,
    withHeaders(share.password),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.backup.projects[0].name, 'After');
});

test('accepts a caller-chosen password and rejects other methods', async (t) => {
  const server = createServer();
  t.after(() => server.dispose());
  const share = await server.start({
    snapshot: makeSnapshot(),
    password: 'open-sesame',
    owner: 'test',
  });
  assert.equal(share.password, 'open-sesame');

  const snapshotUrl = `http://127.0.0.1:${share.port}/api/shares/${share.shareId}/snapshot`;
  const good = await fetch(snapshotUrl, withHeaders('open-sesame'));
  assert.equal(good.status, 200);

  const post = await fetch(snapshotUrl, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('blocks brute-force attempts without locking out the right password forever', async (t) => {
  const server = createServer();
  t.after(() => server.dispose());
  const share = await server.start({ snapshot: makeSnapshot(), owner: 'test' });
  const url = `http://127.0.0.1:${share.port}/api/shares/${share.shareId}/snapshot`;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(url, withHeaders(`wrong-${attempt}`));
    assert.equal(response.status, 401);
  }

  const blocked = await fetch(url, withHeaders(share.password));
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
});

test('expires shares and stops serving their snapshots', async (t) => {
  const server = createServer({ ttlMs: 15 });
  t.after(() => server.dispose());
  const share = await server.start({ snapshot: makeSnapshot(), owner: 'test' });
  await new Promise((resolve) => setTimeout(resolve, 40));

  const url = `http://127.0.0.1:${share.port}/api/shares/${share.shareId}/snapshot`;
  const response = await fetch(url, withHeaders(share.password));
  assert.equal(response.status, 410);

  const page = await fetch(`http://127.0.0.1:${share.port}/s/${share.shareId}`);
  assert.equal(page.status, 410);
});

test('rejects malformed snapshots and path traversal', async (t) => {
  const server = createServer();
  t.after(() => server.dispose());

  await assert.rejects(
    server.start({ snapshot: { format: 'flow-backup', version: 3, projects: [] } }),
    /exactly one project/,
  );
  await assert.rejects(server.start({ snapshot: null }), /backup object/);

  const share = await server.start({ snapshot: makeSnapshot(), owner: 'test' });
  const traversal = await fetch(
    `http://127.0.0.1:${share.port}/s/assets/..%2F..%2Fpackage.json`,
  );
  assert.equal(traversal.status, 404);
});

test('stopping a share removes its snapshot and shuts the listener down', async (t) => {
  const server = createServer();
  t.after(() => server.dispose());
  const share = await server.start({ snapshot: makeSnapshot(), owner: 'test' });
  const stopped = await server.stop(share.shareId, 'test');
  assert.equal(stopped, true);

  // With no shares left the listener closes; either a refusal or a 410 is fine.
  let status = 410;
  try {
    const response = await fetch(
      `http://127.0.0.1:${share.port}/api/shares/${share.shareId}/snapshot`,
      withHeaders(share.password),
    );
    status = response.status;
  } catch {
    status = 0;
  }
  assert.ok(status === 410 || status === 0, `unexpected status ${status}`);
});
