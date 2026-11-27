import { useEffect } from 'react';
import { NODE_TYPE_LABELS } from '../core/types';
import { useActiveProject, useFlowStore } from '../state/store';
import { IconCopy, IconPlus, IconTrash } from './icons';
import { copyText } from './vscodeBridge';

interface NodeContextMenuProps {
  nodeId: string;
  x: number;
  y: number;
  onClose(): void;
}

/** Right-click actions for a single canvas node. */
export function NodeContextMenu({ nodeId, x, y, onClose }: NodeContextMenuProps) {
  const project = useActiveProject();
  const addNode = useFlowStore((state) => state.addNode);
  const duplicateNode = useFlowStore((state) => state.duplicateNode);
  const openDialog = useFlowStore((state) => state.openDialog);
  const notify = useFlowStore((state) => state.notify);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    // Capture phase so Escape closes the menu even when another handler on the
    // focused control stops the event from bubbling.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  const node = project?.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  const isRoot = node.parentId === null;

  // Keep the menu inside the viewport.
  const left = Math.max(8, Math.min(x, window.innerWidth - 232));
  const top = Math.max(8, Math.min(y, window.innerHeight - 286));

  return (
    <>
      <div
        className="connection-menu-scrim"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className="menu canvas-menu"
        style={{ left, top }}
        role="menu"
        aria-label={`Actions for ${node.title}`}
      >
        <div className="canvas-menu-head">
          <span className="eyebrow">{NODE_TYPE_LABELS[node.type]}</span>
          <p>{node.title}</p>
          <code className="canvas-menu-id" title={node.id}>
            {node.id}
          </code>
        </div>
        <button
          type="button"
          role="menuitem"
          autoFocus
          onClick={() => {
            addNode(node.id);
            onClose();
          }}
        >
          <IconPlus size={13} /> Add child node
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            void copyText(node.id);
            notify('Node ID copied.');
            onClose();
          }}
        >
          <IconCopy size={13} /> Copy node ID
        </button>
        <button
          type="button"
          role="menuitem"
          disabled={isRoot}
          title={isRoot ? 'The project root cannot be duplicated.' : undefined}
          onClick={() => {
            duplicateNode(node.id);
            onClose();
          }}
        >
          <IconCopy size={13} /> Duplicate
        </button>
        <hr />
        <button
          type="button"
          role="menuitem"
          className="danger"
          disabled={isRoot}
          title={isRoot ? 'Delete the project instead of its root node.' : undefined}
          onClick={() => {
            openDialog({ kind: 'delete-node', id: node.id });
            onClose();
          }}
        >
          <IconTrash size={13} /> Delete node…
        </button>
      </div>
    </>
  );
}
