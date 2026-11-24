/**
 * Backup parsing and validation (FR-DATA-05/06, FR-UTIL-03).
 *
 * Imports are untrusted input: every reference is checked, malformed values
 * are rejected with a readable error instead of being partially applied, and
 * unknown future schema versions are refused rather than silently guessed.
 */

import {
  CONNECTION_TYPES,
  DETAIL_FIELDS,
  MAX_IMAGE_DATA_URL_LENGTH,
  MAX_IMAGES_PER_NODE,
  NODE_TYPES,
  ROOT_REF,
} from './types';
import type {
  ConnectionType,
  FlowConnection,
  FlowNode,
  NodeDetails,
  NodeImage,
  NodeProvenance,
  NodeType,
  Project,
} from './types';

const MAX_EXTERNAL_KEY_LENGTH = 300;
const MAX_PROVENANCE_FILES = 100;
const MAX_PROVENANCE_FILE_LENGTH = 500;

/**
 * v2 added the optional `markdown` field, v3 the `images` array, and v4 the
 * optional `externalKey` and `provenance` fields used by terminal/MCP sync.
 * Older backups still import: missing fields are normalized rather than
 * rejected, so v1/v2/v3 files keep working.
 */
export const SCHEMA_VERSION = 4;
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

const DATA_IMAGE_PREFIX = 'data:image/';

/** Validates attached images; anything unusable is reported, never stored. */
function normalizeImages(
  raw: unknown,
  label: string,
  add: (message: string) => void,
): NodeImage[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    add(`${label} has an invalid images list.`);
    return [];
  }
  const images: NodeImage[] = [];
  raw.forEach((entry, index) => {
    const imageLabel = `${label}, image ${index + 1}`;
    if (!isRecord(entry)) {
      add(`${imageLabel} is not an object.`);
      return;
    }
    const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id : '';
    const dataUrl = typeof entry.dataUrl === 'string' ? entry.dataUrl : '';
    if (!id) add(`${imageLabel} is missing an id.`);
    if (!dataUrl.startsWith(DATA_IMAGE_PREFIX)) {
      add(`${imageLabel} is not an embedded image.`);
    } else if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      add(`${imageLabel} is too large to import.`);
    }
    if (!id || !dataUrl.startsWith(DATA_IMAGE_PREFIX)) return;
    images.push({
      id,
      name: asString(entry.name, 'image'),
      dataUrl,
      width: isFiniteNumber(entry.width) ? entry.width : 0,
      height: isFiniteNumber(entry.height) ? entry.height : 0,
      addedAt: asString(entry.addedAt, new Date().toISOString()),
    });
  });
  if (images.length > MAX_IMAGES_PER_NODE) {
    add(`${label} has more than ${MAX_IMAGES_PER_NODE} images.`);
  }
  return images;
}

/** Optional stable identity used by terminal/MCP sync. */
function normalizeExternalKey(
  raw: unknown,
  label: string,
  add: (message: string) => void,
): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') {
    add(`${label} has an invalid external key.`);
    return undefined;
  }
  const key = raw.trim();
  if (!key) return undefined;
  if (key.length > MAX_EXTERNAL_KEY_LENGTH) {
    add(`${label} has an external key longer than ${MAX_EXTERNAL_KEY_LENGTH} characters.`);
    return undefined;
  }
  if (/[\u0000-\u001f\u007f]/.test(key)) {
    add(`${label} has an external key containing control characters.`);
    return undefined;
  }
  if (key === ROOT_REF) {
    add(`${label} uses the reserved external key "${ROOT_REF}".`);
    return undefined;
  }
  return key;
}

function normalizeProvenance(
  raw: unknown,
  label: string,
  add: (message: string) => void,
): NodeProvenance | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    add(`${label} has invalid generation provenance.`);
    return undefined;
  }
  const tool = typeof raw.tool === 'string' ? raw.tool.trim() : '';
  const at = typeof raw.at === 'string' ? raw.at.trim() : '';
  if (!tool) add(`${label} has generation provenance without a tool.`);
  if (!at) add(`${label} has generation provenance without a timestamp.`);

  let sourceFiles: string[] = [];
  if (raw.sourceFiles !== undefined) {
    if (!Array.isArray(raw.sourceFiles)) {
      add(`${label} has an invalid provenance file list.`);
    } else {
      sourceFiles = raw.sourceFiles
        .filter((file): file is string => typeof file === 'string')
        .map((file) => file.trim())
        .filter(Boolean)
        .slice(0, MAX_PROVENANCE_FILES)
        .map((file) => file.slice(0, MAX_PROVENANCE_FILE_LENGTH));
    }
  }

  const commit =
    typeof raw.commit === 'string' && raw.commit.trim()
      ? raw.commit.trim().slice(0, 200)
      : undefined;

  if (!tool || !at) return undefined;
  return { tool, at, sourceFiles, ...(commit ? { commit } : {}) };
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

      const externalKey = normalizeExternalKey(nodeRaw.externalKey, nodeLabel, add);
      const provenance = normalizeProvenance(nodeRaw.provenance, nodeLabel, add);

      if (nodeId && type && title && position) {
        nodes.push({
          id: nodeId,
          projectId: projectId || 'unknown',
          parentId,
          type,
          title,
          description: asString(nodeRaw.description),
          markdown: asString(nodeRaw.markdown),
          images: normalizeImages(nodeRaw.images, nodeLabel, add),
          details: normalizeDetails(nodeRaw.details),
          position,
          ...(externalKey ? { externalKey } : {}),
          ...(provenance ? { provenance } : {}),
          createdAt: asString(nodeRaw.createdAt, new Date().toISOString()),
          updatedAt: asString(nodeRaw.updatedAt, new Date().toISOString()),
        });
      }
    });

    // External keys must be unique and must not shadow a node id, otherwise
    // terminal/MCP references would resolve ambiguously.
    const externalKeys = new Set<string>();
    for (const node of nodes) {
      if (!node.externalKey) continue;
      if (externalKeys.has(node.externalKey)) {
        add(`${label}: external key "${node.externalKey}" is used by more than one node.`);
      }
      if (nodeIds.has(node.externalKey)) {
        add(
          `${label}: external key "${node.externalKey}" collides with a node id.`,
        );
      }
      externalKeys.add(node.externalKey);
    }

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
