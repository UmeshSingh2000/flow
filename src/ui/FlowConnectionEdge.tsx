import { useEffect, useRef, useState } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';
import type { Edge, EdgeProps } from '@xyflow/react';
import { useFlowStore } from '../state/store';
import { IconX } from './icons';

export type FlowConnectionEdgeType = Edge<
  { connectionId: string; readOnly?: boolean },
  'connection'
>;

/**
 * A graph connection. Hovering the line (or its label) reveals a disconnect
 * button at the midpoint so an edge can be removed without hunting through the
 * properties panel. The button stays visible while the edge is selected, so it
 * can also be reached by clicking the line first.
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
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deleteConnection = useFlowStore((state) => state.deleteConnection);

  const cancelHide = () => {
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  // Give the pointer time to travel from the thin line onto the button.
  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null;
      setHoveringLine(false);
      setHoveringTools(false);
    }, 220);
  };

  useEffect(() => cancelHide, []);

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
  const readOnly = data?.readOnly === true;

  return (
    <>
      <g
        onMouseEnter={() => {
          cancelHide();
          setHoveringLine(true);
        }}
        onMouseLeave={scheduleHide}
      >
        <BaseEdge
          id={id}
          path={path}
          markerEnd={markerEnd}
          style={style}
          interactionWidth={32}
        />
      </g>

      <EdgeLabelRenderer>
        {readOnly ? (
          label ? (
            <div
              className="edge-label edge-label-static"
              style={{
                position: 'absolute',
                pointerEvents: 'none',
                transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              }}
            >
              {label}
            </div>
          ) : null
        ) : (
          <div
            className={`edge-tools${visible ? ' is-visible' : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onMouseEnter={() => {
              cancelHide();
              setHoveringTools(true);
            }}
            onMouseLeave={scheduleHide}
          >
            <button
              type="button"
              className="nodrag nopan edge-disconnect"
              title="Disconnect — or press Delete"
              aria-label="Disconnect these nodes"
              tabIndex={visible ? 0 : -1}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                if (connectionId) deleteConnection(connectionId);
              }}
            >
              <IconX size={12} />
            </button>
            {label ? <span className="edge-label">{label}</span> : null}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
