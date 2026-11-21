import { create } from 'zustand';
import {
  addChildNode,
  createConnection,
  createNodeRecord,
  createProject as buildProject,
  defaultNodeTitle,
  deleteConnection as removeConnection,
  deleteNode as removeNode,
  duplicateNode as duplicateNodeInProject,
  getNode,
  getRootNode,
  moveNode as moveNodeInProject,
  NODE_CARD_WIDTH,
  now,
  reparentNode as reparentInProject,
  updateConnection as updateConnectionInProject,
  updateNode as updateNodeInProject,
} from '../core/graph';
import { createId } from '../core/id';
import { buildBackup, parseBackup } from '../core/validation';
import type {
  ConnectionType,
  FlowConnection,
  FlowNode,
  NodeDetails,
  NodeType,
  Point,
  Project,
  WorkspaceSnapshot,
} from '../core/types';
import { NODE_TYPE_LABELS } from '../core/types';
import type { StorageAdapter } from '../storage/repository';
import { createStorage } from '../storage';

export type SaveState = 'saved' | 'saving' | 'error';
export type Tone = 'info' | 'error';

export type DialogState =
  | { kind: 'new-project' }
  | { kind: 'edit-project'; id: string }
  | { kind: 'delete-project'; id: string }
  | { kind: 'delete-node'; id: string }
  | { kind: 'import-errors'; errors: string[] }
  | { kind: 'info'; title: string; body: string };

export interface ToastState {
  id: number;
  message: string;
  tone: Tone;
}

/** Where the user dropped a connector on empty canvas, in screen and flow coordinates. */
export interface ConnectionMenuState {
  sourceId: string;
  handleType: 'source' | 'target';
  screenX: number;
  screenY: number;
  flowX: number;
  flowY: number;
}

export type NodePatch = Partial<
  Omit<FlowNode, 'id' | 'projectId' | 'createdAt' | 'updatedAt' | 'details'>
> & {
  details?: Partial<NodeDetails>;
};

type ActionResult = { ok: true } | { ok: false; error: string };

export interface FlowStore {
  status: 'loading' | 'ready';
  storageKind: string;
  persistent: boolean;
  storageWarning: string | null;

  projects: Project[];
  activeProjectId: string | null;
  selectedNodeId: string | null;
  selectedConnectionId: string | null;
  saveState: SaveState;
  expandedIds: Record<string, boolean>;
  search: string;
  focusRequest: { nodeId: string; nonce: number } | null;
  toast: ToastState | null;
  dialog: DialogState | null;
  connectionMenu: ConnectionMenuState | null;
  /** Node whose Markdown editor sheet is open, if any. */
  markdownEditorNodeId: string | null;

  init(): Promise<void>;

  createProject(name: string, description?: string): void;
  updateProject(id: string, patch: { name?: string; description?: string }): void;
  deleteProject(id: string): Promise<void>;
  selectProject(id: string): void;

  addNode(parentId?: string | null): string | null;
  updateNode(id: string, patch: NodePatch): void;
  duplicateNode(id: string): void;
  previewNodePosition(id: string, position: Point): void;
  commitNodePosition(id: string, position: Point): void;
  deleteNode(id: string): ActionResult;
  reparentNode(id: string, parentId: string | null): ActionResult;

  selectNode(id: string | null): void;
  selectConnection(id: string | null): void;
  connect(source: string, target: string): ActionResult;
  updateConnection(id: string, patch: { label?: string; type?: ConnectionType | null }): void;
  deleteConnection(id: string): void;

  toggleExpanded(id: string): void;
  expandNodes(ids: string[]): void;
  setSearch(query: string): void;
  requestFocus(nodeId: string): void;
  sidebarOpen: boolean;
  toggleSidebar(): void;
  setSidebarOpen(open: boolean): void;

  openDialog(dialog: DialogState): void;
  closeDialog(): void;
  notify(message: string, tone?: Tone): void;

