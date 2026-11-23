import { useEffect, useMemo, useRef, useState } from 'react';
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
import { countLinks, NODE_CARD_WIDTH } from '../core/graph';
import { CONNECTION_TYPE_LABELS, MAX_IMAGES_PER_NODE } from '../core/types';
import { useActiveProject, useFlowStore } from '../state/store';
import type { MapView } from '../state/store';
import { BoardView } from './views/BoardView';
import { DocsView } from './views/DocsView';
import { TableView } from './views/TableView';
import { filesToNodeImages } from './imageFiles';
import { facingHandles, NODE_COLORS } from './canvasPresentation';
import { FlowConnectionEdge } from './FlowConnectionEdge';
import { FlowNodeCard } from './FlowNodeCard';
import type { FlowCanvasNode } from './FlowNodeCard';
import { IconPlus, IconUpload } from './icons';

const MAP_VIEWS: { id: MapView; label: string }[] = [
  { id: 'canvas', label: 'Canvas' },
  { id: 'table', label: 'Table' },
  { id: 'board', label: 'Board' },
  { id: 'docs', label: 'Docs' },
];

const nodeTypes = { flow: FlowNodeCard } as unknown as NodeTypes;
const edgeTypes = { connection: FlowConnectionEdge } as unknown as EdgeTypes;

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
  const deleteConnection = useFlowStore((state) => state.deleteConnection);
  const connect = useFlowStore((state) => state.connect);
  const openConnectionMenu = useFlowStore((state) => state.openConnectionMenu);
  const previewNodePosition = useFlowStore((state) => state.previewNodePosition);
  const commitNodePosition = useFlowStore((state) => state.commitNodePosition);
  const openDialog = useFlowStore((state) => state.openDialog);
  const importBackup = useFlowStore((state) => state.importBackup);
  const notify = useFlowStore((state) => state.notify);

  const view = useFlowStore((state) => state.view);
  const setView = useFlowStore((state) => state.setView);
  const theme = useFlowStore((state) => state.theme);
  const addImage = useFlowStore((state) => state.addImage);
  const createNodeWithImages = useFlowStore((state) => state.createNodeWithImages);

  const { setCenter, screenToFlowPosition } = useReactFlow();
  const lastFocusNonce = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dropActive, setDropActive] = useState(false);
  const dragDepth = useRef(0);

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDropActive(false);
    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
      file.type.startsWith('image/'),
    );
    if (files.length === 0) {
      notify('Drop image files to attach them to a node.', 'error');
      return;
    }

    // Dropping onto a node attaches there; empty canvas creates a new node.
    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest('.react-flow__node');
    const nodeId = target?.getAttribute('data-id') ?? null;

    const { images, skipped } = await filesToNodeImages(files);
    if (skipped.length > 0) notify(skipped.join('. '), 'error');
    if (images.length === 0) return;

    if (nodeId) {
      const project = useFlowStore.getState().projects.find(
        (candidate) => candidate.id === useFlowStore.getState().activeProjectId,
      );
      const node = project?.nodes.find((candidate) => candidate.id === nodeId);
      const room = Math.max(0, MAX_IMAGES_PER_NODE - (node?.images.length ?? 0));
      if (room === 0) {
        notify(`A node holds at most ${MAX_IMAGES_PER_NODE} images.`, 'error');
        return;
      }
      for (const image of images.slice(0, room)) addImage(nodeId, image);
      if (images.length > room) {
        notify(`A node holds at most ${MAX_IMAGES_PER_NODE} images.`, 'error');
      }
      return;
    }

    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    createNodeWithImages(position, images);
  };

  const nodes = useMemo<FlowCanvasNode[]>(() => {
    if (!project) return [];
    return project.nodes.map((node) => ({
      id: node.id,
      type: 'flow' as const,
      position: node.position,
      data: { node },
      selected: node.id === selectedNodeId,
      // Node deletion is confirmed through the dialog, never by a stray key.
      deletable: false,
    }));
  }, [project, selectedNodeId]);

  const edges = useMemo<Edge[]>(() => {
    if (!project) return [];
    const nodeIds = new Set(project.nodes.map((node) => node.id));
    const positions = new Map(project.nodes.map((node) => [node.id, node.position]));
    const list: Edge[] = [];

    // Hierarchy is shown in the project tree, not on the canvas. Only explicit
    // graph connections are drawn as wires, so deleting a wire can never remove
    // a node or change the hierarchy.
    for (const connection of project.connections) {
      if (!nodeIds.has(connection.source) || !nodeIds.has(connection.target)) continue;
      const label =
        connection.label.trim() ||
        (connection.type ? CONNECTION_TYPE_LABELS[connection.type] : '');
      const isSelected = connection.id === selectedConnectionId;
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
        data: { connectionId: connection.id },
        selectable: true,
        deletable: true,
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
              data-guide="new-project-canvas"
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
        <div className="canvas-header-tools">
          <div className="view-switch" role="tablist" aria-label="Project view">
            {MAP_VIEWS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={view === entry.id}
                className={view === entry.id ? 'is-active' : undefined}
                onClick={() => setView(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div className="canvas-counts">
            <span>
              {project.nodes.length} node{project.nodes.length === 1 ? '' : 's'}
            </span>
            <span className="dot-sep" aria-hidden>
              ·
            </span>
            <span>
              {countLinks(project)} link{countLinks(project) === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </header>

      {view === 'table' && <TableView />}
      {view === 'board' && <BoardView />}
      {view === 'docs' && <DocsView />}

      {view === 'canvas' && (
      <div
        className={`canvas-surface${dropActive ? ' is-drop-target' : ''}`}
        data-guide="canvas"
        onDragEnter={(event) => {
          if (!event.dataTransfer?.types.includes('Files')) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDropActive(true);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer?.types.includes('Files')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDropActive(false);
        }}
        onDrop={(event) => void handleDrop(event)}
      >
        {dropActive && (
          <div className="drop-hint" aria-hidden>
            <span>Drop onto a node to attach, or on empty canvas to create one</span>
          </div>
        )}
        <ReactFlow
          key={project.id}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
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
          onEdgesDelete={(deleted) => {
            for (const edge of deleted) {
              if (edge.id.startsWith('c-')) deleteConnection(edge.id.slice(2));
            }
          }}
          onPaneClick={() => selectNode(null)}
          onConnect={(connection) => {
            if (!connection.source || !connection.target) return;
            connect(connection.source, connection.target);
          }}
          onConnectEnd={(event, connectionState) => {
            // Released on empty canvas: offer to create a connected node there.
            if (!connectionState.fromNode || connectionState.toNode) return;
            const handleType = connectionState.fromHandle?.type;
            if (handleType !== 'source' && handleType !== 'target') return;
            const client =
              'clientX' in event
                ? { x: event.clientX, y: event.clientY }
                : event.changedTouches.length > 0
                  ? {
                      x: event.changedTouches[0].clientX,
                      y: event.changedTouches[0].clientY,
                    }
                  : null;
            if (!client) return;
            const flow = screenToFlowPosition(client);
            openConnectionMenu({
              sourceId: connectionState.fromNode.id,
              handleType,
              screenX: client.x,
              screenY: client.y,
              flowX: flow.x,
              flowY: flow.y,
            });
          }}
          fitView
          fitViewOptions={{ padding: 32, maxZoom: 1, minZoom: 0.25 }}
          minZoom={0.25}
          maxZoom={1.75}
          deleteKeyCode={['Delete', 'Backspace']}
          defaultEdgeOptions={{ type: 'default' }}
          connectionLineType={ConnectionLineType.Bezier}
          connectionLineStyle={{ stroke: '#2563eb', strokeWidth: 1.6 }}
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
            maskColor={theme === 'dark' ? 'rgba(24, 24, 27, 0.72)' : 'rgba(244, 244, 246, 0.7)'}
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
      )}
    </main>
  );
}
