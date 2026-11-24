'use strict';

/**
 * Local command channel for terminal/MCP control.
 *
 * Binds a Unix socket (or Windows named pipe) in the per-user app-data
 * directory, keyed by workspace. There is no network listener, no shell
 * execution, and no path into the user's repository. Requests are newline-
 * delimited JSON, validated before they reach the extension handler.
 */

const fs = require('fs');
const net = require('net');
const protocol = require('./protocol.cjs');

/** True when something is already accepting connections at the socket path. */
function canConnect(socketPath, timeoutMs = 300) {
  return new Promise((resolve) => {
    const socket = net.connect(socketPath);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

class CommandServer {
  constructor(options = {}) {
    if (!options.handler || typeof options.handler !== 'function') {
      throw new Error('CommandServer requires a handler.');
    }
    this.workspacePath = protocol.normalizeWorkspace(options.workspacePath);
    this.appDataDir = options.appDataDir || protocol.dataDir();
    this.key = protocol.workspaceKey(this.workspacePath);
    this.handler = options.handler;
    this.logger = options.logger || console;
    this.socketPath = protocol.socketPath(this.appDataDir, this.key);
    this.server = null;
    this.draining = null;
    this.listening = false;
  }

  async listen() {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off('error', onError);
        this.listening = true;
        resolve();
      };
      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(this.socketPath);
    });
  }

  async start() {
    protocol.ensurePrivateDir(this.appDataDir);
    if (process.platform !== 'win32') {
      protocol.ensurePrivateDir(protocol.runtimeDir(this.appDataDir));
    }

    this.server = net.createServer((socket) => this.handleConnection(socket));
    this.server.on('error', (error) => {
      this.logger.error('Flow command server:', error);
    });

    try {
      await this.listen();
    } catch (error) {
      // A crashed previous instance can leave a dead socket behind. Only
      // remove it when nothing answers, never when another window owns it.
      if (
        process.platform !== 'win32' &&
        error &&
        error.code === 'EADDRINUSE' &&
        !(await canConnect(this.socketPath))
      ) {
        let isSocket = false;
        try {
          isSocket = fs.lstatSync(this.socketPath).isSocket();
        } catch {
          isSocket = false;
        }
        if (!isSocket) throw error;
        try {
          fs.unlinkSync(this.socketPath);
        } catch {
          /* someone else removed it */
        }
        await this.listen();
      } else {
        throw error;
      }
    }

    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(this.socketPath, 0o600);
      } catch {
        /* the runtime directory is already private */
      }
    }
    return this.socketPath;
  }

  handleConnection(socket) {
    socket.setEncoding('utf8');
    socket.setTimeout(120_000, () => socket.destroy());
    let closed = false;

    const respond = (id, response) => {
      if (closed || socket.destroyed) return;
      try {
        socket.write(`${JSON.stringify({ id: id ?? null, ...response })}\n`);
      } catch {
        /* the client went away */
      }
    };

    const decoder = protocol.createLineDecoder({
      onMessage: (raw) => {
        void this.dispatch(raw, respond);
      },
      onError: (error) => {
        respond(null, { ok: false, errors: [error.message] });
        socket.end();
      },
    });

    socket.on('data', decoder);
    socket.on('error', () => {
      /* client disconnect */
    });
    socket.on('close', () => {
      closed = true;
    });
  }

  async dispatch(raw, respond) {
    const parsed = protocol.validateRequest(raw);
    if (!parsed.ok) {
      respond(
        raw && typeof raw === 'object' ? raw.id : null,
        { ok: false, errors: [parsed.error] },
      );
      return;
    }
    const request = parsed.request;

    if (request.workspace) {
      let candidate;
      try {
        candidate = protocol.normalizeWorkspace(request.workspace);
      } catch (error) {
        respond(request.id, {
          ok: false,
          errors: [error instanceof Error ? error.message : 'Invalid workspace.'],
        });
        return;
      }
      if (!protocol.isInsideWorkspace(this.workspacePath, candidate)) {
        respond(request.id, {
          ok: false,
          errors: [
            `This Flow window is linked to "${this.workspacePath}", not "${candidate}".`,
          ],
        });
        return;
      }
    }

    try {
      const response = await this.handler(request);
      respond(request.id, response || { ok: false, errors: ['The command returned no response.'] });
    } catch (error) {
      respond(request.id, {
        ok: false,
        errors: [error instanceof Error ? error.message : 'The command failed.'],
      });
    }
  }

  /** Applies requests written while Flow was closed. */
  async drainQueue() {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      // Re-list after each pass: a CLI may queue a request while the queue is
      // being drained (for example before the socket finished starting).
      for (;;) {
        const entries = protocol.listQueuedRequests(this.appDataDir, this.key);
        if (entries.length === 0) break;
        for (const entry of entries) {
          const raw = protocol.readJson(entry.file);
          if (!raw) {
            try {
              fs.unlinkSync(entry.file);
            } catch {
              /* ignore */
            }
            continue;
          }
          await new Promise((resolve) => {
            let settled = false;
            const respond = (id, response) => {
              if (settled) return;
              settled = true;
              try {
                protocol.writeResult(this.appDataDir, this.key, entry.id, {
                  ...response,
                  id: entry.id,
                });
              } catch {
                /* the result file is best-effort */
              }
              try {
                fs.unlinkSync(entry.file);
              } catch {
                /* ignore */
              }
              resolve();
            };
            void this.dispatch(raw, respond);
          });
        }
        // Never loop forever on a queue file we cannot remove.
        if (entries.some((entry) => fs.existsSync(entry.file))) break;
      }
    })().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  async dispose() {
    const server = this.server;
    const wasListening = this.listening;
    this.server = null;
    this.listening = false;
    if (!server) return;
    await new Promise((resolve) => server.close(() => resolve()));
    if (wasListening && process.platform !== 'win32') {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        /* already gone */
      }
    }
  }
}

module.exports = { CommandServer };
