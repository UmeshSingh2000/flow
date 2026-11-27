import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getDescendantIds, getNode } from '../core/graph';
import { useFlowStore } from '../state/store';

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const createProject = useFlowStore((state) => state.createProject);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  return (
    <form
      className="dialog"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        createProject(name, description);
        onClose();
      }}
    >
      <header className="dialog-head">
        <h2>New project</h2>
        <p>Projects are saved locally on this device.</p>
      </header>
      <div className="dialog-body">
        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Checkout service"
          />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional one-line summary"
          />
        </label>
      </div>
      <footer className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Create project
        </button>
      </footer>
    </form>
  );
}

function EditProjectDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const project = useFlowStore((state) =>
    state.projects.find((candidate) => candidate.id === projectId),
  );
  const updateProject = useFlowStore((state) => state.updateProject);
  const [name, setName] = useState(project?.name ?? '');
  const [description, setDescription] = useState(project?.description ?? '');

  if (!project) return null;

  return (
    <form
      className="dialog"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        updateProject(projectId, { name, description });
        onClose();
      }}
    >
      <header className="dialog-head">
        <h2>Rename project</h2>
        <p>Renaming a project does not change its root node.</p>
      </header>
      <div className="dialog-body">
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      </div>
      <footer className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Save changes
        </button>
      </footer>
    </form>
  );
}

function DeleteProjectDialog({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const project = useFlowStore((state) =>
    state.projects.find((candidate) => candidate.id === projectId),
  );
  const deleteProject = useFlowStore((state) => state.deleteProject);

  if (!project) return null;

  return (
    <div className="dialog">
      <header className="dialog-head">
        <h2>Delete “{project.name}”?</h2>
        <p>
          This permanently removes {project.nodes.length} node
          {project.nodes.length === 1 ? '' : 's'} and {project.connections.length}{' '}
          connection{project.connections.length === 1 ? '' : 's'} from this device. You
          can undo this for 10 seconds after deleting. Export a backup first if you may
          need it later.
        </p>
      </header>
      <footer className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            void deleteProject(projectId);
            onClose();
          }}
        >
          Delete project
        </button>
      </footer>
    </div>
  );
}

function DeleteNodeDialog({
  nodeId,
  onClose,
}: {
  nodeId: string;
  onClose: () => void;
}) {
  const project = useFlowStore((state) =>
    state.projects.find((candidate) => candidate.id === state.activeProjectId),
  );
  const deleteNode = useFlowStore((state) => state.deleteNode);
  const node = project ? getNode(project, nodeId) : undefined;

  if (!project || !node) return null;

  const removedIds = new Set([nodeId, ...getDescendantIds(project, nodeId)]);
  const descendants = removedIds.size - 1;
  const affectedConnections = project.connections.filter(
    (connection) =>
      removedIds.has(connection.source) || removedIds.has(connection.target),
  ).length;

  return (
    <div className="dialog">
      <header className="dialog-head">
        <h2>Delete “{node.title}”?</h2>
        <p>
          {descendants > 0
            ? `This also deletes ${descendants} descendant node${
                descendants === 1 ? '' : 's'
              }.`
            : 'This node has no descendants.'}{' '}
          {affectedConnections > 0
            ? `${affectedConnections} connection${
                affectedConnections === 1 ? '' : 's'
              } touching these nodes will be removed.`
            : 'No connections touch this node.'}{' '}
          You can undo this for 10 seconds.
        </p>
      </header>
      <footer className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            deleteNode(nodeId);
            onClose();
          }}
        >
          Delete node{descendants > 0 ? 's' : ''}
        </button>
      </footer>
    </div>
  );
}

function ImportErrorsDialog({
  errors,
  onClose,
}: {
  errors: string[];
  onClose: () => void;
}) {
  return (
    <div className="dialog">
      <header className="dialog-head">
        <h2>Import failed</h2>
        <p>The backup was rejected so your existing projects were left untouched.</p>
      </header>
      <div className="dialog-body">
        <ul className="error-list">
          {errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      </div>
      <footer className="dialog-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      </footer>
    </div>
  );
}

function InfoDialog({
  title,
  body,
  onClose,
}: {
  title: string;
  body: string;
  onClose: () => void;
}) {
  return (
    <div className="dialog">
      <header className="dialog-head">
        <h2>{title}</h2>
        <p>{body}</p>
      </header>
      <footer className="dialog-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Close
        </button>
      </footer>
    </div>
  );
}

export function DialogHost() {
  const dialog = useFlowStore((state) => state.dialog);
  const closeDialog = useFlowStore((state) => state.closeDialog);

  if (!dialog) return null;

  const key =
    dialog.kind +
    ('id' in dialog ? `:${dialog.id}` : '') +
    ('title' in dialog ? `:${dialog.title}` : '');

  let content: ReactNode = null;
  switch (dialog.kind) {
    case 'new-project':
      content = <NewProjectDialog onClose={closeDialog} />;
      break;
    case 'edit-project':
      content = <EditProjectDialog projectId={dialog.id} onClose={closeDialog} />;
      break;
    case 'delete-project':
      content = <DeleteProjectDialog projectId={dialog.id} onClose={closeDialog} />;
      break;
    case 'delete-node':
      content = <DeleteNodeDialog nodeId={dialog.id} onClose={closeDialog} />;
      break;
    case 'import-errors':
      content = <ImportErrorsDialog errors={dialog.errors} onClose={closeDialog} />;
      break;
    case 'info':
      content = <InfoDialog title={dialog.title} body={dialog.body} onClose={closeDialog} />;
      break;
  }

  return (
    <Modal key={key} onClose={closeDialog}>
      {content}
    </Modal>
  );
}
