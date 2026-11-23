import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { getRootNode } from '../core/graph';
import { useGuideStore } from '../state/guideStore';
import { flushStorage, useFlowStore } from '../state/store';
import { CanvasArea } from './CanvasArea';
import { CommandPalette } from './CommandPalette';
import { ConnectionMenu } from './ConnectionMenu';
import { DialogHost } from './DialogHost';
import { Guide } from './Guide';
import { ImageViewer } from './ImageViewer';
import { MarkdownEditor } from './MarkdownEditor';
import { PropertiesPanel } from './PropertiesPanel';
import { ShareDialog } from './ShareDialog';
import { Sidebar } from './Sidebar';
import { Toasts } from './Toasts';
import { IconPanelLeft } from './icons';

export default function App() {
  const init = useFlowStore((state) => state.init);
  const status = useFlowStore((state) => state.status);
  const sidebarOpen = useFlowStore((state) => state.sidebarOpen);
  const toggleSidebar = useFlowStore((state) => state.toggleSidebar);
  const hasSelection = useFlowStore(
    (state) =>
      state.selectedNodeId !== null ||
      state.selectedConnectionId !== null,
  );
  const guideActive = useGuideStore((state) => state.status === 'active');

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return;
      }

      // While the tour is running, only the highlighted control may be used.
      if (useGuideStore.getState().status === 'active') return;

      const state = useFlowStore.getState();

      // The palette owns its own keyboard handling while it is open.
      if (state.commandPaletteOpen) return;

      if (event.key === 'Escape') {
        if (state.imageViewer) {
          state.closeImageViewer();
          return;
        }
        if (state.markdownEditorNodeId) {
          state.closeMarkdownEditor();
          return;
        }
        state.closeDialog();
        state.closeConnectionMenu();
        state.selectNode(null);
        return;
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (state.dialog || state.connectionMenu) return;

      if (state.selectedConnectionId) {
        event.preventDefault();
        state.deleteConnection(state.selectedConnectionId);
        return;
      }

      if (state.selectedNodeId) {
        const project = state.projects.find(
          (candidate) => candidate.id === state.activeProjectId,
        );
        const node = project?.nodes.find(
          (candidate) => candidate.id === state.selectedNodeId,
        );
        if (!project || !node) return;
        event.preventDefault();
        const isRoot = getRootNode(project)?.id === node.id;
        if (isRoot) {
          state.notify(
            'The project root cannot be deleted. Delete the project instead.',
            'error',
          );
        } else {
          state.openDialog({ kind: 'delete-node', id: node.id });
        }
      }
    };

    // Persist buffered edits when the tab is hidden or closed.
    const onVisibilityChange = () => {
      if (document.hidden) void flushStorage();
    };
    const onBeforeUnload = () => {
      void flushStorage();
    };

    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  if (status === 'loading') {
    return (
      <div className="boot">
        <div className="brand-mark" aria-hidden>
          F
        </div>
        <p>Loading your workspace…</p>
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div
        className={[
          'app',
          sidebarOpen ? '' : 'is-sidebar-collapsed',
          hasSelection ? '' : 'is-no-properties',
          guideActive ? 'guide-active' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <Sidebar />
        <CanvasArea />
        <PropertiesPanel />
        {!sidebarOpen && (
          <button
            type="button"
            className="sidebar-rail-toggle"
            title="Open sidebar"
            aria-label="Open sidebar"
            aria-pressed="false"
            onClick={toggleSidebar}
          >
            <IconPanelLeft size={15} />
          </button>
        )}
      </div>
      <Toasts />
      <DialogHost />
      <ShareDialog />
      <ConnectionMenu />
      <CommandPalette />
      <MarkdownEditor />
      <ImageViewer />
      <Guide />
    </ReactFlowProvider>
  );
}
