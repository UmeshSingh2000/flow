import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import { NODE_TYPE_LABELS } from '../core/types';
import type { FlowNode } from '../core/types';

export type FlowCanvasNode = Node<{ node: FlowNode }, 'flow'>;

export function FlowNodeCard({ data, selected, isConnectable }: NodeProps<FlowCanvasNode>) {
  const node = data.node;
  const hasDocs = Object.values(node.details).some((value) => value.trim().length > 0);

  return (
    <div className={`node-card node-card-${node.type}${selected ? ' is-selected' : ''}`}>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={isConnectable}
        className="node-handle node-handle-target"
      />
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
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={isConnectable}
        className="node-handle node-handle-source"
      />
    </div>
  );
}
