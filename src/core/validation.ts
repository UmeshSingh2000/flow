/**
 * Backup parsing and validation (FR-DATA-05/06, FR-UTIL-03).
 *
 * Imports are untrusted input: every reference is checked, malformed values
 * are rejected with a readable error instead of being partially applied, and
 * unknown future schema versions are refused rather than silently guessed.
 */

import { CONNECTION_TYPES, DETAIL_FIELDS, NODE_TYPES } from './types';
import type {
  ConnectionType,
  FlowConnection,
  FlowNode,
  NodeDetails,
  NodeType,
  Project,
} from './types';

export const SCHEMA_VERSION = 1;
export const BACKUP_FORMAT = 'flow-backup';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  projects: Project[];
}

export type BackupValidation =
  | { ok: true; projects: Project[] }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function emptyDetails(): NodeDetails {
  const details = {} as NodeDetails;
  for (const { key } of DETAIL_FIELDS) details[key] = '';
  return details;
}

function normalizeDetails(raw: unknown): NodeDetails {
  const details = emptyDetails();
  if (!isRecord(raw)) return details;
  for (const { key } of DETAIL_FIELDS) {
    details[key] = asString(raw[key]);
  }
  return details;
}

function isNodeType(value: unknown): value is NodeType {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).includes(value);
}

function isConnectionType(value: unknown): value is ConnectionType {
  return typeof value === 'string' && (CONNECTION_TYPES as readonly string[]).includes(value);
}

/** Builds a versioned, portable backup object (ARCH-05). */
export function buildBackup(projects: Project[]): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    projects,
  };
}

export function parseBackup(text: string): BackupValidation {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['The file is not valid JSON.'] };
  }
  return validateBackup(raw);
}

