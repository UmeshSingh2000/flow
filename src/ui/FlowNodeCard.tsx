import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import { NODE_TYPE_LABELS } from '../core/types';
import type { FlowNode } from '../core/types';
import { useFlowStore } from '../state/store';
import { IconTrash } from './icons';

export type FlowCanvasNode = Node<{ node: FlowNode; readOnly?: boolean }, 'flow'>;

export type NodeSide = 'left' | 'right' | 'top' | 'bottom';

/** Every node exposes a source and a target handle on each side. */
export const NODE_SIDES: { side: NodeSide; position: Position }[] = [
  { side: 'left', position: Position.Left },
  { side: 'right', position: Position.Right },
  { side: 'top', position: Position.Top },
  { side: 'bottom', position: Position.Bottom },
];

export function FlowNodeCard({ data, selected, isConnectable }: NodeProps<FlowCanvasNode>) {
  const node = data.node;
  const readOnly = data.readOnly === true;
  const hasDocs = Object.values(node.details).some((value) => value.trim().length > 0);
  const openDialog = useFlowStore((state) => state.openDialog);
  const isRoot = useFlowStore((state) => {
    const project = state.projects.find(
      (candidate) => candidate.id === state.activeProjectId,
    );
    return project?.nodes.find((candidate) => candidate.parentId === null)?.id === node.id;
  });

  return (
    <div
      className={`node-card node-card-${node.type}${selected ? ' is-selected' : ''}${
        readOnly ? ' is-readonly' : ''
      }${!readOnly && !isRoot ? ' has-delete' : ''}`}
    >
      {NODE_SIDES.map(({ side, position }) => (
        <Handle
          key={`${side}-target`}
          id={`${side}-target`}
          type="target"
          position={position}
          isConnectable={isConnectable && !readOnly}
          className={`node-handle node-handle-target node-handle-${side}`}
        />
      ))}
      <div className="node-card-head">
        <span className={`type-dot type-dot-${node.type}`} aria-hidden />
        <span className="node-type">{NODE_TYPE_LABELS[node.type]}</span>
        {hasDocs && (
          <span className="docs-badge" title="This node has documentation">
            ●
          </span>
        )}
      </div>
      <div className="node-title">{node.title}</div>
      {node.description.trim().length > 0 && (
        <div className="node-description">{node.description}</div>
      )}
      {node.images.length > 0 && (
        <div className="node-image" aria-label={`${node.images.length} image(s)`}>
          <img src={node.images[0].dataUrl} alt="" draggable={false} />
          {node.images.length > 1 && (
            <span className="node-image-count">+{node.images.length - 1}</span>
          )}
        </div>
      )}
      {!readOnly && !isRoot && (
        <button
          type="button"
          className="nodrag nopan node-delete"
          title="Delete node"
          aria-label={`Delete node ${node.title}`}
          onClick={(event) => {
            event.stopPropagation();
            openDialog({ kind: 'delete-node', id: node.id });
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <IconTrash size={12} />
        </button>
      )}
      {NODE_SIDES.map(({ side, position }) => (
        <Handle
          key={`${side}-source`}
          id={`${side}-source`}
          type="source"
          position={position}
          isConnectable={isConnectable && !readOnly}
          className={`node-handle node-handle-source node-handle-${side}`}
        />
      ))}
    </div>
  );
}