  openConnectionMenu(menu: ConnectionMenuState): void;
  closeConnectionMenu(): void;
  /** Creates a node of `type` at the drop point and connects it to the source node. */
  createNodeFromConnection(type: NodeType): void;

  openMarkdownEditor(nodeId: string): void;
  closeMarkdownEditor(): void;

  exportBackup(scope: 'project' | 'workspace'): void;
  importBackup(
    text: string,
  ): Promise<{ ok: true; count: number } | { ok: false; errors: string[] }>;
}

const SAVE_DEBOUNCE_MS = 400;

let adapter: StorageAdapter | null = null;
let initializing = false;
const pendingSaves = new Map<string, Project>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let toastCounter = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let focusCounter = 0;

function flushPendingSaves(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const current = adapter;
  if (!current || pendingSaves.size === 0) return Promise.resolve();
  const projects = [...pendingSaves.values()];
  pendingSaves.clear();
  return Promise.all(projects.map((project) => current.saveProject(project)))
    .then(() => {
      if (pendingSaves.size === 0) {
        useFlowStore.setState({ saveState: 'saved' });
      }
    })
    .catch(() => {
      useFlowStore.setState({ saveState: 'error' });
    });
}

/** Called when the tab is hidden or closed so edits are not left in the debounce window. */
export function flushStorage(): Promise<void> {
  return flushPendingSaves();
}

function scheduleSave(project: Project): void {
  pendingSaves.set(project.id, project);
  useFlowStore.setState({ saveState: 'saving' });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushPendingSaves();
  }, SAVE_DEBOUNCE_MS);
}

function showToast(message: string, tone: Tone = 'info'): void {
  toastCounter += 1;
  const id = toastCounter;
  useFlowStore.setState({ toast: { id, message, tone } });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (useFlowStore.getState().toast?.id === id) {
      useFlowStore.setState({ toast: null });
    }
  }, 4500);
}

function allNodesExpanded(projects: Project[]): Record<string, boolean> {
  const expanded: Record<string, boolean> = {};
  for (const project of projects) {
    for (const node of project.nodes) expanded[node.id] = true;
  }
  return expanded;
}

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'flow-backup'
  );
}

