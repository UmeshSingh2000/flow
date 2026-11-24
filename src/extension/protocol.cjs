'use strict';

/**
 * Shared terminal-control protocol helpers.
 *
 * Used by the VS Code extension host (CJS) and the `flow` CLI (ESM importing
 * this file). Everything lives in a per-user application-data directory —
 * never in the user's repository — so a terminal cannot modify project files.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_ID_LENGTH = 100;
const WORKSPACE_MAP_VERSION = 1;
const QUEUE_LIMIT = 50;
const RESULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const RESULT_KEEP = 100;

const COMMANDS = new Set([
  'ping',
  'open',
  'status',
  'list',
  'get',
  'apply',
  'link',
]);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Per-user data directory. `FLOW_DATA_DIR` overrides it (used by tests). */
function dataDir(env = process.env, platform = process.platform, homedir = os.homedir()) {
  const override = env.FLOW_DATA_DIR;
  if (typeof override === 'string' && override.trim()) {
    return path.resolve(override.trim());
  }
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local');
    return path.join(base, 'flow');
  }
  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', 'flow');
  }
  const base =
    typeof env.XDG_DATA_HOME === 'string' && env.XDG_DATA_HOME.trim()
      ? env.XDG_DATA_HOME
      : path.join(homedir, '.local', 'share');
  return path.join(base, 'flow');
}

function normalizeWorkspace(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new Error('A workspace path is required.');
  }
  let resolved;
  try {
    resolved = fs.realpathSync(path.resolve(input.trim()));
  } catch {
    throw new Error(`Workspace not found: ${input}`);
  }
  let isDirectory = true;
  try {
    isDirectory = fs.statSync(resolved).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    throw new Error(`Workspace is not a directory: ${input}`);
  }
  const trimmed =
    resolved.length > 1 ? resolved.replace(/[\\/]+$/, '') : resolved;
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

function workspaceKey(workspacePath) {
  return crypto
    .createHash('sha256')
    .update(normalizeWorkspace(workspacePath))
    .digest('hex')
    .slice(0, 16);
}

