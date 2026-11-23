'use strict';

/**
 * Read-only LAN sharing for Flow.
 *
 * The VS Code extension host (Node) runs this tiny HTTP server. The webview
 * sends a versioned backup snapshot; guests on the same network open
 * /s/<shareId>, enter a password, and read the board. The server exposes only
 * GET/HEAD routes, so there is no write path for a viewer to reach — sharing
 * is structurally read-only.
 *
 * No database and no external service: snapshots live in this process's
 * memory and disappear when the share stops or the extension closes.
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHARE_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const ID_LENGTH = 10;
const PASSWORD_LENGTH = 8;
const MIN_PASSWORD_LENGTH = 4;
const MAX_PASSWORD_LENGTH = 64;
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const LOCKOUT_MS = 60 * 1000;
const ASSET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function randomFromAlphabet(length, alphabet) {
  let out = '';
  while (out.length < length) {
    const bytes = crypto.randomBytes(length * 2);
    for (const byte of bytes) {
      // Reject the tail so every character is equally likely.
      if (byte >= 256 - (256 % alphabet.length)) continue;
      out += alphabet.charAt(byte % alphabet.length);
      if (out.length === length) break;
    }
  }
  return out;
}

function hashKey(shareId, password) {
  return crypto
    .createHash('sha256')
    .update(`flow-share:${shareId}:${password}`)
    .digest();
}

function normalizePassword(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
  }
  if (trimmed.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Use at most ${MAX_PASSWORD_LENGTH} characters for the password.`);
  }
  return trimmed;
}

const VIRTUAL_INTERFACE_HINTS = [
  'docker',
  'br-',
  'veth',
  'vmnet',
  'vmware',
  'virtualbox',
  'tailscale',
  'tun',
  'tap',
  'utun',
  'zt',
  'ham',
];

/** Best guess at the address another device on the same network can reach. */
function pickLanAddress() {
  const candidates = [];
  const interfaces = os.networkInterfaces();
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses || []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      const ip = address.address;
      let score = 5;
      if (/^192\.168\./.test(ip)) score = 30;
      else if (/^10\./.test(ip)) score = 25;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) score = 20;
      const lower = name.toLowerCase();
      if (VIRTUAL_INTERFACE_HINTS.some((hint) => lower.includes(hint))) score -= 40;
      if (/^(wl|wlan|wi-?fi|en|eth)/.test(lower)) score += 5;
      candidates.push({ ip, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.length > 0 ? candidates[0].ip : '127.0.0.1';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class ShareServer {
  constructor(options = {}) {
    this.webviewRoot = options.webviewRoot;
    this.bindHost = options.bindHost || '0.0.0.0';
    this.urlHost = options.urlHost || null;
    this.ttlMs = options.ttlMs || SHARE_TTL_MS;
    this.shares = new Map();
    this.server = null;
    this.port = null;
    this.starting = null;
    this.indexHtml = null;
  }

  /** Creates a share; returns the link, id, and the only copy of the password. */
  async start({ snapshot, password, theme, owner, projectName }) {
    const normalizedPassword = normalizePassword(password);
    const { backup } = this.validateSnapshot(snapshot);
    await this.ensureServer();

    const shareId = randomFromAlphabet(ID_LENGTH, ID_ALPHABET);
    const key =
      normalizedPassword || randomFromAlphabet(PASSWORD_LENGTH, ID_ALPHABET);
    const now = Date.now();
    const expiresAt = now + this.ttlMs;
    const share = {
      id: shareId,
      keyHash: hashKey(shareId, key),
      body: '',
      etag: '',
      createdAt: now,
      updatedAt: now,
      expiresAt,
      theme: theme === 'dark' ? 'dark' : 'light',
      owner,
      projectName:
        projectName ||
        (backup.projects[0] && backup.projects[0].name) ||
        'Untitled project',
      failures: new Map(),
    };
    this.refreshBody(share, backup, now);
    this.shares.set(shareId, share);

    return {
      shareId,
      url: `http://${this.urlHost || pickLanAddress()}:${this.port}/s/${shareId}`,
      port: this.port,
      password: key,
      expiresAt: new Date(expiresAt).toISOString(),
      projectName: share.projectName,
    };
  }

  /** Replaces the snapshot behind a running share as the owner edits. */
  async update({ shareId, snapshot, owner }) {
    const share = this.getShare(shareId);
    if (!share) throw new Error('This share is no longer running.');
    if (owner && share.owner !== owner) {
      throw new Error('This share belongs to another Flow window.');
    }
    const { backup } = this.validateSnapshot(snapshot);
    share.projectName =
      (backup.projects[0] && backup.projects[0].name) || share.projectName;
    this.refreshBody(share, backup, Date.now());
  }

  async stop(shareId, owner) {
    const share = this.shares.get(shareId);
    if (!share) return false;
    if (owner && share.owner !== owner) return false;
    this.shares.delete(shareId);
    await this.closeIfIdle();
    return true;
  }

  async stopByOwner(owner) {
    if (!owner) return;
    for (const [shareId, share] of this.shares) {
      if (share.owner === owner) this.shares.delete(shareId);
    }
    await this.closeIfIdle();
  }

  async dispose() {
    this.shares.clear();
    await this.closeServer();
  }

  /* -------------------------------------------------------------- internals */

  refreshBody(share, backup, now) {
    share.body = JSON.stringify({
      backup,
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(share.expiresAt).toISOString(),
    });
    share.etag = `"${crypto
      .createHash('sha256')
      .update(share.body)
      .digest('hex')
      .slice(0, 24)}"`;
    share.updatedAt = now;
  }

  validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new Error('The share payload is not a backup object.');
    }
    if (snapshot.format !== 'flow-backup') {
      throw new Error('The share payload is not a Flow backup.');
    }
    if (!Number.isInteger(snapshot.version) || snapshot.version < 1) {
      throw new Error('The share payload has no valid schema version.');
    }
    if (!Array.isArray(snapshot.projects) || snapshot.projects.length !== 1) {
      throw new Error('Share exactly one project at a time.');
    }
    const project = snapshot.projects[0];
    if (
      !project ||
      typeof project !== 'object' ||
      typeof project.id !== 'string' ||
      !project.id ||
      typeof project.name !== 'string' ||
      !Array.isArray(project.nodes) ||
      !Array.isArray(project.connections)
    ) {
      throw new Error('The shared project is malformed.');
    }
    const text = JSON.stringify(snapshot);
    if (Buffer.byteLength(text, 'utf8') > MAX_SNAPSHOT_BYTES) {
      throw new Error('This project is too large to share (limit 20 MB).');
    }
    return { backup: snapshot };
  }

  getShare(shareId) {
    const share = this.shares.get(shareId);
    if (!share) return null;
    if (Date.now() > share.expiresAt) {
      this.shares.delete(shareId);
      // Let the current response (normally a 410) flush before tearing down.
      setTimeout(() => {
        void this.closeIfIdle();
      }, 250);
      return null;
    }
    return share;
  }

  ensureServer() {
    if (this.server) return Promise.resolve();
    if (this.starting) return this.starting;

    this.starting = new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        this.handle(request, response).catch(() => {
          if (!response.headersSent) {
            response.writeHead(500, {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-store',
            });
          }
          response.end('Internal server error');
        });
      });

      const onError = (error) => {
        server.removeListener('listening', onListening);
        this.starting = null;
        reject(error);
      };
      const onListening = () => {
        server.removeListener('error', onError);
        // Keep later socket errors from becoming uncaught exceptions.
        server.on('error', () => {});
        this.server = server;
        this.port = server.address().port;
        this.starting = null;
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(0, this.bindHost);
    });

    return this.starting;
  }

  async closeIfIdle() {
    if (this.shares.size > 0) return;
    await this.closeServer();
  }

  async closeServer() {
    const server = this.server;
    if (!server) return;
    this.server = null;
    this.port = null;
    await new Promise((resolve) => {
      server.close(() => resolve());
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
    });
  }

  baseHeaders(extra = {}) {
    return {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Resource-Policy': 'same-origin',
      ...extra,
    };
  }

  sendJson(request, response, status, payload, extra = {}) {
    const body = JSON.stringify(payload);
    response.writeHead(
      status,
      this.baseHeaders({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body, 'utf8'),
        'Cache-Control': 'no-store',
        ...extra,
      }),
    );
    if (request.method === 'HEAD') response.end();
    else response.end(body);
  }

  sendText(request, response, status, text, extra = {}) {
    response.writeHead(
      status,
      this.baseHeaders({
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(text, 'utf8'),
        'Cache-Control': 'no-store',
        ...extra,
      }),
    );
    if (request.method === 'HEAD') response.end();
    else response.end(text);
  }

  async handle(request, response) {
    const method = request.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      this.sendJson(request, response, 405, { error: 'method-not-allowed' }, {
        Allow: 'GET, HEAD',
      });
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url || '/', 'http://flow.local').pathname,
      );
    } catch {
      this.sendJson(request, response, 400, { error: 'bad-request' });
      return;
    }

    if (pathname === '/favicon.ico') {
      response.writeHead(204, this.baseHeaders());
      response.end();
      return;
    }

    if (pathname.startsWith('/s/assets/')) {
      await this.serveAsset(request, response, pathname.slice('/s/assets/'.length));
      return;
    }

    const viewerMatch = /^\/s\/([A-Za-z0-9]+)$/.exec(pathname);
    if (viewerMatch) {
      await this.serveViewer(request, response, viewerMatch[1]);
      return;
    }

    const snapshotMatch = /^\/api\/shares\/([A-Za-z0-9]+)\/snapshot$/.exec(
      pathname,
    );
    if (snapshotMatch) {
      this.serveSnapshot(request, response, snapshotMatch[1]);
      return;
    }

    this.sendJson(request, response, 404, { error: 'not-found' });
  }

  async serveAsset(request, response, file) {
    if (
      !file ||
      file.includes('/') ||
      file.includes('\\') ||
      file.includes('..') ||
      !ASSET_PATTERN.test(file)
    ) {
      this.sendText(request, response, 404, 'Not found');
      return;
    }

    const assetsRoot = path.resolve(this.webviewRoot, 'assets');
    const resolved = path.resolve(assetsRoot, file);
    if (!resolved.startsWith(`${assetsRoot}${path.sep}`)) {
      this.sendText(request, response, 404, 'Not found');
      return;
    }

    let data;
    try {
      data = await fs.promises.readFile(resolved);
    } catch {
      this.sendText(request, response, 404, 'Not found');
      return;
    }

    const type =
      CONTENT_TYPES[path.extname(resolved).toLowerCase()] ||
      'application/octet-stream';
    response.writeHead(
      200,
      this.baseHeaders({
        'Content-Type': type,
        'Content-Length': data.length,
        'Cache-Control': 'public, max-age=31536000, immutable',
      }),
    );
    if (request.method === 'HEAD') response.end();
    else response.end(data);
  }

  async serveViewer(request, response, shareId) {
    const share = this.getShare(shareId);
    if (!share) {
      this.sendEndedPage(request, response, 410, 'This share has ended.');
      return;
    }

    let html = this.indexHtml;
    if (html === null) {
      try {
        html = await fs.promises.readFile(
          path.join(this.webviewRoot, 'index.html'),
          'utf8',
        );
      } catch {
        this.sendText(
          request,
          response,
          500,
          'The Flow viewer assets are missing. Reinstall the extension.',
        );
        return;
      }
      // Point the built assets at the share server's static route.
      html = html.replace(/(src|href)="\.?\/assets\//g, '$1="/s/assets/');
      this.indexHtml = html;
    }

    const nonce = crypto.randomBytes(16).toString('base64');
    const bootstrap = {
      shareId: share.id,
      apiBase: `/api/shares/${share.id}`,
      theme: share.theme,
      expiresAt: new Date(share.expiresAt).toISOString(),
    };
    const csp = [
      "default-src 'none'",
      `script-src 'self' 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; ');
    const head = `<meta http-equiv="Content-Security-Policy" content="${csp}"><script nonce="${nonce}">window.__FLOW_SHARE__=${JSON.stringify(
      bootstrap,
    ).replace(/</g, '\\u003c')};</script>`;
    html = html.replace('<head>', `<head>${head}`);

    response.writeHead(
      200,
      this.baseHeaders({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': csp,
      }),
    );
    if (request.method === 'HEAD') response.end();
    else response.end(html);
  }

  serveSnapshot(request, response, shareId) {
    const share = this.getShare(shareId);
    if (!share) {
      this.sendJson(request, response, 410, { error: 'share-ended' });
      return;
    }

    const password = request.headers['x-flow-share-key'];
    if (typeof password !== 'string' || !password) {
      this.sendJson(request, response, 401, { error: 'password-required' });
      return;
    }

    const now = Date.now();
    const ip = this.clientIp(request);
    const entry = this.rateState(share, ip);
    if (entry.blockedUntil > now) {
      const retryAfter = Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000));
      this.sendJson(
        request,
        response,
        429,
        { error: 'too-many-attempts' },
        { 'Retry-After': String(retryAfter) },
      );
      return;
    }

    const supplied = hashKey(share.id, password);
    if (!crypto.timingSafeEqual(supplied, share.keyHash)) {
      this.recordFailure(share, entry, now);
      this.sendJson(request, response, 401, { error: 'incorrect-password' });
      return;
    }
    share.failures.delete(ip);

    const ifNoneMatch = request.headers['if-none-match'];
    if (typeof ifNoneMatch === 'string' && ifNoneMatch === share.etag) {
      response.writeHead(
        304,
        this.baseHeaders({
          ETag: share.etag,
          'Cache-Control': 'no-store',
        }),
      );
      response.end();
      return;
    }

    response.writeHead(
      200,
      this.baseHeaders({
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(share.body, 'utf8'),
        ETag: share.etag,
        'Cache-Control': 'no-store',
      }),
    );
    if (request.method === 'HEAD') response.end();
    else response.end(share.body);
  }

  clientIp(request) {
    const raw = request.socket.remoteAddress || '';
    return raw.replace(/^::ffff:/, '');
  }

  rateState(share, ip) {
    const now = Date.now();
    let entry = share.failures.get(ip);
    if (!entry) {
      entry = { count: 0, first: now, blockedUntil: 0 };
      share.failures.set(ip, entry);
    }
    if (entry.blockedUntil && entry.blockedUntil <= now) {
      entry.count = 0;
      entry.first = now;
      entry.blockedUntil = 0;
    }
    if (now - entry.first > FAILURE_WINDOW_MS) {
      entry.count = 0;
      entry.first = now;
    }
    return entry;
  }

  recordFailure(share, entry, now) {
    entry.count += 1;
    if (entry.count >= MAX_FAILURES) {
      entry.blockedUntil = now + LOCKOUT_MS;
      entry.count = 0;
      entry.first = now;
    }
    if (share.failures.size > 500) {
      for (const [ip, candidate] of share.failures) {
        if (candidate.blockedUntil < now && now - candidate.first > FAILURE_WINDOW_MS) {
          share.failures.delete(ip);
        }
      }
    }
  }

  sendEndedPage(request, response, status, message) {
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Flow — share ended</title>
<style>
:root { font-family: ui-sans-serif, -apple-system, 'Segoe UI', Roboto, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f6f7; color: #18181b; }
.card { max-width: 360px; padding: 28px; border: 1px solid #e4e4e7; border-radius: 10px; background: #fff; }
.mark { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 7px; background: #2563eb; color: #fff; font-weight: 700; }
h1 { margin: 14px 0 6px; font-size: 17px; }
p { margin: 0; color: #71717a; font-size: 12.5px; line-height: 1.5; }
@media (prefers-color-scheme: dark) { body { background: #18181b; color: #f4f4f5; } .card { background: #202024; border-color: #34343a; } p { color: #a1a1aa; } }
</style></head>
<body><div class="card"><div class="mark">F</div><h1>${escapeHtml(message)}</h1>
<p>Ask the owner to start sharing again and send you a fresh link.</p></div></body></html>`;
    response.writeHead(
      status,
      this.baseHeaders({
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(html, 'utf8'),
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      }),
    );
    if (request.method === 'HEAD') response.end();
    else response.end(html);
  }
}

module.exports = { ShareServer, pickLanAddress, SHARE_TTL_MS };
