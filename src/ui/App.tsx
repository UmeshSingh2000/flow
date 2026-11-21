import { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { getRootNode } from '../core/graph';
import { flushStorage, useFlowStore } from '../state/store';
import { CanvasArea } from './CanvasArea';
import { DialogHost } from './DialogHost';
import { PropertiesPanel } from './PropertiesPanel';
import { Sidebar } from './Sidebar';
import { Toasts } from './Toasts';

export default function App() {
  const init = useFlowStore((state) => state.init);
  const status = useFlowStore((state) => state.status);

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

      const state = useFlowStore.getState();

      if (event.key === 'Escape') {
        state.closeDialog();
        state.selectNode(null);
        return;
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (state.dialog) return;

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
      <div className="app">
        <Sidebar />
        <CanvasArea />
        <PropertiesPanel />
      </div>
      <Toasts />
      <DialogHost />
    </ReactFlowProvider>
  );
}
