import { useEffect, useMemo, useRef, useState } from 'react';
import { useGuideStore } from '../state/guideStore';
import { useShareStore } from '../state/shareStore';
import { useActiveProject, useFlowStore } from '../state/store';
import { ProjectTree } from './ProjectTree';
import { StorageStatus } from './StorageStatus';
import {
  IconDownload,
  IconFolder,
  IconHelp,
  IconLink,
  IconMore,
  IconPanelLeft,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTrash,
  IconUpload,
  IconX,
} from './icons';
import { isVsCodeWebview, openDataFolder } from './vscodeBridge';

function formatStorageSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export function Sidebar() {
  const projects = useFlowStore((state) => state.projects);
  const active = useActiveProject();
  const storageWarning = useFlowStore((state) => state.storageWarning);
  const selectProject = useFlowStore((state) => state.selectProject);
  const addNode = useFlowStore((state) => state.addNode);
  const openDialog = useFlowStore((state) => state.openDialog);
  const exportBackup = useFlowStore((state) => state.exportBackup);
  const importBackup = useFlowStore((state) => state.importBackup);
  const notify = useFlowStore((state) => state.notify);
  const search = useFlowStore((state) => state.search);
  const setSearch = useFlowStore((state) => state.setSearch);
  const toggleSidebar = useFlowStore((state) => state.toggleSidebar);
  const theme = useFlowStore((state) => state.theme);
  const setTheme = useFlowStore((state) => state.setTheme);
  const cliUpdateVersion = useFlowStore((state) => state.cliUpdateVersion);
  const dismissCliUpdate = useFlowStore((state) => state.dismissCliUpdate);
  const openShareDialog = useShareStore((state) => state.openDialog);

  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tourCompleted = useGuideStore((state) => state.completed);
  const inVsCode = isVsCodeWebview();

  // Serialized size of the records Flow keeps in IndexedDB. Computed lazily
  // while Settings is open so editing never pays for it.
  const projectDataSize = useMemo(
    () => (settingsOpen ? new TextEncoder().encode(JSON.stringify(projects)).length : null),
    [settingsOpen, projects],
  );
  // Whole-origin estimate (database overhead plus cached assets), when the
  // host exposes the Storage API.
  const [storageUsage, setStorageUsage] = useState<number | null>(null);

  useEffect(() => {
    if (!settingsOpen) return;
    const storage = navigator.storage;
    if (!storage || typeof storage.estimate !== 'function') return;
    let cancelled = false;
    void storage.estimate().then(
      (estimate) => {
        if (!cancelled) {
          setStorageUsage(typeof estimate.usage === 'number' ? estimate.usage : null);
        }
      },
      () => {
        if (!cancelled) setStorageUsage(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [settingsOpen]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      await importBackup(text);
    } catch {
      notify('Could not read that file.', 'error');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden>
          F
        </div>
        <div className="brand-text">
          <div className="brand-name">Flow</div>
          <div className="brand-tag">Offline-first project maps</div>
        </div>
        <button
          type="button"
          className="icon-btn brand-collapse"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          aria-pressed="false"
          onClick={toggleSidebar}
        >
          <IconPanelLeft size={15} />
        </button>
      </div>

      <section className="project-block">
        <div className="eyebrow">CURRENT PROJECT</div>
        <div className="project-title-row">
          {active ? (
            <select
              className="project-select"
              value={active.id}
              onChange={(event) => selectProject(event.target.value)}
              aria-label="Current project"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="project-none">No project open</span>
          )}
          <button
            type="button"
            className="icon-btn"
            data-guide="new-project"
            title="New project"
            aria-label="New project"
            onClick={() => openDialog({ kind: 'new-project' })}
          >
            <IconPlus size={15} />
          </button>
          {active && (
            <button
              type="button"
              className="icon-btn delete-project-btn"
              title="Delete project"
              aria-label={`Delete project ${active.name}`}
              onClick={() => openDialog({ kind: 'delete-project', id: active.id })}
            >
              <IconTrash size={15} />
            </button>
          )}
          <div className="menu-anchor">
            <button
              type="button"
              className="icon-btn"
              data-guide="project-menu"
              aria-label="Project actions"
              aria-expanded={menuOpen}
              disabled={!active}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <IconMore size={15} />
            </button>
            {menuOpen && active && (
              <>
                <div className="menu-scrim" onClick={() => setMenuOpen(false)} />
                <div className="menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      openDialog({ kind: 'edit-project', id: active.id });
                      setMenuOpen(false);
                    }}
                  >
                    <IconPencil size={13} /> Rename project
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      exportBackup('project');
                      setMenuOpen(false);
                    }}
                  >
                    <IconDownload size={13} /> Export project backup
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      exportBackup('workspace');
                      setMenuOpen(false);
                    }}
                  >
                    <IconDownload size={13} /> Export all projects
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      openShareDialog();
                      setMenuOpen(false);
                    }}
                  >
                    <IconLink size={13} /> Share read-only…
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      fileInputRef.current?.click();
                      setMenuOpen(false);
                    }}
                  >
                    <IconUpload size={13} /> Import backup…
                  </button>
                  <hr />
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      openDialog({ kind: 'delete-project', id: active.id });
                      setMenuOpen(false);
                    }}
                  >
                    <IconTrash size={13} /> Delete project
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <p className="project-description">
          {active?.description || 'Create a project to start mapping.'}
        </p>
        <button
          type="button"
          className="btn btn-primary btn-block"
          data-guide="add-node"
          onClick={() => addNode()}
          disabled={!active}
        >
          <IconPlus size={14} /> Add node
        </button>
      </section>

      <div className="sidebar-scroll">
        <section className="structure-block">
          <div className="section-head">
            <span className="eyebrow">STRUCTURE</span>
            <span className="section-count">{active ? active.nodes.length : 0}</span>
          </div>
          <div className="search-box">
            <IconSearch size={13} className="search-icon" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, description, or ID…"
              aria-label="Search nodes by title, description, or node ID"
            />
            {search && (
              <button
                type="button"
                className="search-clear"
                aria-label="Clear search"
                onClick={() => setSearch('')}
              >
                <IconX size={11} />
              </button>
            )}
          </div>
          <ProjectTree />
        </section>
      </div>

      <footer className="sidebar-footer">
        {storageWarning && <p className="storage-warning">{storageWarning}</p>}
        {cliUpdateVersion && (
          <div className="update-note" role="status">
            <p>
              Flow terminal tools updated to {cliUpdateVersion}. Restart Claude Code
              to load the updated MCP tools.
            </p>
            <button
              type="button"
              className="icon-btn"
              aria-label="Dismiss update note"
              onClick={dismissCliUpdate}
            >
              <IconX size={11} />
            </button>
          </div>
        )}
        <StorageStatus />
        <div className="menu-anchor settings-anchor">
          <button
            type="button"
            className="link-btn"
            data-guide="settings"
            aria-haspopup="menu"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <IconSettings size={12} /> Settings
          </button>
          {settingsOpen && (
            <>
              <div className="menu-scrim" onClick={() => setSettingsOpen(false)} />
              <div className="menu settings-menu" role="menu">
                <div className="menu-section">
                  <span className="eyebrow">THEME</span>
                  <div className="theme-switch" aria-label="Theme">
                    <button
                      type="button"
                      className={theme === 'light' ? 'is-active' : ''}
                      role="menuitemradio"
                      aria-checked={theme === 'light'}
                      onClick={() => setTheme('light')}
                    >
                      Light
                    </button>
                    <button
                      type="button"
                      className={theme === 'dark' ? 'is-active' : ''}
                      role="menuitemradio"
                      aria-checked={theme === 'dark'}
                      onClick={() => setTheme('dark')}
                    >
                      Dark
                    </button>
                  </div>
                </div>
                <hr />
                <div className="menu-section">
                  <span className="eyebrow">GUIDED TOUR</span>
                  <p className="menu-hint">
                    {tourCompleted ? 'Completed' : 'Not taken yet'} — 10 steps through
                    every feature.
                  </p>
                  <button
                    type="button"
                    role="menuitem"
                    data-guide="tour"
                    onClick={() => {
                      useGuideStore.getState().start();
                      setSettingsOpen(false);
                    }}
                  >
                    <IconHelp size={13} />
                    {tourCompleted ? 'Replay the tour' : 'Start the tour'}
                  </button>
                </div>
                <hr />
                <div className="menu-section">
                  <span className="eyebrow">DATA</span>
                  {(storageUsage ?? projectDataSize) !== null && (
                    <p
                      className="storage-figure"
                      title="Estimated total storage Flow uses on this device."
                    >
                      <span>Storage used</span>
                      <strong className="storage-figure-value">
                        {formatStorageSize(storageUsage ?? projectDataSize ?? 0)}
                      </strong>
                    </p>
                  )}
                  {inVsCode ? (
                    <>
                      <p className="menu-hint">
                        Opens Flow&apos;s application-data folder: workspace links,
                        queued commands, and pre-apply backups.
                      </p>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          openDataFolder();
                          setSettingsOpen(false);
                        }}
                      >
                        <IconFolder size={13} /> Open data folder
                      </button>
                    </>
                  ) : (
                    <p className="menu-hint">
                      Projects are stored in this browser&apos;s local database.
                      Use Export to save a portable copy.
                    </p>
                  )}
                </div>
                <hr />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setSettingsOpen(false);
                  }}
                >
                  <IconUpload size={13} /> Import backup…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!active}
                  onClick={() => {
                    exportBackup('workspace');
                    setSettingsOpen(false);
                  }}
                >
                  <IconDownload size={13} /> Export all projects
                </button>
              </div>
            </>
          )}
        </div>
      </footer>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
    </aside>
  );
}
