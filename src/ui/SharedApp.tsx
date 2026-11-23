import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { countLinks } from '../core/graph';
import type { Project } from '../core/types';
import { validateBackup } from '../core/validation';
import { fetchShareSnapshot, type ShareBootstrap } from './shareBridge';
import { SharedCanvas } from './SharedCanvas';
import {
  SharedImageViewer,
  SharedProperties,
  type SharedImageViewerState,
} from './SharedProperties';
import { SharedTree } from './SharedTree';
import { IconLink } from './icons';

type ViewerStatus =
  | { kind: 'locked'; error: string | null }
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'ended'; message: string }
  | { kind: 'error'; message: string };

const POLL_INTERVAL_MS = 5000;
const SESSION_PREFIX = 'flow-share-key:';

function formatTime(date: Date | null): string {
  if (!date) return '—';
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * The guest side of LAN sharing: password gate, snapshot fetching, and a
 * strictly read-only rendering of the sharer's project. Nothing is persisted
 * on this device; the board is re-fetched as the sharer edits it.
 */
export function SharedApp({ bootstrap }: { bootstrap: ShareBootstrap }) {
  const { apiBase, shareId, theme } = bootstrap;
  const sessionKey = `${SESSION_PREFIX}${shareId}`;

  const [status, setStatus] = useState<ViewerStatus>({ kind: 'loading' });
  const [project, setProject] = useState<Project | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    null,
  );
  const [focusRequest, setFocusRequest] = useState<{
    nodeId: string;
    nonce: number;
  } | null>(null);
  const [imageViewer, setImageViewer] = useState<SharedImageViewerState | null>(
    null,
  );
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const keyRef = useRef('');
  const etagRef = useRef<string | null>(null);
  const pollingRef = useRef(false);
  const aliveRef = useRef(true);
  const focusNonce = useRef(0);
  const statusRef = useRef<ViewerStatus>(status);
  const failuresRef = useRef(0);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const refresh = useCallback(
    async (options: { initial?: boolean } = {}) => {
      const key = keyRef.current;
      if (!key || pollingRef.current) return;
      pollingRef.current = true;
      if (options.initial) {
        setStatus({ kind: 'loading' });
        setSyncError(null);
      }

      try {
        const result = await fetchShareSnapshot(apiBase, key, etagRef.current);
        if (!aliveRef.current) return;

        switch (result.kind) {
          case 'ok': {
            const validation = validateBackup(result.data.backup);
            if (!validation.ok || validation.projects.length === 0) {
              setStatus({
                kind: 'error',
                message: validation.ok
                  ? 'The shared board contains no project.'
                  : `The shared board is invalid: ${validation.errors[0]}`,
              });
              return;
            }
            const next = validation.projects[0];
            etagRef.current = result.etag;
            failuresRef.current = 0;
            setProject(next);
            setLastSync(new Date());
            setStatus({ kind: 'ready' });
            setSyncError(null);
            setPasswordInput('');
            try {
              sessionStorage.setItem(sessionKey, key);
            } catch {
              /* session storage unavailable */
            }
            setSelectedNodeId((current) =>
              current && next.nodes.some((node) => node.id === current)
                ? current
                : null,
            );
            setSelectedConnectionId((current) =>
              current && next.connections.some((connection) => connection.id === current)
                ? current
                : null,
            );
            return;
          }
          case 'unchanged':
            failuresRef.current = 0;
            setLastSync(new Date());
            setSyncError(null);
            if (statusRef.current.kind !== 'ready') setStatus({ kind: 'ready' });
            return;
          case 'wrong-password':
            keyRef.current = '';
            etagRef.current = null;
            try {
              sessionStorage.removeItem(sessionKey);
            } catch {
              /* session storage unavailable */
            }
            setStatus({
              kind: 'locked',
              error:
                statusRef.current.kind === 'ready'
                  ? 'The sharing password changed. Enter the new password.'
                  : 'Incorrect password. Check the code and try again.',
            });
            return;
          case 'ended':
            keyRef.current = '';
            etagRef.current = null;
            try {
              sessionStorage.removeItem(sessionKey);
            } catch {
              /* session storage unavailable */
            }
            setProject(null);
            setStatus({ kind: 'ended', message: result.message });
            return;
          case 'rate-limited':
            keyRef.current = '';
            setStatus({ kind: 'locked', error: result.message });
            return;
          case 'error':
            if (!options.initial && statusRef.current.kind === 'ready') {
              failuresRef.current += 1;
              if (failuresRef.current >= 4) {
                // Several polls failed in a row: the host most likely stopped
                // sharing, so stop showing the last known board.
                keyRef.current = '';
                failuresRef.current = 0;
                setSyncError(null);
                setProject(null);
                setStatus({
                  kind: 'ended',
                  message: 'The share appears to have ended.',
                });
              } else {
                setSyncError(result.message);
              }
            } else {
              setStatus({ kind: 'error', message: result.message });
            }
            return;
        }
      } finally {
        pollingRef.current = false;
      }
    },
    [apiBase, sessionKey],
  );

  useEffect(() => {
    aliveRef.current = true;
    let cached: string | null = null;
    try {
      cached = sessionStorage.getItem(sessionKey);
    } catch {
      cached = null;
    }
    if (cached) {
      keyRef.current = cached;
      void refresh({ initial: true });
    } else {
      setStatus({ kind: 'locked', error: null });
    }
    return () => {
      aliveRef.current = false;
    };
  }, [refresh, sessionKey]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (!keyRef.current) return;
      void refresh();
    };
    const timer = setInterval(tick, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || imageViewer) return;
      setSelectedNodeId(null);
      setSelectedConnectionId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imageViewer]);

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    const value = passwordInput.trim();
    if (!value) {
      setStatus({
        kind: 'locked',
        error: 'Enter the password shown by the person sharing this board.',
      });
      return;
    }
    keyRef.current = value;
    etagRef.current = null;
    void refresh({ initial: true });
  };

  const selectAndFocus = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedConnectionId(null);
    focusNonce.current += 1;
    setFocusRequest({ nodeId, nonce: focusNonce.current });
  };

  if (status.kind === 'loading') {
    return (
      <div className="boot">
        <div className="brand-mark" aria-hidden>
          F
        </div>
        <p>Opening the shared board…</p>
      </div>
    );
  }

  if (status.kind === 'locked') {
    return (
      <div className="share-gate">
        <div className="share-gate-card">
          <div className="share-gate-brand">
            <div className="brand-mark" aria-hidden>
              F
            </div>
            <div>
              <div className="brand-name">Flow</div>
              <div className="brand-tag">Shared read-only board</div>
            </div>
          </div>
          <h1>Enter the sharing password</h1>
          <p className="share-gate-copy">
            Ask the person sharing this board for the password. You will get a
            read-only view; nothing is saved on this device.
          </p>
          <form onSubmit={submitPassword}>
            <label className="field">
              <span>Password</span>
              <input
                autoFocus
                type="password"
                value={passwordInput}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setPasswordInput(event.target.value)}
                placeholder="e.g. k7m2q9pd"
              />
            </label>
            {status.error && (
              <p className="share-error" role="alert">
                {status.error}
              </p>
            )}
            <button type="submit" className="btn btn-primary btn-block">
              Open board
            </button>
          </form>
          <p className="share-gate-foot">
            The board is served by the other computer over the local network. It
            is not stored or uploaded anywhere.
          </p>
        </div>
      </div>
    );
  }

  if (status.kind === 'ended') {
    return (
      <div className="share-gate">
        <div className="share-gate-card">
          <div className="brand-mark" aria-hidden>
            F
          </div>
          <h1>Share ended</h1>
          <p className="share-gate-copy">{status.message}</p>
          <p className="share-gate-foot">
            Ask the owner to start sharing again and send you a fresh link.
          </p>
        </div>
      </div>
    );
  }

  if (status.kind === 'error') {
    return (
      <div className="share-gate">
        <div className="share-gate-card">
          <div className="brand-mark" aria-hidden>
            F
          </div>
          <h1>Could not open the board</h1>
          <p className="share-gate-copy">{status.message}</p>
          <div className="share-gate-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void refresh({ initial: true })}
            >
              Try again
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                keyRef.current = '';
                try {
                  sessionStorage.removeItem(sessionKey);
                } catch {
                  /* session storage unavailable */
                }
                setPasswordInput('');
                setStatus({
                  kind: 'locked',
                  error: 'Enter the password again.',
                });
              }}
            >
              Re-enter password
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="share-gate">
        <div className="share-gate-card">
          <h1>Nothing to show</h1>
          <p className="share-gate-copy">The shared board is empty.</p>
        </div>
      </div>
    );
  }

  const selectedNode =
    project.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedConnection =
    project.connections.find(
      (connection) => connection.id === selectedConnectionId,
    ) ?? null;
  const hasSelection = selectedNode !== null || selectedConnection !== null;

  return (
    <>
      <ReactFlowProvider>
        <div
          className={`app shared-viewer${
            hasSelection ? '' : ' is-no-properties'
          }`}
        >
          <aside className="sidebar shared-sidebar">
            <div className="brand">
              <div className="brand-mark" aria-hidden>
                F
              </div>
              <div className="brand-text">
                <div className="brand-name">Flow</div>
                <div className="brand-tag">Shared read-only board</div>
              </div>
              <span className="read-only-badge">Read-only</span>
            </div>

            <section className="project-block">
              <div className="eyebrow">SHARED PROJECT</div>
              <div className="shared-project-title">
                <IconLink size={13} />
                <span>{project.name}</span>
              </div>
              <p className="project-description">
                {project.description || 'No description.'}
              </p>
            </section>

            <div className="sidebar-scroll">
              <section className="structure-block">
                <div className="section-head">
                  <span className="eyebrow">STRUCTURE</span>
                  <span className="section-count">{project.nodes.length}</span>
                </div>
                <SharedTree
                  project={project}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={selectAndFocus}
                />
              </section>
            </div>

            <footer className="sidebar-footer">
              <p
                className={`shared-sync${syncError ? ' is-error' : ''}`}
                title={syncError ?? undefined}
              >
                {syncError
                  ? 'Connection lost — retrying…'
                  : `Live · updated ${formatTime(lastSync)}`}
              </p>
              <p className="shared-footnote">
                Nothing is saved on this device.
              </p>
            </footer>
          </aside>

          <main className="canvas-area">
            <header className="canvas-header">
              <div>
                <div className="eyebrow">SHARED PROJECT MAP</div>
                <h1>{project.name}</h1>
              </div>
              <div className="canvas-header-tools">
                <span className="read-only-badge">Read-only</span>
                <div className="canvas-counts">
                  <span>
                    {project.nodes.length} node
                    {project.nodes.length === 1 ? '' : 's'}
                  </span>
                  <span className="dot-sep" aria-hidden>
                    ·
                  </span>
                  <span>
                    {countLinks(project)} link{countLinks(project) === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            </header>

            <SharedCanvas
              project={project}
              selectedNodeId={selectedNodeId}
              selectedConnectionId={selectedConnectionId}
              onSelectNode={(nodeId) => {
                setSelectedNodeId(nodeId);
                if (nodeId !== null) setSelectedConnectionId(null);
              }}
              onSelectConnection={(connectionId) => {
                setSelectedConnectionId(connectionId);
                if (connectionId !== null) setSelectedNodeId(null);
              }}
              focusRequest={focusRequest}
              theme={theme}
            />
          </main>

          <SharedProperties
            project={project}
            node={selectedNode}
            connection={selectedConnection}
            onCloseNode={() => setSelectedNodeId(null)}
            onCloseConnection={() => setSelectedConnectionId(null)}
            onOpenNode={selectAndFocus}
            onOpenImage={(nodeId, imageId) => setImageViewer({ nodeId, imageId })}
          />
        </div>
      </ReactFlowProvider>

      <SharedImageViewer
        project={project}
        viewer={imageViewer}
        onClose={() => setImageViewer(null)}
      />
    </>
  );
}
