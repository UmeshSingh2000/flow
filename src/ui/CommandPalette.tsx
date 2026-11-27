import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { canConnect, getNode, getRootNode } from '../core/graph';
import { NODE_TYPE_LABELS, NODE_TYPES } from '../core/types';
import type { FlowNode, NodeType, Project } from '../core/types';
import { useGuideStore } from '../state/guideStore';
import { useActiveProject, useFlowStore } from '../state/store';
import type { MapView } from '../state/store';
import { buildRows } from './views/rows';
import { copyText } from './vscodeBridge';
import {
  IconCopy,
  IconDownload,
  IconHelp,
  IconLink,
  IconPanelLeft,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTerminal,
  IconTrash,
  IconUpload,
} from './icons';

const VIEW_OPTIONS: { id: MapView; label: string }[] = [
  { id: 'canvas', label: 'Canvas' },
  { id: 'table', label: 'Table' },
  { id: 'board', label: 'Board' },
  { id: 'docs', label: 'Docs' },
];

type Stage =
  | { kind: 'commands' }
  | {
      kind: 'pick-node';
      purpose: 'jump' | 'connect-source' | 'connect-target';
      sourceId?: string;
    }
  | { kind: 'node-type'; nodeId: string }
  | { kind: 'title'; purpose: 'new-node'; parentId: string | null }
  | { kind: 'title'; purpose: 'rename-node'; nodeId: string; initial: string }
  | { kind: 'title'; purpose: 'node-description'; nodeId: string; initial: string }
  | { kind: 'title'; purpose: 'connection-label'; connectionId: string; initial: string };

interface BaseItem {
  id: string;
  group: string;
  title: string;
  hint?: string;
  keywords?: string;
}

interface CommandItem extends BaseItem {
  kind: 'command';
  icon?: ReactNode;
  run(): void;
}

interface NodeItem extends BaseItem {
  kind: 'node';
  node: FlowNode;
  meta: string;
  run(): void;
}

interface TypeItem extends BaseItem {
  kind: 'type';
  type: NodeType;
  run(): void;
}

type PaletteItem = CommandItem | NodeItem | TypeItem;

function matches(haystacks: Array<string | undefined>, needle: string): boolean {
  return haystacks.some((value) => value?.toLowerCase().includes(needle) ?? false);
}

/** Breadcrumb of ancestor titles, used to disambiguate similarly named nodes. */
function nodePath(project: Project, node: FlowNode): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let current = node.parentId ? getNode(project, node.parentId) : undefined;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.title);
    current = current.parentId ? getNode(project, current.parentId) : undefined;
  }
  return parts.join(' / ');
}

function stageTitle(stage: Stage, project: Project | null): string {
  switch (stage.kind) {
    case 'commands':
      return 'Commands';
    case 'node-type':
      return 'Change node type';
    case 'pick-node':
      if (stage.purpose === 'jump') return 'Go to node';
      if (stage.purpose === 'connect-source') return 'Connect nodes — choose a source';
      return `Connect “${
        (project ? getNode(project, stage.sourceId ?? null)?.title : null) ?? 'node'
      }” to…`;
    case 'title':
      switch (stage.purpose) {
        case 'new-node':
          return 'New node';
        case 'rename-node':
          return 'Rename node';
        case 'node-description':
          return 'Edit node description';
        case 'connection-label':
          return 'Connection label';
      }
  }
}

function stagePlaceholder(stage: Stage): string {
  switch (stage.kind) {
    case 'commands':
      return 'Search commands or nodes…';
    case 'node-type':
      return 'Search node types…';
    case 'pick-node':
      if (stage.purpose === 'connect-source') return 'Choose the source node…';
      if (stage.purpose === 'connect-target') return 'Choose the target node…';
      return 'Search nodes…';
    case 'title':
      if (stage.purpose === 'new-node') return 'Node title (optional)';
      if (stage.purpose === 'rename-node') return 'Node title';
      if (stage.purpose === 'node-description') return 'Short description';
      return 'Label (optional)';
  }
}

function titleHelp(stage: Extract<Stage, { kind: 'title' }>): string {
  switch (stage.purpose) {
    case 'new-node':
      return 'Creates a node below the current selection. Leave the title empty to use a default.';
    case 'rename-node':
      return 'The new title is saved to this device immediately.';
    case 'node-description':
      return 'Shown beneath the node title in the tree, cards, and other views.';
    case 'connection-label':
      return 'Labels are drawn on the connection in the canvas.';
  }
}