export const useFlowStore = create<FlowStore>()((set, get) => {
  const active = (): Project | null => {
    const { projects, activeProjectId } = get();
    return projects.find((project) => project.id === activeProjectId) ?? null;
  };

  const apply = (next: Project): void => {
    set((state) => ({
      projects: state.projects.map((project) => (project.id === next.id ? next : project)),
    }));
    scheduleSave(next);
  };

  const expand = (ids: string[]): void => {
    if (ids.length === 0) return;
    set((state) => {
      const expandedIds = { ...state.expandedIds };
      for (const id of ids) expandedIds[id] = true;
      return { expandedIds };
    });
  };

  return {
    status: 'loading',
    storageKind: '…',
    persistent: true,
    storageWarning: null,
    projects: [],
    activeProjectId: null,
    selectedNodeId: null,
    selectedConnectionId: null,
    saveState: 'saved',
    expandedIds: {},
    search: '',
    focusRequest: null,
    toast: null,
    dialog: null,
    connectionMenu: null,
    markdownEditorNodeId: null,
    sidebarOpen: true,

    async init() {
      if (get().status === 'ready' || initializing) return;
      initializing = true;
      adapter = await createStorage();

      let snapshot: WorkspaceSnapshot | null = null;
      try {
        snapshot = await adapter.loadWorkspace();
      } catch {
        snapshot = null;
      }

      let projects: Project[];
      let activeProjectId: string | null;

      if (!snapshot || snapshot.projects.length === 0) {
        // Start from scratch: no sample or dummy projects are created.
        projects = [];
        activeProjectId = null;
      } else {
        const stored = snapshot;
        // IndexedDB returns records in key order; restore creation order instead.
        // v1 records predate the markdown field, so normalize it on load.
        projects = [...stored.projects]
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((project) => ({
            ...project,
            nodes: project.nodes.map((node) => ({
              ...node,
              markdown: node.markdown ?? '',
            })),
          }));
        activeProjectId = projects.some((project) => project.id === stored.activeProjectId)
          ? stored.activeProjectId
          : projects[0].id;
      }

      set({
        status: 'ready',
        projects,
        activeProjectId,
        expandedIds: allNodesExpanded(projects),
        storageKind: adapter.kind,
        persistent: adapter.persistent,
        storageWarning: adapter.warning,
      });
    },

    createProject(name, description = '') {
      const project = buildProject(name, description);
      set((state) => ({
        projects: [...state.projects, project],
        activeProjectId: project.id,
        selectedNodeId: null,
        selectedConnectionId: null,
        markdownEditorNodeId: null,
        search: '',
        expandedIds: allNodesExpanded([project]),
      }));
      scheduleSave(project);
      void adapter?.saveActiveProjectId(project.id);
      showToast(`Project “${project.name}” created.`);
    },

    updateProject(id, patch) {
      const project = get().projects.find((candidate) => candidate.id === id);
      if (!project) return;
      const name = (patch.name ?? project.name).trim() || project.name;
      const next: Project = {
        ...project,
        name,
        description: patch.description ?? project.description,
        updatedAt: now(),
      };
      set((state) => ({
        projects: state.projects.map((candidate) =>
          candidate.id === id ? next : candidate,
        ),
      }));
      scheduleSave(next);
    },

    async deleteProject(id) {
      const state = get();
      const remaining = state.projects.filter((project) => project.id !== id);
      const activeProjectId =
        state.activeProjectId === id ? (remaining[0]?.id ?? null) : state.activeProjectId;
      set({
        projects: remaining,
        activeProjectId,
        selectedNodeId: null,
        selectedConnectionId: null,
        markdownEditorNodeId: null,
        expandedIds: allNodesExpanded(remaining),
      });
      pendingSaves.delete(id);
      try {
        await adapter?.deleteProject(id);
        await adapter?.saveActiveProjectId(activeProjectId);
      } catch {
        set({ saveState: 'error' });
      }
      showToast('Project deleted.');
    },

    selectProject(id) {
      const project = get().projects.find((candidate) => candidate.id === id);
      if (!project) return;
      expand(project.nodes.map((node) => node.id));
      set({
        activeProjectId: id,
        selectedNodeId: null,
        selectedConnectionId: null,
        markdownEditorNodeId: null,
        search: '',
      });
      void adapter?.saveActiveProjectId(id);
    },

    addNode(parentId) {
      const project = active();
      if (!project) {
        showToast('Create a project first.', 'error');
        return null;
      }
      const parent = parentId ?? get().selectedNodeId ?? getRootNode(project)?.id ?? null;
      try {
        const result = addChildNode(project, parent);
        apply(result.project);
        if (parent) expand([parent]);
        set({
          selectedNodeId: result.node.id,
          selectedConnectionId: null,
          focusRequest: { nodeId: result.node.id, nonce: ++focusCounter },
        });
        return result.node.id;
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not add node.', 'error');
        return null;
      }
    },

    updateNode(id, patch) {
      const project = active();
      if (!project) return;
      apply(updateNodeInProject(project, id, patch));
    },

    duplicateNode(id) {
      const project = active();
      if (!project) return;
      const result = duplicateNodeInProject(project, id);
      if (!result) return;
      apply(result.project);
      set({
        selectedNodeId: result.node.id,
        selectedConnectionId: null,
        focusRequest: { nodeId: result.node.id, nonce: ++focusCounter },
      });
      showToast('Node duplicated.');
    },

    previewNodePosition(id, position) {
      const project = active();
      if (!project) return;
      set((state) => ({
        projects: state.projects.map((candidate) =>
          candidate.id === project.id
            ? {
                ...candidate,
                nodes: candidate.nodes.map((node) =>
                  node.id === id ? { ...node, position } : node,
                ),
              }
            : candidate,
        ),
      }));
    },

    commitNodePosition(id, position) {
      const project = active();
      if (!project) return;
      apply(moveNodeInProject(project, id, position));
    },

    deleteNode(id) {
      const project = active();
      if (!project) return { ok: false, error: 'No active project.' };
      const result = removeNode(project, id);
      if (!result.ok) {
        showToast(result.error, 'error');
        return result;
      }
      apply(result.project);
      set((state) => {
        const expandedIds = { ...state.expandedIds };
        for (const removedId of result.removedIds) delete expandedIds[removedId];
        return {
          expandedIds,
          markdownEditorNodeId:
            state.markdownEditorNodeId &&
            result.removedIds.includes(state.markdownEditorNodeId)
              ? null
              : state.markdownEditorNodeId,
          selectedNodeId:
            state.selectedNodeId && result.removedIds.includes(state.selectedNodeId)
              ? null
              : state.selectedNodeId,
          selectedConnectionId: null,
        };
      });
      showToast(
        result.removedIds.length > 1
          ? `Node deleted with ${result.removedIds.length - 1} descendant${
              result.removedIds.length - 1 === 1 ? '' : 's'
            }.`
          : 'Node deleted.',
      );
      return { ok: true };
    },

    reparentNode(id, parentId) {
      const project = active();
      if (!project) return { ok: false, error: 'No active project.' };
      const result = reparentInProject(project, id, parentId);
      if (!result.ok) {
        showToast(result.error, 'error');
        return result;
      }
      apply(result.project);
      if (parentId) expand([parentId]);
      return { ok: true };
    },

    selectNode(id) {
      set({ selectedNodeId: id, selectedConnectionId: null });
    },

    selectConnection(id) {
      set({ selectedConnectionId: id, selectedNodeId: null });
    },

    connect(source, target) {
      const project = active();
      if (!project) return { ok: false, error: 'No active project.' };
      const result = createConnection(project, source, target);
      if (!result.ok) {
        showToast(result.error, 'error');
        return result;
      }
      apply(result.project);
      set({
        selectedConnectionId: result.connection?.id ?? null,
        selectedNodeId: null,
      });
      return { ok: true };
    },

    updateConnection(id, patch) {
      const project = active();
      if (!project) return;
      apply(updateConnectionInProject(project, id, patch));
    },

    deleteConnection(id) {
      const project = active();
      if (!project) return;
      apply(removeConnection(project, id));
      set((state) => ({
        selectedConnectionId: state.selectedConnectionId === id ? null : state.selectedConnectionId,
      }));
      showToast('Connection deleted.');
    },

    toggleExpanded(id) {
      set((state) => ({
        expandedIds: { ...state.expandedIds, [id]: !state.expandedIds[id] },
      }));
    },

    expandNodes(ids) {
      expand(ids);
    },

    setSearch(query) {
      set({ search: query });
    },

    requestFocus(nodeId) {
      set({ focusRequest: { nodeId, nonce: ++focusCounter } });
    },

    toggleSidebar() {
      set((state) => ({ sidebarOpen: !state.sidebarOpen }));
    },

    setSidebarOpen(open) {
      set({ sidebarOpen: open });
    },

    openDialog(dialog) {
      set({ dialog });
    },

    closeDialog() {
      set({ dialog: null });
    },

    openConnectionMenu(menu) {
      set({ connectionMenu: menu });
    },

    closeConnectionMenu() {
      set({ connectionMenu: null });
    },

    openMarkdownEditor(nodeId) {
      set({ markdownEditorNodeId: nodeId });
    },

    closeMarkdownEditor() {
      set({ markdownEditorNodeId: null });
    },

    createNodeFromConnection(type) {
      const menu = get().connectionMenu;
      set({ connectionMenu: null });
      if (!menu) return;
      const project = active();
      if (!project) return;
      const source = getNode(project, menu.sourceId);
      if (!source) return;

      const node = createNodeRecord({
        projectId: project.id,
        parentId: source.parentId,
        type,
        title: defaultNodeTitle(type),
        position: {
          x: menu.flowX - NODE_CARD_WIDTH / 2,
          y: menu.flowY - 24,
        },
      });
      // The new node joins the source's hierarchy level; the connector the user
      // dragged becomes an explicit graph connection between them.
      const withNode = { ...project, nodes: [...project.nodes, node] };
      const [from, to] =
        menu.handleType === 'source' ? [source.id, node.id] : [node.id, source.id];
      const result = createConnection(withNode, from, to);
      if (!result.ok) {
        showToast(result.error, 'error');
        return;
      }
      apply(result.project);
      if (source.parentId) expand([source.parentId]);
      set({
        selectedNodeId: node.id,
        selectedConnectionId: null,
        focusRequest: { nodeId: node.id, nonce: ++focusCounter },
      });
      showToast(`Connected “${source.title}” to a new ${NODE_TYPE_LABELS[type]}.`);
    },

    notify(message, tone = 'info') {
      showToast(message, tone);
    },

    exportBackup(scope) {
      const state = get();
      const selected =
        scope === 'workspace'
          ? state.projects
          : state.projects.filter((project) => project.id === state.activeProjectId);
      if (selected.length === 0) {
        showToast('There is nothing to export yet.', 'error');
        return;
      }
      const backup = buildBackup(selected);
      const filename =
        scope === 'workspace'
          ? 'flow-workspace.flow.json'
          : `${slugify(selected[0].name)}.flow.json`;
      downloadJson(filename, backup);
      showToast(
        scope === 'workspace'
          ? `Exported ${selected.length} project${selected.length === 1 ? '' : 's'}.`
          : 'Project backup exported.',
      );
    },

    async importBackup(text) {
      const result = parseBackup(text);
      if (!result.ok) {
        set({ dialog: { kind: 'import-errors', errors: result.errors } });
        return { ok: false, errors: result.errors };
      }

      const existingIds = new Set(get().projects.map((project) => project.id));
      const imported: Project[] = result.projects.map((project) => {
        if (!existingIds.has(project.id)) return project;
        // Never silently overwrite an existing project: give the import a fresh identity.
        const newId = createId('p');
        return {
          ...project,
          id: newId,
          name: `${project.name} (imported)`,
          updatedAt: now(),
          nodes: project.nodes.map((node) => ({ ...node, projectId: newId })),
          connections: project.connections.map((connection) => ({
            ...connection,
            projectId: newId,
          })),
        };
      });

      const first = imported[0];
      set((state) => ({
        projects: [...state.projects, ...imported],
        activeProjectId: first.id,
        selectedNodeId: null,
        selectedConnectionId: null,
        markdownEditorNodeId: null,
        search: '',
        expandedIds: { ...state.expandedIds, ...allNodesExpanded(imported) },
      }));
      for (const project of imported) scheduleSave(project);
      void adapter?.saveActiveProjectId(first.id);
      showToast(
        `Imported ${imported.length} project${imported.length === 1 ? '' : 's'}.`,
      );
      return { ok: true, count: imported.length };
    },
  };
});

/* ---------------------------------------------------------------- selectors */

export function useActiveProject(): Project | null {
  return useFlowStore((state) => {
    const project = state.projects.find(
      (candidate) => candidate.id === state.activeProjectId,
    );
    return project ?? null;
  });
}

export function useSelectedNode(): FlowNode | null {
  return useFlowStore((state) => {
    const project = state.projects.find(
      (candidate) => candidate.id === state.activeProjectId,
    );
    return project?.nodes.find((node) => node.id === state.selectedNodeId) ?? null;
  });
}

export function useSelectedConnection(): FlowConnection | null {
  return useFlowStore((state) => {
    const project = state.projects.find(
      (candidate) => candidate.id === state.activeProjectId,
    );
    return (
      project?.connections.find((connection) => connection.id === state.selectedConnectionId) ??
      null
    );
  });
}

export function getNodeFromState(id: string): FlowNode | null {
  const { projects, activeProjectId } = useFlowStore.getState();
  const project = projects.find((candidate) => candidate.id === activeProjectId);
  return project ? (getNode(project, id) ?? null) : null;
}
