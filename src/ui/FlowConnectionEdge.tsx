import { useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import type { Edge, EdgeProps } from '@xyflow/react';
import { useFlowStore } from '../state/store';
import { IconX } from './icons';

export type FlowConnectionEdgeType = Edge<{ connectionId: string }, 'connection'>;

/**
 * A graph connection. Hovering the line (or its label) reveals a disconnect
 * button at the midpoint so an edge can be removed without hunting through the
 * properties panel. Hierarchy edges use the built-in bezier edge instead.
 */
export function FlowConnectionEdge({
  id,
  data,
  label,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
}: EdgeProps<FlowConnectionEdgeType>) {
  const [hoveringLine, setHoveringLine] = useState(false);
  const [hoveringTools, setHoveringTools] = useState(false);
  const deleteConnection = useFlowStore((state) => state.deleteConnection);

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature: 0.35,
  });

  const visible = hoveringLine || hoveringTools || Boolean(selected);
  const connectionId = data?.connectionId;

  return (
    <>
      <g
        onMouseEnter={() => setHoveringLine(true)}
        onMouseLeave={() => setHoveringLine(false)}
      >
        <BaseEdge
          id={id}
          path={path}
          markerEnd={markerEnd}
          style={style}
          interactionWidth={22}
        />
      </g>

      <EdgeLabelRenderer>
        <div
          className={`edge-tools${visible ? ' is-visible' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onMouseEnter={() => setHoveringTools(true)}
          onMouseLeave={() => setHoveringTools(false)}
        >
          <button
            type="button"
            className="nodrag nopan edge-disconnect"
            title="Disconnect"
            aria-label="Disconnect these nodes"
            onClick={(event) => {
              event.stopPropagation();
              if (connectionId) deleteConnection(connectionId);
            }}
          >
            <IconX size={9} />
          </button>
          {label ? <span className="edge-label">{label}</span> : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