export function CommandPalette() {
  const status = useFlowStore((state) => state.status);
  const open = useFlowStore((state) => state.commandPaletteOpen);
  const openCommandPalette = useFlowStore((state) => state.openCommandPalette);
  const closeCommandPalette = useFlowStore((state) => state.closeCommandPalette);

  const projects = useFlowStore((state) => state.projects);
  const project = useActiveProject();
  const selectedNodeId = useFlowStore((state) => state.selectedNodeId);
  const selectedConnectionId = useFlowStore((state) => state.selectedConnectionId);
  const view = useFlowStore((state) => state.view);
  const theme = useFlowStore((state) => state.theme);
  const sidebarOpen = useFlowStore((state) => state.sidebarOpen);

  const addNode = useFlowStore((state) => state.addNode);
  const updateNode = useFlowStore((state) => state.updateNode);
  const duplicateNode = useFlowStore((state) => state.duplicateNode);
  const connect = useFlowStore((state) => state.connect);
  const updateConnection = useFlowStore((state) => state.updateConnection);
  const deleteConnection = useFlowStore((state) => state.deleteConnection);
  const openDialog = useFlowStore((state) => state.openDialog);
  const openMarkdownEditor = useFlowStore((state) => state.openMarkdownEditor);
  const exportBackup = useFlowStore((state) => state.exportBackup);
  const importBackup = useFlowStore((state) => state.importBackup);
  const notify = useFlowStore((state) => state.notify);
  const setView = useFlowStore((state) => state.setView);
  const openInCanvas = useFlowStore((state) => state.openInCanvas);
  const setTheme = useFlowStore((state) => state.setTheme);
  const toggleSidebar = useFlowStore((state) => state.toggleSidebar);

  const guideActive = useGuideStore((state) => state.status === 'active');
  const startGuide = useGuideStore((state) => state.start);

  const [stage, setStage] = useState<Stage>({ kind: 'commands' });
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const closePalette = useCallback(() => {
    closeCommandPalette();
  }, [closeCommandPalette]);

  // Every opening starts from the command list, never a stale stage or query.
  useEffect(() => {
    if (!open) return;
    setStage({ kind: 'commands' });
    setQuery('');
    setActive(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      if (stage.kind === 'title') inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, stage]);

  // Cmd/Ctrl+K is the keyboard twin of the launcher button.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || event.altKey || event.shiftKey) return;
      // Cmd on macOS, Ctrl elsewhere; Ctrl+K is a line-editing shortcut on macOS.
      const isMacPlatform = /Mac|iPhone|iPad/i.test(navigator.platform);
      if (!(isMacPlatform ? event.metaKey : event.ctrlKey)) return;
      const state = useFlowStore.getState();
      if (useGuideStore.getState().status === 'active') return;
      event.preventDefault();
      if (state.commandPaletteOpen) {
        state.closeCommandPalette();
        return;
      }
      if (
        state.status !== 'ready' ||
        state.dialog ||
        state.markdownEditorNodeId ||
        state.imageViewer
      ) {
        return;
      }
      state.closeConnectionMenu();
      state.openCommandPalette();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const startStage = (next: Stage, initial = '') => {
    setStage(next);
    setQuery(initial);
    setActive(0);
  };

  const goBack = () => {
    if (stage.kind === 'commands') closePalette();
    else startStage({ kind: 'commands' });
  };

  // Escape closes the palette even when focus has left the search field.
  useEffect(() => {
    if (!open) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closePalette();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open, closePalette]);

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

  const selectedNode =
    project?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedConnection =
    project?.connections.find((connection) => connection.id === selectedConnectionId) ?? null;
  const rootId = project ? (getRootNode(project)?.id ?? null) : null;
  const rows = project ? buildRows(project) : [];

  const commandItems: PaletteItem[] = [];
  const push = (item: Omit<CommandItem, 'kind'>) => {
    commandItems.push({ kind: 'command', ...item });
  };

  /* ------------------------------------------------------------- create */
  push({
    id: 'new-project',
    group: 'Create',
    title: 'New project…',
    hint: 'Create a local project',
    keywords: 'create project workspace new',
    icon: <IconPlus size={14} />,
    run: () => {
      closePalette();
      openDialog({ kind: 'new-project' });
    },
  });

  if (project) {
    push({
      id: 'new-node',
      group: 'Create',
      title: 'New node…',
      hint: 'Type a title, then create it',
      keywords: 'create add node child title name new',
      icon: <IconPlus size={14} />,
      run: () => startStage({ kind: 'title', purpose: 'new-node', parentId: selectedNodeId }),
    });
    push({
      id: 'add-node',
      group: 'Create',
      title: 'Add node',
      hint: 'Quick add with a default title',
      keywords: 'create add node child quick',
      icon: <IconPlus size={14} />,
      run: () => {
        closePalette();
        addNode();
      },
    });

    if (selectedNode && selectedNode.id !== rootId) {
      push({
        id: 'duplicate-node',
        group: 'Create',
        title: 'Duplicate node',
        hint: 'Copy it under the same parent',
        keywords: 'copy duplicate clone',
        icon: <IconCopy size={14} />,
        run: () => {
          closePalette();
          duplicateNode(selectedNode.id);
        },
      });
    }
  }

  /* --------------------------------------------------------------- edit */
  if (selectedNode) {
    push({
      id: 'rename-node',
      group: 'Edit',
      title: 'Rename node…',
      hint: 'Change its title',
      keywords: 'rename title edit name',
      icon: <IconPencil size={14} />,
      run: () =>
        startStage(
          {
            kind: 'title',
            purpose: 'rename-node',
            nodeId: selectedNode.id,
            initial: selectedNode.title,
          },
          selectedNode.title,
        ),
    });
    push({
      id: 'describe-node',
      group: 'Edit',
      title: 'Edit description…',
      hint: 'One-line summary',
      keywords: 'description summary edit details',
      icon: <IconPencil size={14} />,
      run: () =>
        startStage(
          {
            kind: 'title',
            purpose: 'node-description',
            nodeId: selectedNode.id,
            initial: selectedNode.description,
          },
          selectedNode.description,
        ),
    });
    push({
      id: 'change-node-type',
      group: 'Edit',
      title: 'Change node type…',
      hint: `Currently ${NODE_TYPE_LABELS[selectedNode.type]}`,
      keywords: 'type kind category node',
      icon: <IconSettings size={14} />,
      run: () => startStage({ kind: 'node-type', nodeId: selectedNode.id }),
    });
    push({
      id: 'copy-node-id',
      group: 'Edit',
      title: 'Copy node ID',
      hint: selectedNode.id,
      keywords: 'copy id identifier uuid node',
      icon: <IconCopy size={14} />,
      run: () => {
        closePalette();
        void copyText(selectedNode.id);
        notify('Node ID copied.');
      },
    });
    push({
      id: 'edit-markdown',
      group: 'Edit',
      title: 'Edit Markdown notes…',
      hint: 'Open the full-screen editor',
      keywords: 'markdown notes documentation docs write',
      icon: <IconPencil size={14} />,
      run: () => {
        closePalette();
        openMarkdownEditor(selectedNode.id);
      },
    });
    if (selectedNode.id !== rootId) {
      push({
        id: 'delete-node',
        group: 'Edit',
        title: 'Delete node…',
        hint: 'Asks for confirmation',
        keywords: 'delete remove node',
        icon: <IconTrash size={14} />,
        run: () => {
          closePalette();
          openDialog({ kind: 'delete-node', id: selectedNode.id });
        },
      });
    }
  }

  if (selectedConnection) {
    push({
      id: 'edit-connection-label',
      group: 'Edit',
      title: 'Edit connection label…',
      hint: selectedConnection.label || 'No label yet',
      keywords: 'connection label edge link rename',
      icon: <IconPencil size={14} />,
      run: () =>
        startStage(
          {
            kind: 'title',
            purpose: 'connection-label',
            connectionId: selectedConnection.id,
            initial: selectedConnection.label,
          },
          selectedConnection.label,
        ),
    });
    push({
      id: 'delete-connection',
      group: 'Edit',
      title: 'Delete connection',
      hint: 'Remove the selected link',
      keywords: 'delete remove connection edge link',
      icon: <IconTrash size={14} />,
      run: () => {
        closePalette();
        deleteConnection(selectedConnection.id);
      },
    });
  }

  /* ------------------------------------------------------------ connect */
  if (project && project.nodes.length > 1) {
    if (selectedNode) {
      push({
        id: 'connect-from-selected',
        group: 'Connect',
        title: 'Connect selected node to…',
        hint: 'Pick the target node',
        keywords: 'connect link edge relationship',
        icon: <IconLink size={14} />,
        run: () =>
          startStage({
            kind: 'pick-node',
            purpose: 'connect-target',
            sourceId: selectedNode.id,
          }),
      });
    } else {
      push({
        id: 'connect-two-nodes',
        group: 'Connect',
        title: 'Connect two nodes…',
        hint: 'Pick a source, then a target',
        keywords: 'connect link edge relationship',
        icon: <IconLink size={14} />,
        run: () => startStage({ kind: 'pick-node', purpose: 'connect-source' }),
      });
    }
  }

  /* ----------------------------------------------------------- navigate */
  if (project && project.nodes.length > 0) {
    push({
      id: 'go-to-node',
      group: 'Navigate',
      title: 'Go to node…',
      hint: 'Search the project and jump there',
      keywords: 'go jump find search locate node',
      icon: <IconSearch size={14} />,
      run: () => startStage({ kind: 'pick-node', purpose: 'jump' }),
    });
  }

  for (const option of VIEW_OPTIONS) {
    if (option.id === view) continue;
    push({
      id: `view-${option.id}`,
      group: 'View',
      title: `Switch to ${option.label} view`,
      hint: 'Change how the project is shown',
      keywords: `view ${option.label} switch`,
      icon: <IconPanelLeft size={14} />,
      run: () => {
        closePalette();
        setView(option.id);
      },
    });
  }

  push({
    id: 'toggle-theme',
    group: 'View',
    title: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
    hint: 'Appearance',
    keywords: 'theme dark light appearance toggle',
    icon: <IconSettings size={14} />,
    run: () => {
      closePalette();
      setTheme(theme === 'dark' ? 'light' : 'dark');
    },
  });

  push({
    id: 'toggle-sidebar',
    group: 'View',
    title: `${sidebarOpen ? 'Hide' : 'Show'} sidebar`,
    hint: 'Layout',
    keywords: 'sidebar project tree layout toggle',
    icon: <IconPanelLeft size={14} />,
    run: () => {
      closePalette();
      toggleSidebar();
    },
  });

  push({
    id: 'replay-tour',
    group: 'View',
    title: 'Replay guided tour',
    hint: 'Walk through the basics again',
    keywords: 'guide tour help onboarding replay',
    icon: <IconHelp size={14} />,
    run: () => {
      closePalette();
      startGuide();
    },
  });

  /* ------------------------------------------------------------ project */
  if (project) {
    push({
      id: 'rename-project',
      group: 'Project',
      title: 'Rename project…',
      hint: 'Change its name and description',
      keywords: 'rename project title edit',
      icon: <IconPencil size={14} />,
      run: () => {
        closePalette();
        openDialog({ kind: 'edit-project', id: project.id });
      },
    });
    push({
      id: 'export-project',
      group: 'Project',
      title: 'Export project backup',
      hint: 'Download a portable JSON file',
      keywords: 'export backup download json project',
      icon: <IconDownload size={14} />,
      run: () => {
        closePalette();
        exportBackup('project');
      },
    });
    push({
      id: 'delete-project',
      group: 'Project',
      title: 'Delete project…',
      hint: 'Asks for confirmation',
      keywords: 'delete remove project',
      icon: <IconTrash size={14} />,
      run: () => {
        closePalette();
        openDialog({ kind: 'delete-project', id: project.id });
      },
    });
  }

  if (projects.length > 0) {
    push({
      id: 'export-workspace',
      group: 'Project',
      title: 'Export all projects',
      hint: `${projects.length} project${projects.length === 1 ? '' : 's'} in one backup`,
      keywords: 'export backup download json workspace all',
      icon: <IconDownload size={14} />,
      run: () => {
        closePalette();
        exportBackup('workspace');
      },
    });
  }

  push({
    id: 'import-backup',
    group: 'Project',
    title: 'Import backup…',
    hint: 'Restore from a JSON file',
    keywords: 'import restore backup json file',
    icon: <IconUpload size={14} />,
    run: () => {
      closePalette();
      fileInputRef.current?.click();
    },
  });

  /* -------------------------------------------------------------- items */
  const needle = query.trim().toLowerCase();

  const makeNodeItem = (
    node: FlowNode,
    group: string,
    run: () => void,
  ): NodeItem => ({
    kind: 'node',
    id: `node-${node.id}`,
    group,
    title: node.title,
    hint: project ? nodePath(project, node) || 'Project root' : '',
    meta: NODE_TYPE_LABELS[node.type],
    node,
    run,
  });

  let items: PaletteItem[] = [];

  if (stage.kind === 'commands') {
    items = needle
      ? commandItems.filter((item) => matches([item.title, item.keywords], needle))
      : commandItems;

    if (needle && project) {
      // A query doubles as node search: matches jump straight to the canvas.
      const nodeMatches = rows
        .filter(({ node }) =>
          matches([node.title, node.description, NODE_TYPE_LABELS[node.type]], needle),
        )
        .slice(0, 6)
        .map(({ node }) =>
          makeNodeItem(node, 'Nodes', () => {
            closePalette();
            openInCanvas(node.id);
          }),
        );
      items = [...items, ...nodeMatches];
    }
  } else if (stage.kind === 'pick-node') {
    const pick = stage;
    items = rows
      .filter(({ node }) => !pick.sourceId || node.id !== pick.sourceId)
      .filter(
        ({ node }) =>
          !needle ||
          matches([node.title, node.description, NODE_TYPE_LABELS[node.type]], needle),
      )
      .filter(({ node }) => {
        if (pick.purpose !== 'connect-target' || !pick.sourceId || !project) return true;
        return canConnect(project, pick.sourceId, node.id).ok;
      })
      .map(({ node }) =>
        makeNodeItem(node, 'Nodes', () => {
          if (pick.purpose === 'jump') {
            closePalette();
            openInCanvas(node.id);
            return;
          }
          if (pick.purpose === 'connect-source') {
            startStage({ kind: 'pick-node', purpose: 'connect-target', sourceId: node.id });
            return;
          }
          closePalette();
          if (pick.sourceId) connect(pick.sourceId, node.id);
        }),
      );
  } else if (stage.kind === 'node-type') {
    const typeStage = stage;
    items = NODE_TYPES.filter(
      (type) => !needle || NODE_TYPE_LABELS[type].toLowerCase().includes(needle),
    ).map((type) => ({
      kind: 'type',
      id: `type-${type}`,
      group: 'Node types',
      title: NODE_TYPE_LABELS[type],
      hint: type === 'decision' ? 'A branching condition' : undefined,
      type,
      run: () => {
        updateNode(typeStage.nodeId, { type });
        closePalette();
      },
    }));
  }

  const activeIndex = items.length === 0 ? -1 : Math.min(active, items.length - 1);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document
      .getElementById(`command-item-${activeIndex}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const move = (delta: number) => {
    if (items.length === 0) return;
    setActive((previous) => {
      const base = Math.min(previous, items.length - 1);
      return (base + delta + items.length) % items.length;
    });
  };

  const runItem = (item: PaletteItem | undefined) => {
    if (item) item.run();
  };

  const submitTitle = () => {
    if (stage.kind !== 'title') return;
    const value = query.trim();
    switch (stage.purpose) {
      case 'new-node': {
        const id = addNode(stage.parentId);
        if (id && value) updateNode(id, { title: value });
        closePalette();
        return;
      }
      case 'rename-node': {
        if (!value) return;
        updateNode(stage.nodeId, { title: value });
        closePalette();
        return;
      }
      case 'node-description': {
        updateNode(stage.nodeId, { description: value });
        closePalette();
        return;
      }
      case 'connection-label': {
        updateConnection(stage.connectionId, { label: value });
        closePalette();
        return;
      }
    }
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      goBack();
      return;
    }
    if (stage.kind === 'title') {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitTitle();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      runItem(activeIndex >= 0 ? items[activeIndex] : undefined);
    }
  };

  const handleOpen = () => {
    if (useGuideStore.getState().status === 'active') return;
    const state = useFlowStore.getState();
    if (state.commandPaletteOpen) {
      state.closeCommandPalette();
      return;
    }
    if (
      state.dialog ||
      state.markdownEditorNodeId ||
      state.imageViewer
    ) {
      return;
    }
    state.closeConnectionMenu();
    openCommandPalette();
  };

  if (status !== 'ready' || guideActive) return null;

  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);
  const shortcutLabel = isMac ? '⌘K' : 'Ctrl K';
  const emptyMessage =
    stage.kind === 'node-type'
      ? 'No node types match.'
      : stage.kind === 'pick-node'
        ? needle
          ? 'No nodes match.'
          : stage.purpose === 'connect-target'
            ? 'No other nodes are available to connect to.'
            : 'This project has no nodes yet.'
        : `No commands or nodes match “${query.trim()}”.`;

  return (
    <>
      <button
        type="button"
        className="command-launch"
        title="Open command palette"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="Control+K Meta+K"
        onClick={handleOpen}
      >
        <IconTerminal size={14} />
        <span>Commands</span>
        <kbd className="command-kbd">{shortcutLabel}</kbd>
      </button>

      {open && (
        <div className="command-layer">
          <div className="command-scrim" onMouseDown={closePalette} />
          <div
            className="command-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <header className="command-head">
              <IconSearch size={15} className="command-search-icon" />
              <input
                ref={inputRef}
                className="command-input"
                type="text"
                role="combobox"
                aria-label="Search commands"
                aria-expanded="true"
                aria-controls={stage.kind === 'title' ? undefined : 'command-list'}
                aria-autocomplete="list"
                aria-activedescendant={
                  activeIndex >= 0 ? `command-item-${activeIndex}` : undefined
                }
                autoComplete="off"
                spellCheck={false}
                value={query}
                placeholder={stagePlaceholder(stage)}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKeyDown}
              />
              <button
                type="button"
                className="command-close"
                onClick={closePalette}
                aria-label="Close command palette"
              >
                <kbd className="command-kbd">esc</kbd>
              </button>
            </header>

            {stage.kind !== 'commands' && (
              <div className="command-stage">
                <button type="button" className="command-back" onClick={goBack}>
                  ← Back
                </button>
                <span>{stageTitle(stage, project)}</span>
              </div>
            )}

            {stage.kind === 'title' ? (
              <div className="command-form">
                <p>{titleHelp(stage)}</p>
                <p className="command-form-hint">
                  Press <kbd className="command-kbd">↵</kbd> to save,{' '}
                  <kbd className="command-kbd">esc</kbd> to go back.
                </p>
              </div>
            ) : (
              <div className="command-list" id="command-list" role="listbox">
                {items.length === 0 ? (
                  <p className="command-empty">{emptyMessage}</p>
                ) : (
                  items.map((item, index) => {
                    const showGroup =
                      index === 0 || items[index - 1]?.group !== item.group;
                    return (
                      <Fragment key={item.id}>
                        {showGroup && (
                          <div className="command-group" role="presentation">
                            {item.group}
                          </div>
                        )}
                        <div
                          id={`command-item-${index}`}
                          role="option"
                          aria-selected={index === activeIndex}
                          className={`command-item${index === activeIndex ? ' is-active' : ''}`}
                          onMouseMove={() => setActive(index)}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => runItem(item)}
                        >
                          <span className="command-item-icon">
                            {item.kind === 'command' ? (
                              item.icon
                            ) : item.kind === 'node' ? (
                              <span
                                className={`type-dot type-dot-${item.node.type}`}
                                aria-hidden
                              />
                            ) : (
                              <span
                                className={`type-dot type-dot-${item.type}`}
                                aria-hidden
                              />
                            )}
                          </span>
                          <span className="command-item-body">
                            <span className="command-item-title">{item.title}</span>
                            {item.hint && (
                              <span className="command-item-hint">{item.hint}</span>
                            )}
                          </span>
                          {item.kind === 'node' && (
                            <span className="command-item-meta">{item.meta}</span>
                          )}
                        </div>
                      </Fragment>
                    );
                  })
                )}
              </div>
            )}

            <footer className="command-foot">
              <span className="command-foot-hint">
                <kbd className="command-kbd">↑</kbd>
                <kbd className="command-kbd">↓</kbd> move
              </span>
              <span className="command-foot-hint">
                <kbd className="command-kbd">↵</kbd> run
              </span>
              <span className="command-foot-hint">
                <kbd className="command-kbd">esc</kbd>{' '}
                {stage.kind === 'commands' ? 'close' : 'back'}
              </span>
              <span className="command-foot-brand">Flow commands</span>
            </footer>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
    </>
  );
}
