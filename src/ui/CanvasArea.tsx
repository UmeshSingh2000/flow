import { useEffect, useMemo, useRef } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
} from '@xyflow/react';
import type { Edge, NodeTypes } from '@xyflow/react';
import { countLinks, NODE_CARD_WIDTH } from '../core/graph';
import { CONNECTION_TYPE_LABELS } from '../core/types';
import type { NodeType } from '../core/types';
import { useActiveProject, useFlowStore } from '../state/store';
import { FlowNodeCard } from './FlowNodeCard';
import type { FlowCanvasNode } from './FlowNodeCard';
import { IconPlus, IconUpload } from './icons';

const NODE_COLORS: Record<NodeType, string> = {
  project: '#4f46e5',
  module: '#7c3aed',
  feature: '#2563eb',
  'sub-feature': '#0891b2',
  process: '#d97706',
  decision: '#db2777',
};

const nodeTypes = { flow: FlowNodeCard } as unknown as NodeTypes;

/**
 * React Flow can only fit the graph after custom nodes have been measured.
 * Running fitView on initialization as well as on `onInit` avoids a viewport
 * that is stuck at 100% and clips the right-hand column.
 */
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

export function CanvasArea() {
  const project = useActiveProject();
  const selectedNodeId = useFlowStore((state) => state.selectedNodeId);
  const selectedConnectionId = useFlowStore((state) => state.selectedConnectionId);
  const focusRequest = useFlowStore((state) => state.focusRequest);

  const selectNode = useFlowStore((state) => state.selectNode);
  const selectConnection = useFlowStore((state) => state.selectConnection);
  const connect = useFlowStore((state) => state.connect);
  const previewNodePosition = useFlowStore((state) => state.previewNodePosition);
  const commitNodePosition = useFlowStore((state) => state.commitNodePosition);
  const openDialog = useFlowStore((state) => state.openDialog);
  const importBackup = useFlowStore((state) => state.importBackup);
  const notify = useFlowStore((state) => state.notify);

  const { setCenter } = useReactFlow();
  const lastFocusNonce = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const nodes = useMemo<FlowCanvasNode[]>(() => {
    if (!project) return [];
    return project.nodes.map((node) => ({
      id: node.id,
      type: 'flow' as const,
      position: node.position,
      data: { node },
      selected: node.id === selectedNodeId,
    }));
  }, [project, selectedNodeId]);

  const edges = useMemo<Edge[]>(() => {
    if (!project) return [];
    const nodeIds = new Set(project.nodes.map((node) => node.id));
    const list: Edge[] = [];

    for (const node of project.nodes) {
      if (!node.parentId || !nodeIds.has(node.parentId)) continue;
      list.push({
        id: `h-${node.id}`,
        source: node.parentId,
        target: node.id,
        type: 'smoothstep',
        selectable: false,
        deletable: false,
        focusable: false,
        className: 'edge-hierarchy',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 12,
          height: 12,
          color: '#cbd5e1',
        },
      });
    }

    for (const connection of project.connections) {
      if (!nodeIds.has(connection.source) || !nodeIds.has(connection.target)) continue;
      const label =
        connection.label.trim() ||
        (connection.type ? CONNECTION_TYPE_LABELS[connection.type] : '');
      const isSelected = connection.id === selectedConnectionId;
      list.push({
        id: `c-${connection.id}`,
        source: connection.source,
        target: connection.target,
        type: 'smoothstep',
        selectable: true,
        deletable: false,
        selected: isSelected,
        className: `edge-connection${isSelected ? ' is-selected' : ''}`,
        label: label || undefined,
        labelStyle: { fontSize: 10.5, fill: '#475569', fontWeight: 500 },
        labelBgStyle: { fill: '#ffffff', fillOpacity: 0.94 },
        labelBgPadding: [5, 3],
        labelBgBorderRadius: 4,
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
    if (!project || !focusRequest) return;
    if (focusRequest.nonce === lastFocusNonce.current) return;
    const node = project.nodes.find((candidate) => candidate.id === focusRequest.nodeId);
    if (!node) return;
    lastFocusNonce.current = focusRequest.nonce;
    setCenter(node.position.x + NODE_CARD_WIDTH / 2, node.position.y + 40, {
      zoom: 1,
      duration: 450,
    });
  }, [focusRequest, project, setCenter]);

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

  if (!project) {
    return (
      <main className="canvas-area">
        <div className="canvas-empty">
          <div className="empty-art" aria-hidden>
            ◇
          </div>
          <h1>No project open</h1>
          <p>Create a local project or import a backup to start mapping your software.</p>
          <div className="empty-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openDialog({ kind: 'new-project' })}
            >
              <IconPlus size={14} /> New project
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <IconUpload size={14} /> Import backup
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="canvas-area">
      <header className="canvas-header">
        <div>
          <div className="eyebrow">PROJECT MAP</div>
          <h1>{project.name}</h1>
        </div>
        <div className="canvas-counts">
          <span>
            {project.nodes.length} node{project.nodes.length === 1 ? '' : 's'}
          </span>
          <span className="dot-sep" aria-hidden>
            ·
          </span>
          <span>{countLinks(project)} links</span>
        </div>
      </header>

      <div className="canvas-surface">
        <ReactFlow
          key={project.id}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={(changes) => {
            for (const change of changes) {
              if (change.type === 'position' && change.position) {
                if (change.dragging) {
                  previewNodePosition(change.id, change.position);
                } else {
                  commitNodePosition(change.id, change.position);
                }
              }
            }
          }}
          onNodeDragStop={(_event, node) => {
            commitNodePosition(node.id, node.position);
          }}
          onNodeClick={(_event, node) => {
            selectNode(node.id);
          }}
          onEdgeClick={(_event, edge) => {
            if (edge.id.startsWith('c-')) selectConnection(edge.id.slice(2));
          }}
          onEdgesChange={(changes) => {
            for (const change of changes) {
              if (
                change.type === 'select' &&
                change.selected &&
                change.id.startsWith('c-')
              ) {
                selectConnection(change.id.slice(2));
              }
            }
          }}
          onPaneClick={() => selectNode(null)}
          onConnect={(connection) => {
            if (!connection.source || !connection.target) return;
            connect(connection.source, connection.target);
          }}
          fitView
          fitViewOptions={{ padding: 32, maxZoom: 1, minZoom: 0.25 }}
          minZoom={0.25}
          maxZoom={1.75}
          deleteKeyCode={null}
          defaultEdgeOptions={{ type: 'smoothstep' }}
          connectionLineStyle={{ stroke: '#2563eb', strokeWidth: 1.6 }}
          className="flow-canvas"
        >
          <InitialFit />
          <Background
            variant={BackgroundVariant.Dots}
            gap={18}
            size={1.2}
            color="#d4d4da"
          />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor={(node: FlowCanvasNode) => NODE_COLORS[node.data.node.type]}
            nodeStrokeWidth={0}
            nodeBorderRadius={3}
            maskColor="rgba(244, 244, 246, 0.7)"
            style={{
              width: 140,
              height: 96,
              marginBottom: 14,
              background: '#ffffff',
              border: '1px solid #e4e4e7',
            }}
          />
        </ReactFlow>
      </div>
    </main>
  );
}
