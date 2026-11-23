import { useEffect, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
} from '@xyflow/react';
import type { Edge, EdgeTypes, NodeTypes } from '@xyflow/react';
import { NODE_CARD_WIDTH } from '../core/graph';
import { CONNECTION_TYPE_LABELS } from '../core/types';
import type { Project } from '../core/types';
import type { Theme } from '../state/store';
import { facingHandles, NODE_COLORS } from './canvasPresentation';
import { FlowConnectionEdge } from './FlowConnectionEdge';
import { FlowNodeCard } from './FlowNodeCard';
import type { FlowCanvasNode } from './FlowNodeCard';

const nodeTypes = { flow: FlowNodeCard } as unknown as NodeTypes;
const edgeTypes = { connection: FlowConnectionEdge } as unknown as EdgeTypes;

function InitialFit() {
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const fitted = useRef(false);

  useEffect(() => {
    if (!initialized || fitted.current) return;
    fitted.current = true;
    void fitView({ padding: 32, maxZoom: 1 });
  }, [initialized, fitView]);

  return null;
}

export function SharedCanvas({
  project,
  selectedNodeId,
  selectedConnectionId,
  onSelectNode,
  onSelectConnection,
  focusRequest,
  theme,
}: {
  project: Project;
  selectedNodeId: string | null;
  selectedConnectionId: string | null;
  onSelectNode(nodeId: string | null): void;
  onSelectConnection(connectionId: string | null): void;
  focusRequest: { nodeId: string; nonce: number } | null;
  theme: Theme;
}) {
  const { setCenter } = useReactFlow();
  const lastFocusNonce = useRef(0);

  const nodes = useMemo<FlowCanvasNode[]>(
    () =>
      project.nodes.map((node) => ({
        id: node.id,
        type: 'flow' as const,
        position: node.position,
        data: { node, readOnly: true },
        selected: node.id === selectedNodeId,
        draggable: false,
        connectable: false,
        deletable: false,
      })),
    [project, selectedNodeId],
  );

  const edges = useMemo<Edge[]>(() => {
    const nodeIds = new Set(project.nodes.map((node) => node.id));
    const positions = new Map(project.nodes.map((node) => [node.id, node.position]));
    const list: Edge[] = [];

    for (const connection of project.connections) {
      if (!nodeIds.has(connection.source) || !nodeIds.has(connection.target)) continue;
      const isSelected = connection.id === selectedConnectionId;
      const label =
        connection.label.trim() ||
        (connection.type ? CONNECTION_TYPE_LABELS[connection.type] : '');
      const handles = facingHandles(
        positions.get(connection.source),
        positions.get(connection.target),
      );
      list.push({
        id: `c-${connection.id}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: handles.source,
        targetHandle: handles.target,
        type: 'connection',
        data: { connectionId: connection.id, readOnly: true },
        selectable: true,
        deletable: false,
        selected: isSelected,
        className: `edge-connection${isSelected ? ' is-selected' : ''}`,
        label: label || undefined,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 16,
          height: 16,
          color: isSelected ? '#1d4ed8' : '#2563eb',
        },
      });
    }

    return list;
  }, [project, selectedConnectionId]);

  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.nonce === lastFocusNonce.current) return;
    const node = project.nodes.find(
      (candidate) => candidate.id === focusRequest.nodeId,
    );
    if (!node) return;
    lastFocusNonce.current = focusRequest.nonce;
    void setCenter(node.position.x + NODE_CARD_WIDTH / 2, node.position.y + 40, {
      zoom: 1,
      duration: 450,
    });
  }, [focusRequest, project, setCenter]);

  return (
    <div className="canvas-surface shared-canvas-surface">
      <ReactFlow
        key={project.id}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        onNodeClick={(_event, node) => onSelectNode(node.id)}
        onEdgeClick={(_event, edge) => {
          if (edge.id.startsWith('c-')) onSelectConnection(edge.id.slice(2));
        }}
        onPaneClick={() => {
          onSelectNode(null);
          onSelectConnection(null);
        }}
        fitView
        fitViewOptions={{ padding: 32, maxZoom: 1, minZoom: 0.25 }}
        minZoom={0.25}
        maxZoom={1.75}
        defaultEdgeOptions={{ type: 'default' }}
        connectionLineType={ConnectionLineType.Bezier}
        className="flow-canvas"
      >
        <InitialFit />
        <Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1.2}
          color={theme === 'dark' ? '#3f3f46' : '#d4d4da'}
        />
        <Controls position="bottom-left" showInteractive={false} />
        <MiniMap
          position="bottom-right"
          pannable
          zoomable
          nodeColor={(node: FlowCanvasNode) => NODE_COLORS[node.data.node.type]}
          nodeStrokeWidth={0}
          nodeBorderRadius={3}
          maskColor={
            theme === 'dark' ? 'rgba(24, 24, 27, 0.72)' : 'rgba(244, 244, 246, 0.7)'
          }
          style={{
            width: 140,
            height: 96,
            marginBottom: 14,
            background: theme === 'dark' ? '#202024' : '#ffffff',
            border: theme === 'dark' ? '1px solid #34343a' : '1px solid #e4e4e7',
          }}
        />
      </ReactFlow>
    </div>
  );
}
