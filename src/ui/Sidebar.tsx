import { useRef, useState } from 'react';
import { useActiveProject, useFlowStore } from '../state/store';
import { ProjectTree } from './ProjectTree';
import { StorageStatus } from './StorageStatus';
import {
  IconDownload,
  IconMore,
  IconPencil,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
  IconX,
} from './icons';

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

  const [menuOpen, setMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
            title="New project"
            aria-label="New project"
            onClick={() => openDialog({ kind: 'new-project' })}
          >
            <IconPlus size={15} />
          </button>
          <div className="menu-anchor">
            <button
              type="button"
              className="icon-btn"
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
          {active?.description || 'A map of how it all fits.'}
        </p>
        <button
          type="button"
          className="btn btn-primary btn-block"
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
              placeholder="Search nodes…"
              aria-label="Search nodes by title or description"
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
        <StorageStatus />
        <button
          type="button"
          className="link-btn"
          onClick={() => fileInputRef.current?.click()}
        >
          <IconUpload size={12} /> Import backup
        </button>
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