export function validateBackup(raw: unknown): BackupValidation {
  const errors: string[] = [];
  const add = (message: string) => {
    if (errors.length < 25) errors.push(message);
  };

  if (!isRecord(raw)) {
    return { ok: false, errors: ['The backup must be a JSON object.'] };
  }
  if (raw.format !== BACKUP_FORMAT) {
    add(`Unrecognized backup: expected "format": "${BACKUP_FORMAT}".`);
  }
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    add('The backup is missing a valid schema version.');
  } else if (raw.version > SCHEMA_VERSION) {
    add(
      `This backup uses schema version ${raw.version}, but this app supports up to version ${SCHEMA_VERSION}. Update the app before importing.`,
    );
  }

  const projectsRaw = raw.projects;
  if (!Array.isArray(projectsRaw) || projectsRaw.length === 0) {
    add('The backup contains no projects.');
    return { ok: false, errors };
  }

  const projects: Project[] = [];
  const seenProjectIds = new Set<string>();

  projectsRaw.forEach((projectRaw, projectIndex) => {
    const label = `Project ${projectIndex + 1}`;
    if (!isRecord(projectRaw)) {
      add(`${label} is not an object.`);
      return;
    }

    const projectId =
      typeof projectRaw.id === 'string' && projectRaw.id.trim() ? projectRaw.id : '';
    if (!projectId) add(`${label} is missing an id.`);
    else if (seenProjectIds.has(projectId)) add(`${label} reuses project id "${projectId}".`);
    else seenProjectIds.add(projectId);

    const projectName =
      typeof projectRaw.name === 'string' ? projectRaw.name.trim() : '';
    if (!projectName) add(`${label} is missing a name.`);

    const nodesRaw = projectRaw.nodes;
    const connectionsRaw = projectRaw.connections;
    if (!Array.isArray(nodesRaw)) add(`${label} has no nodes array.`);
    if (!Array.isArray(connectionsRaw)) add(`${label} has no connections array.`);
    if (!Array.isArray(nodesRaw) || !Array.isArray(connectionsRaw)) return;

    const nodeIds = new Set<string>();
    const nodes: FlowNode[] = [];

    nodesRaw.forEach((nodeRaw, nodeIndex) => {
      const nodeLabel = `${label}, node ${nodeIndex + 1}`;
      if (!isRecord(nodeRaw)) {
        add(`${nodeLabel} is not an object.`);
        return;
      }
      const nodeId =
        typeof nodeRaw.id === 'string' && nodeRaw.id.trim() ? nodeRaw.id : '';
      if (!nodeId) add(`${nodeLabel} is missing an id.`);
      else if (nodeIds.has(nodeId)) add(`${nodeLabel} reuses node id "${nodeId}".`);
      else nodeIds.add(nodeId);

      const type = isNodeType(nodeRaw.type) ? nodeRaw.type : null;
      if (!type) add(`${nodeLabel} has an unknown type "${String(nodeRaw.type)}".`);

      const title = typeof nodeRaw.title === 'string' ? nodeRaw.title.trim() : '';
      if (!title) add(`${nodeLabel} is missing a title.`);

      let parentId: string | null = null;
      if (nodeRaw.parentId === null || nodeRaw.parentId === undefined) {
        parentId = null;
      } else if (typeof nodeRaw.parentId === 'string') {
        parentId = nodeRaw.parentId;
      } else {
        add(`${nodeLabel} has an invalid parent reference.`);
      }

      const positionRaw = nodeRaw.position;
      const position =
        isRecord(positionRaw) && isFiniteNumber(positionRaw.x) && isFiniteNumber(positionRaw.y)
          ? { x: positionRaw.x, y: positionRaw.y }
          : null;
      if (!position) add(`${nodeLabel} has invalid canvas coordinates.`);

      if (nodeId && type && title && position) {
        nodes.push({
          id: nodeId,
          projectId: projectId || 'unknown',
          parentId,
          type,
          title,
          description: asString(nodeRaw.description),
          details: normalizeDetails(nodeRaw.details),
          position,
          createdAt: asString(nodeRaw.createdAt, new Date().toISOString()),
          updatedAt: asString(nodeRaw.updatedAt, new Date().toISOString()),
        });
      }
    });

    const parentById = new Map(nodes.map((node) => [node.id, node.parentId]));
    for (const node of nodes) {
      if (node.parentId !== null && !nodeIds.has(node.parentId)) {
        add(`${label}: node "${node.title}" references a missing parent.`);
      }
      if (node.parentId === node.id) {
        add(`${label}: node "${node.title}" is its own parent.`);
        continue;
      }
      const visited = new Set<string>([node.id]);
      let cursor = node.parentId;
      while (cursor) {
        if (visited.has(cursor)) {
          add(`${label}: hierarchy cycle detected around node "${node.title}".`);
          break;
        }
        visited.add(cursor);
        cursor = parentById.get(cursor) ?? null;
      }
    }

    const connectionIds = new Set<string>();
    const connectionPairs = new Set<string>();
    const connections: FlowConnection[] = [];

    connectionsRaw.forEach((connectionRaw, connectionIndex) => {
      const connectionLabel = `${label}, connection ${connectionIndex + 1}`;
      if (!isRecord(connectionRaw)) {
        add(`${connectionLabel} is not an object.`);
        return;
      }
      const connectionId =
        typeof connectionRaw.id === 'string' && connectionRaw.id.trim()
          ? connectionRaw.id
          : '';
      if (!connectionId) add(`${connectionLabel} is missing an id.`);
      else if (connectionIds.has(connectionId))
        add(`${connectionLabel} reuses connection id "${connectionId}".`);
      else connectionIds.add(connectionId);

      const source = typeof connectionRaw.source === 'string' ? connectionRaw.source : '';
      const target = typeof connectionRaw.target === 'string' ? connectionRaw.target : '';
      if (!nodeIds.has(source)) add(`${connectionLabel} starts at a missing node.`);
      if (!nodeIds.has(target)) add(`${connectionLabel} ends at a missing node.`);
      if (source && source === target) add(`${connectionLabel} connects a node to itself.`);
      const pair = `${source}->${target}`;
      if (connectionPairs.has(pair)) add(`${connectionLabel} duplicates an existing connection.`);
      connectionPairs.add(pair);

      let type: ConnectionType | null = null;
      if (connectionRaw.type === null || connectionRaw.type === undefined) type = null;
      else if (isConnectionType(connectionRaw.type)) type = connectionRaw.type;
      else add(`${connectionLabel} has an unknown relationship type.`);

      const valid = Boolean(connectionId && source && target && source !== target);
      if (!valid) return;

      connections.push({
        id: connectionId,
        projectId: projectId || 'unknown',
        source,
        target,
        type,
        label: asString(connectionRaw.label),
        createdAt: asString(connectionRaw.createdAt, new Date().toISOString()),
        updatedAt: asString(connectionRaw.updatedAt, new Date().toISOString()),
      });
    });

    if (projectId && projectName) {
      projects.push({
        id: projectId,
        name: projectName,
        description: asString(projectRaw.description),
        createdAt: asString(projectRaw.createdAt, new Date().toISOString()),
        updatedAt: asString(projectRaw.updatedAt, new Date().toISOString()),
        nodes,
        connections,
      });
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, projects };
}