function isInsideWorkspace(workspace, candidate) {
  const relative = path.relative(workspace, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function runtimeDir(root) {
  return path.join(root, 'run');
}

function queueDir(root, key) {
  return path.join(root, 'queue', key);
}

function resultDir(root, key) {
  return path.join(root, 'results', key);
}

function backupDir(root) {
  return path.join(root, 'backups');
}

function socketPath(root, key) {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\flow-${key}`
    : path.join(runtimeDir(root), `${key}.sock`);
}

function ensurePrivateDir(dir, mode = 0o700) {
  fs.mkdirSync(dir, { recursive: true, mode });
  try {
    fs.chmodSync(dir, mode);
  } catch {
    /* Windows does not implement POSIX modes; ignore. */
  }
}

function writePrivateFile(file, text) {
  fs.writeFileSync(file, text, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
}

function writeJsonAtomic(file, value) {
  ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  writePrivateFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function emptyWorkspaceMap() {
  return { version: WORKSPACE_MAP_VERSION, workspaces: {} };
}

function readWorkspaceMap(root) {
  const file = path.join(root, 'workspaces.json');
  const raw = readJson(file);
  if (!isRecord(raw) || !isRecord(raw.workspaces)) return emptyWorkspaceMap();
  const workspaces = {};
  for (const [key, entry] of Object.entries(raw.workspaces)) {
    if (!/^[a-f0-9]{16}$/.test(key) || !isRecord(entry)) continue;
    if (typeof entry.projectId !== 'string' || !entry.projectId) continue;
    if (typeof entry.workspacePath !== 'string') continue;
    workspaces[key] = {
      projectId: entry.projectId,
      workspacePath: entry.workspacePath,
      name: typeof entry.name === 'string' ? entry.name : path.basename(entry.workspacePath),
      linkedAt:
        typeof entry.linkedAt === 'string' ? entry.linkedAt : new Date().toISOString(),
    };
  }
  return { version: WORKSPACE_MAP_VERSION, workspaces };
}

function getWorkspaceEntry(root, key) {
  const map = readWorkspaceMap(root);
  return map.workspaces[key] ?? null;
}

function setWorkspaceEntry(root, key, entry) {
  ensurePrivateDir(root);
  const map = readWorkspaceMap(root);
  map.version = WORKSPACE_MAP_VERSION;
  map.workspaces[key] = {
    projectId: entry.projectId,
    workspacePath: entry.workspacePath,
    name: entry.name,
    linkedAt: entry.linkedAt || new Date().toISOString(),
  };
  writeJsonAtomic(path.join(root, 'workspaces.json'), map);
  return map.workspaces[key];
}

function removeWorkspaceEntry(root, key) {
  const map = readWorkspaceMap(root);
  if (!map.workspaces[key]) return false;
  delete map.workspaces[key];
  writeJsonAtomic(path.join(root, 'workspaces.json'), map);
  return true;
}

function validateRequest(raw) {
  if (!isRecord(raw)) {
    return { ok: false, error: 'The request must be a JSON object.' };
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id || id.length > MAX_REQUEST_ID_LENGTH) {
    return { ok: false, error: 'The request needs a valid id.' };
  }
  const command = typeof raw.command === 'string' ? raw.command : '';
  if (!COMMANDS.has(command)) {
    return { ok: false, error: `Unknown command "${command}".` };
  }
  if (raw.workspace !== undefined && typeof raw.workspace !== 'string') {
    return { ok: false, error: 'The workspace must be a path string.' };
  }
  if (raw.payload !== undefined && !isRecord(raw.payload)) {
    return { ok: false, error: 'The payload must be an object.' };
  }
  return {
    ok: true,
    request: {
      id,
      command,
      workspace: typeof raw.workspace === 'string' ? raw.workspace : null,
      payload: raw.payload ?? {},
    },
  };
}

/**
 * Newline-delimited JSON decoder with a hard size limit. The socket must be
 * switched to UTF-8 (`setEncoding('utf8')`) before chunks are passed in.
 */
function createLineDecoder({ maxBytes = MAX_MESSAGE_BYTES, onMessage, onError }) {
  let buffer = '';
  return (chunk) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (buffer.length > maxBytes) {
      buffer = '';
      onError(new Error(`Message exceeds ${maxBytes} bytes.`));
      return;
    }
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        if (line.length > maxBytes) {
          onError(new Error(`Message exceeds ${maxBytes} bytes.`));
        } else {
          try {
            onMessage(JSON.parse(line));
          } catch {
            onError(new Error('The request is not valid JSON.'));
          }
        }
      }
      index = buffer.indexOf('\n');
    }
  };
}

function randomId(prefix = 'req') {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function safeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)
    ? value
    : null;
}

function queueRequest(root, key, request) {
  const dir = queueDir(root, key);
  ensurePrivateDir(dir);
  const id = safeId(request.id);
  if (!id) throw new Error('Invalid request id.');
  if (fs.existsSync(path.join(dir, `${id}.json`))) {
    throw new Error('A queued request with this id already exists.');
  }
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
  if (files.length >= QUEUE_LIMIT) {
    throw new Error('The Flow command queue is full. Open Flow and retry.');
  }
  writeJsonAtomic(path.join(dir, `${id}.json`), {
    ...request,
    queuedAt: new Date().toISOString(),
  });
  return path.join(dir, `${id}.json`);
}

function listQueuedRequests(root, key) {
  const dir = queueDir(root, key);
  let files;
  try {
    files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
  } catch {
    return [];
  }
  files.sort();
  return files.map((file) => ({
    id: file.slice(0, -5),
    file: path.join(dir, file),
  }));
}

function writeResult(root, key, id, response) {
  const safe = safeId(id);
  if (!safe) return null;
  const file = path.join(resultDir(root, key), `${safe}.json`);
  writeJsonAtomic(file, {
    ...response,
    id: safe,
    completedAt: new Date().toISOString(),
  });
  cleanupResults(root, key);
  return file;
}

function readResult(root, key, id) {
  const safe = safeId(id);
  if (!safe) return null;
  return readJson(path.join(resultDir(root, key), `${safe}.json`));
}

/**
 * Writes a pre-apply project backup outside the repository. Files are portable
 * Flow backups and can be restored through the normal import flow.
 */
function writeProjectBackup(root, projectId, backup) {
  const dir = backupDir(root);
  ensurePrivateDir(dir);
  const safeProject = safeId(projectId) || 'project';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = crypto.randomBytes(3).toString('hex');
  const file = path.join(dir, `${stamp}-${suffix}-${safeProject}.flow.json`);
  writeJsonAtomic(file, backup);
  cleanupBackups(root);
  return file;
}

/** Keeps a bounded history by both count and total size. */
function cleanupBackups(root, keep = 10, maxBytes = 200 * 1024 * 1024) {
  const dir = backupDir(root);
  let files;
  try {
    files = fs.readdirSync(dir).filter((file) => file.endsWith('.flow.json'));
  } catch {
    return;
  }
  try {
    const entries = files
      .map((file) => {
        const stat = fs.statSync(path.join(dir, file));
        return { file, mtime: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.mtime - a.mtime);

    let kept = 0;
    let total = 0;
    for (const entry of entries) {
      // Always keep the newest backup, even if it alone exceeds the size cap.
      const withinCount = kept < keep;
      const withinSize = kept === 0 || total + entry.size <= maxBytes;
      if (withinCount && withinSize) {
        kept += 1;
        total += entry.size;
      } else {
        fs.unlinkSync(path.join(dir, entry.file));
      }
    }
  } catch {
    /* best-effort cleanup */
  }
}

function cleanupResults(root, key) {
  const dir = resultDir(root, key);
  let files;
  try {
    files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
  } catch {
    return;
  }
  const now = Date.now();
  for (const file of files) {
    const full = path.join(dir, file);
    try {
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > RESULT_RETENTION_MS) fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
  try {
    const remaining = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => ({
        file,
        mtime: fs.statSync(path.join(dir, file)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const entry of remaining.slice(RESULT_KEEP)) {
      fs.unlinkSync(path.join(dir, entry.file));
    }
  } catch {
    /* ignore */
  }
}

module.exports = {
  PROTOCOL_VERSION,
  MAX_MESSAGE_BYTES,
  WORKSPACE_MAP_VERSION,
  dataDir,
  normalizeWorkspace,
  workspaceKey,
  isInsideWorkspace,
  runtimeDir,
  queueDir,
  resultDir,
  backupDir,
  socketPath,
  ensurePrivateDir,
  writeJsonAtomic,
  readJson,
  readWorkspaceMap,
  getWorkspaceEntry,
  setWorkspaceEntry,
  removeWorkspaceEntry,
  validateRequest,
  createLineDecoder,
  randomId,
  safeId,
  queueRequest,
  listQueuedRequests,
  writeResult,
  readResult,
  cleanupResults,
  writeProjectBackup,
  cleanupBackups,
};
