import { useEffect, useRef, useState } from 'react';
import { useShareStore } from '../state/shareStore';
import { useActiveProject } from '../state/store';
import { copyText } from './shareBridge';
import { IconLink, IconX } from './icons';

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'in 4 hours';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ShareDialog() {
  const open = useShareStore((state) => state.dialogOpen);
  const supported = useShareStore((state) => state.supported);
  const phase = useShareStore((state) => state.phase);
  const share = useShareStore((state) => state.share);
  const error = useShareStore((state) => state.error);
  const closeDialog = useShareStore((state) => state.closeDialog);
  const clearError = useShareStore((state) => state.clearError);
  const start = useShareStore((state) => state.start);
  const stop = useShareStore((state) => state.stop);
  const project = useActiveProject();

  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState<'link' | 'password' | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDialog();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeDialog]);

  useEffect(() => {
    if (!open) {
      setPassword('');
      setCopied(null);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = null;
    }
  }, [open]);

  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  if (!open) return null;

  const copy = (kind: 'link' | 'password', value: string) => {
    void copyText(value);
    setCopied(kind);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1600);
  };

  const active = share !== null && (phase === 'active' || phase === 'stopping');
  const starting = phase === 'starting';
  const stopping = phase === 'stopping';

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}
    >
      <div
        className="modal share-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
      >
        <header className="dialog-head share-head">
          <div>
            <div className="eyebrow">LOCAL NETWORK</div>
            <h2 id="share-title">
              {active ? 'Sharing is on' : 'Share a read-only view'}
            </h2>
            <p>
              {active
                ? 'Anyone on this network with the link and password can view this project.'
                : 'Show this project to someone on the same WiFi without an account, a database, or the internet.'}
            </p>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close sharing dialog"
            onClick={closeDialog}
          >
            <IconX size={14} />
          </button>
        </header>

        <div className="dialog-body share-body">
          {!supported && (
            <>
              <p className="share-note">
                LAN sharing is hosted by the Flow VS Code extension, which can run a
                small local server. Open Flow from VS Code, then start sharing from the
                project menu. The guest only needs a web browser on the same network.
              </p>
              <p className="share-note share-note-muted">
                A browser tab on its own cannot accept incoming connections, so this
                feature is unavailable in the plain web app.
              </p>
            </>
          )}

          {supported && !project && (
            <p className="share-note">Create or open a project before sharing it.</p>
          )}

          {supported && project && !active && (
            <>
              <div className="share-project">
                <IconLink size={13} />
                <span>{project.name}</span>
              </div>
              <label className="field">
                <span>Password (optional)</span>
                <input
                  autoFocus
                  value={password}
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Leave blank to generate one"
                />
              </label>
              <ul className="share-points">
                <li>The viewer is read-only. There is no edit or delete endpoint.</li>
                <li>Your project data stays on this computer until you stop sharing.</li>
                <li>
                  The share ends when you stop it, switch projects, close VS Code, or
                  after 4 hours.
                </li>
              </ul>
              <p className="share-warning">
                The link uses plain HTTP on your local network. The password controls
                access but does not encrypt the board, so only share on a network you
                trust.
              </p>
            </>
          )}

          {active && share && (
            <>
              <div className="share-project">
                <IconLink size={13} />
                <span>{project?.name ?? share.projectName}</span>
                <span className="read-only-badge">Read-only</span>
              </div>

              <label className="field">
                <span>Share link</span>
                <div className="share-copy-row">
                  <input
                    readOnly
                    value={share.url}
                    onFocus={(event) => event.target.select()}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => copy('link', share.url)}
                  >
                    {copied === 'link' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </label>

              <label className="field">
                <span>Password</span>
                <div className="share-copy-row">
                  <input
                    readOnly
                    className="share-password"
                    value={share.password}
                    onFocus={(event) => event.target.select()}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => copy('password', share.password)}
                  >
                    {copied === 'password' ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </label>

              <p className="share-note">
                Send the link and password separately. Viewers see your edits within a
                few seconds. The share expires {formatExpiry(share.expiresAt)}.
              </p>
              {share.url.includes('127.0.0.1') || share.url.includes('localhost') ? (
                <p className="share-warning">
                  No local network address was detected. Connect this computer to WiFi
                  or Ethernet, then start the share again.
                </p>
              ) : (
                <p className="share-warning">
                  Plain HTTP on the local network: the password controls access but does
                  not encrypt the board.
                </p>
              )}
            </>
          )}

          {error && (
            <p className="share-error" role="alert">
              {error}
              <button
                type="button"
                className="share-error-dismiss"
                aria-label="Dismiss error"
                onClick={clearError}
              >
                <IconX size={10} />
              </button>
            </p>
          )}
        </div>

        <footer className="dialog-actions">
          {active && (
            <button
              type="button"
              className="btn btn-danger"
              disabled={stopping}
              onClick={() => void stop()}
            >
              {stopping ? 'Stopping…' : 'Stop sharing'}
            </button>
          )}
          {supported && project && !active && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={starting}
              onClick={() => void start(password)}
            >
              {starting ? 'Starting…' : 'Start sharing'}
            </button>
          )}
          <button type="button" className="btn" onClick={closeDialog}>
            {active ? 'Close' : 'Cancel'}
          </button>
        </footer>
      </div>
    </div>
  );
}
