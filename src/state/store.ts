import { create } from 'zustand';
import {
  addChildNode,
  addImageToNode as addImageToNodeInProject,
  createConnection,
  createNodeRecord,
  createProject as buildProject,
  defaultChildType,
  defaultNodeTitle,
  removeImageFromNode as removeImageFromNodeInProject,
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
import { computeAutoLayout } from '../core/layout';
import {
  applyPlan,
  type ApplyPlanSummary,
  type OperationChange,
} from '../core/operations';
import { buildBackup, parseBackup } from '../core/validation';
import type {
  ConnectionType,
  FlowConnection,
  FlowNode,
  NodeDetails,
  NodeImage,
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

/** How the current project is presented: the spatial map plus readable alternatives. */
export type MapView = 'canvas' | 'table' | 'board' | 'docs';

const VIEW_KEY = 'flow-view';
export type Theme = 'light' | 'dark';
const THEME_KEY = 'flow-theme';

/**
 * Theme state injected by the VS Code extension host before the app boots
 * (see src/extension/extension.cjs). `theme` is the user's explicit saved
 * choice; `hostTheme` mirrors the current VS Code color theme. Absent in the
 * plain web app.
 */
export interface ThemeBootstrap {
  theme: Theme | null;
  hostTheme: Theme;
}

/**
 * Injected by the VS Code extension host when the window has a workspace
 * folder. `projectId` is the linked Flow project (null on the first open, in
 * which case the app creates one and reports its id back to the host).
 */
export interface WorkspaceBootstrap {
  projectId: string | null;
  workspaceName: string;
}

declare global {
  interface Window {
    __FLOW_THEME_BOOTSTRAP__?: ThemeBootstrap;
    __FLOW_WORKSPACE__?: WorkspaceBootstrap;
  }
}

export interface ExternalPlanPayload {
  ops: unknown;
  dryRun?: boolean;
  provenance?: unknown;
  projectId?: string;
}

export interface ExternalPlanResult {
  ok: boolean;
  dryRun: boolean;
  errors: string[];
  changes: OperationChange[];
  summary: ApplyPlanSummary;
  projectId: string | null;
}

function emptyPlanSummary(): ApplyPlanSummary {
  return { created: 0, updated: 0, unchanged: 0, connected: 0 };
}

function readWorkspaceBootstrap(): WorkspaceBootstrap | null {
  const boot = window.__FLOW_WORKSPACE__;
  if (!boot || typeof boot !== 'object') return null;
  const projectId = boot.projectId;
  const workspaceName = boot.workspaceName;
  if (!(projectId === null || typeof projectId === 'string')) return null;
  if (typeof workspaceName !== 'string') return null;
  return {
    projectId: projectId && projectId.trim() ? projectId : null,
    workspaceName: workspaceName.trim() || 'Workspace',
  };
}

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

function readBootstrap(): ThemeBootstrap | null {
  const boot = window.__FLOW_THEME_BOOTSTRAP__;
  if (!boot || typeof boot !== 'object') return null;
  if (!isTheme(boot.hostTheme) || !(boot.theme === null || isTheme(boot.theme))) {
    return null;
  }
  return boot;
}

/** True when the user (or host) provided an explicit theme choice up front. */
export function hasExplicitTheme(): boolean {
  const boot = readBootstrap();
  return boot ? boot.theme !== null : false;
}

export function readTheme(): Theme {
  const boot = readBootstrap();
  if (boot) return boot.theme ?? boot.hostTheme;
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  if (typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage unavailable */
  }
}

function readView(): MapView {
  try {
    const stored = window.localStorage.getItem(VIEW_KEY);
    if (stored === 'table' || stored === 'board' || stored === 'docs') return stored;
  } catch {
    /* storage unavailable */
  }
  return 'canvas';
}

function writeView(view: MapView): void {
  try {
    window.localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* storage unavailable */
  }
}

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
  theme: Theme;
  setTheme(theme: Theme): void;

  projects: Project[];
  activeProjectId: string | null;
  /** Flow project linked to the current VS Code workspace, if any. */
  workspaceProjectId: string | null;
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
  /** Image opened in the lightbox, if any. */
  imageViewer: { nodeId: string; imageId: string } | null;

  init(): Promise<void>;

  /**
   * Applies a validated plan from the terminal/MCP bridge. A dry run returns
   * the diff without touching the project.
   */
  applyExternalPlan(payload: ExternalPlanPayload): ExternalPlanResult;

  createProject(name: string, description?: string): void;
  updateProject(id: string, patch: { name?: string; description?: string }): void;
  deleteProject(id: string): Promise<void>;
  selectProject(id: string): void;

  addNode(parentId?: string | null): string | null;
  updateNode(id: string, patch: NodePatch): void;
  duplicateNode(id: string): void;
  previewNodePosition(id: string, position: Point): void;
  commitNodePosition(id: string, position: Point): void;
  /** Repositions every node into a tidy hierarchy tree using measured heights. */
  autoArrange(nodeHeights?: Record<string, number>): void;
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

  /** Whether the bottom command palette is open. */
  commandPaletteOpen: boolean;
  openCommandPalette(): void;
  closeCommandPalette(): void;

  openDialog(dialog: DialogState): void;
  closeDialog(): void;
  notify(message: string, tone?: Tone): void;

  openConnectionMenu(menu: ConnectionMenuState): void;
  closeConnectionMenu(): void;
  /** Creates a node of `type` at the drop point and connects it to the source node. */
  createNodeFromConnection(type: NodeType): void;

  openMarkdownEditor(nodeId: string): void;
  closeMarkdownEditor(): void;

  view: MapView;
  setView(view: MapView): void;
  /** Switches to the canvas and centres a node — used by the other views. */
  openInCanvas(nodeId: string): void;

  /** Attaches one image to a node, respecting the per-node limit. */
  addImage(nodeId: string, image: NodeImage): void;
  removeImage(nodeId: string, imageId: string): void;
  /** Creates a node at a canvas position holding the given images. */
  createNodeWithImages(position: Point, images: NodeImage[]): string | null;
  openImageViewer(nodeId: string, imageId: string): void;
  closeImageViewer(): void;

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
    theme: readTheme(),
    projects: [],
    activeProjectId: null,
    workspaceProjectId: null,
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
    imageViewer: null,
    view: readView(),
    sidebarOpen: true,
    commandPaletteOpen: false,

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
              images: node.images ?? [],
            })),
          }));
        activeProjectId = projects.some((project) => project.id === stored.activeProjectId)
          ? stored.activeProjectId
          : projects[0].id;
      }

      // A window with a workspace folder is linked to exactly one project.
      // On the first open (or when the linked project was deleted) the app
      // creates the project here and reports the new id back to the host.
      const workspace = readWorkspaceBootstrap();
      let workspaceProjectId: string | null = null;
      let createdForWorkspace = false;
      let linkedProject: Project | null = null;

      if (workspace) {
        linkedProject =
          (workspace.projectId
            ? projects.find((project) => project.id === workspace.projectId)
            : undefined) ?? null;
        if (!linkedProject) {
          linkedProject = buildProject(workspace.workspaceName);
          projects = [...projects, linkedProject];
          createdForWorkspace = true;
        }
        activeProjectId = linkedProject.id;
        workspaceProjectId = linkedProject.id;
      }

      set({
        status: 'ready',
        projects,
        activeProjectId,
        workspaceProjectId,
        expandedIds: allNodesExpanded(projects),
        storageKind: adapter.kind,
        persistent: adapter.persistent,
        storageWarning: adapter.warning,
      });

      if (workspace && activeProjectId) {
        if (createdForWorkspace && linkedProject) scheduleSave(linkedProject);
        void adapter?.saveActiveProjectId(activeProjectId);
      }
      if (createdForWorkspace && linkedProject) {
        showToast(
          `Created the Flow project “${linkedProject.name}” for this workspace.`,
        );
      }
    },

    applyExternalPlan(payload) {
      const state = get();
      const dryRun = payload.dryRun === true;
      const fallback = (errors: string[]): ExternalPlanResult => ({
        ok: false,
        dryRun,
        errors,
        changes: [],
        summary: emptyPlanSummary(),
        projectId: state.activeProjectId,
      });

      let project =
        state.projects.find((candidate) => candidate.id === state.activeProjectId) ?? null;
      if (payload.projectId) {
        const requested = state.projects.find(
          (candidate) => candidate.id === payload.projectId,
        );
        if (!requested) {
          return fallback([
            `Flow project "${payload.projectId}" is not available in this app. Re-link the workspace from the Command Palette.`,
          ]);
        }
        project = requested;
      }
      if (!project) {
        return fallback(['There is no active Flow project.']);
      }

      const result = applyPlan(project, {
        ops: payload.ops,
        dryRun,
        provenance: payload.provenance,
      });
      const outcome: ExternalPlanResult = {
        ok: result.ok,
        dryRun: result.dryRun,
        errors: result.errors,
        changes: result.changes,
        summary: result.summary,
        projectId: project.id,
      };
      if (!result.ok || result.dryRun || !result.project) return outcome;

      if (state.activeProjectId !== project.id) {
        set({
          activeProjectId: project.id,
          selectedNodeId: null,
          selectedConnectionId: null,
          markdownEditorNodeId: null,
        });
        void adapter?.saveActiveProjectId(project.id);
      }
      apply(result.project);

      const createdIds = result.changes
        .filter(
          (change) =>
            change.action === 'created' &&
            change.operation === 'upsert-node' &&
            typeof change.nodeId === 'string',
        )
        .map((change) => change.nodeId as string);
      if (createdIds.length > 0) expand(createdIds);

      const parts: string[] = [];
      if (result.summary.created > 0) parts.push(`${result.summary.created} added`);
      if (result.summary.updated > 0) parts.push(`${result.summary.updated} updated`);
      if (result.summary.connected > 0) parts.push(`${result.summary.connected} connected`);
      showToast(
        parts.length > 0
          ? `Flow plan applied: ${parts.join(', ')}.`
          : 'Flow plan applied with no changes.',
      );
      return outcome;
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

    autoArrange(nodeHeights) {
      const project = active();
      if (!project) return;
      const positions = computeAutoLayout(project, { nodeHeights });
      const timestamp = now();
      let moved = 0;
      const nodes = project.nodes.map((node) => {
        const next = positions[node.id];
        if (
          !next ||
          (next.x === node.position.x && next.y === node.position.y)
        ) {
          return node;
        }
        moved += 1;
        return { ...node, position: next, updatedAt: timestamp };
      });
      if (moved === 0) {
        showToast('The canvas is already arranged.');
        return;
      }
      apply({ ...project, nodes, updatedAt: timestamp });
      showToast(`Arranged ${moved} node${moved === 1 ? '' : 's'}.`);
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
          imageViewer:
            state.imageViewer && result.removedIds.includes(state.imageViewer.nodeId)
              ? null
              : state.imageViewer,
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

    openCommandPalette() {
      set({ commandPaletteOpen: true });
    },

    closeCommandPalette() {
      set({ commandPaletteOpen: false });
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

    setTheme(theme) {
      applyTheme(theme);
      set({ theme });
    },

    setView(view) {
      writeView(view);
      set({ view });
    },

    openInCanvas(nodeId) {
      writeView('canvas');
      set({
        view: 'canvas',
        selectedNodeId: nodeId,
        selectedConnectionId: null,
        focusRequest: { nodeId, nonce: ++focusCounter },
      });
    },

    addImage(nodeId, image) {
      const project = active();
      if (!project) return;
      const result = addImageToNodeInProject(project, nodeId, image);
      if (!result.ok) {
        showToast(result.error, 'error');
        return;
      }
      apply(result.project);
      showToast(`Added ${image.name}.`);
    },

    removeImage(nodeId, imageId) {
      const project = active();
      if (!project) return;
      apply(removeImageFromNodeInProject(project, nodeId, imageId));
      set((state) => ({
        imageViewer: state.imageViewer?.imageId === imageId ? null : state.imageViewer,
      }));
    },

    createNodeWithImages(position, images) {
      const project = active();
      if (!project) {
        showToast('Create a project first.', 'error');
        return null;
      }
      const root = getRootNode(project);
      const first = images[0];
      const node = createNodeRecord({
        projectId: project.id,
        parentId: root?.id ?? null,
        type: root ? defaultChildType(root.type) : 'feature',
        title: first ? first.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60) : 'Image',
        position: { x: position.x - NODE_CARD_WIDTH / 2, y: position.y - 60 },
      });
      node.images = images;
      apply({ ...project, nodes: [...project.nodes, node], updatedAt: now() });
      if (root) expand([root.id]);
      set({
        selectedNodeId: node.id,
        selectedConnectionId: null,
        focusRequest: { nodeId: node.id, nonce: ++focusCounter },
      });
      showToast(
        `Created “${node.title}” with ${images.length} image${images.length === 1 ? '' : 's'}.`,
      );
      return node.id;
    },

    openImageViewer(nodeId, imageId) {
      set({ imageViewer: { nodeId, imageId } });
    },

    closeImageViewer() {
      set({ imageViewer: null });
    },

    createNodeFromConnection(type) {
      const menu = get().connectionMenu;
      set({ connectionMenu: null });
      if (!menu) return;
      const project = active();
      if (!project) return;
      const source = getNode(project, menu.sourceId);
      if (!source) return;

      // The new node joins the source's hierarchy level; the connector the user
      // dragged becomes an explicit graph connection between them. The project
      // root is the only node without a parent, so dragging from the root must
      // parent the new node to the root rather than create a second root.
      const parentId =
        source.parentId && getNode(project, source.parentId) ? source.parentId : source.id;

      const node = createNodeRecord({
        projectId: project.id,
        parentId,
        type,
        title: defaultNodeTitle(type),
        position: {
          x: menu.flowX - NODE_CARD_WIDTH / 2,
          y: menu.flowY - 24,
        },
      });
      const withNode = { ...project, nodes: [...project.nodes, node] };
      const [from, to] =
        menu.handleType === 'source' ? [source.id, node.id] : [node.id, source.id];
      const result = createConnection(withNode, from, to);
      if (!result.ok) {
        showToast(result.error, 'error');
        return;
      }
      apply(result.project);
      expand([parentId]);
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
