import { NODE_TYPES, NODE_TYPE_LABELS } from '../core/types';
import type { NodeType } from '../core/types';
import { useFlowStore } from '../state/store';

/** Node types offered after dropping a connector on empty canvas. */
const MENU_TYPES: NodeType[] = NODE_TYPES.filter((type) => type !== 'project');

export function ConnectionMenu() {
  const menu = useFlowStore((state) => state.connectionMenu);
  const closeConnectionMenu = useFlowStore((state) => state.closeConnectionMenu);
  const createNodeFromConnection = useFlowStore((state) => state.createNodeFromConnection);

  const sourceTitle = useFlowStore((state) => {
    if (!menu) return null;
    const project = state.projects.find(
      (candidate) => candidate.id === state.activeProjectId,
    );
    return (
      project?.nodes.find((candidate) => candidate.id === menu.sourceId)?.title ?? null
    );
  });

  if (!menu) return null;

  // Keep the menu inside the viewport.
  const left = Math.max(8, Math.min(menu.screenX, window.innerWidth - 224));
  const top = Math.max(8, Math.min(menu.screenY, window.innerHeight - 288));

  return (
    <>
      <div className="connection-menu-scrim" onClick={closeConnectionMenu} />
      <div
        className="connection-menu"
        style={{ left, top }}
        role="menu"
        aria-label="Create a connected node"
      >
        <div className="connection-menu-head">
          <span className="eyebrow">CONNECT TO NEW NODE</span>
          <p>from “{sourceTitle ?? 'node'}”</p>
        </div>
        {MENU_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="menuitem"
            onClick={() => createNodeFromConnection(type)}
          >
            <span className={`type-dot type-dot-${type}`} aria-hidden />
            {NODE_TYPE_LABELS[type]}
          </button>
        ))}
        <button type="button" role="menuitem" className="cancel" onClick={closeConnectionMenu}>
          Cancel
        </button>
      </div>
    </>
  );
}
