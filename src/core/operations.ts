/**
 * Plan-based write operations shared by the terminal CLI and MCP server.
 *
 * The input is untrusted: every operation is validated, references are
 * resolved against the project, and the plan is applied to an immutable copy.
 * Nothing is returned unless the whole plan is valid, so a failed apply leaves
 * the project untouched (atomic apply).
 */

import {
  addChildNode,
  createConnection,
  getNode,
  getRootNode,
  now,
  reparentNode as reparentInProject,
  updateConnection,
  updateNode as updateNodeInProject,
} from './graph';
import {
  CONNECTION_TYPES,
  DETAIL_FIELDS,
  NODE_TYPES,
  ROOT_REF,
} from './types';
import type {
  ConnectionType,
  DetailKey,
  FlowNode,
  NodeDetails,
  NodeProvenance,
  NodeType,
  Point,
  Project,
} from './types';

export const MAX_PLAN_OPERATIONS = 2000;
const MAX_KEY_LENGTH = 300;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 20_000;
const MAX_MARKDOWN_LENGTH = 500_000;
const MAX_LABEL_LENGTH = 200;
const MAX_SOURCE_FILES = 100;
const MAX_SOURCE_FILE_LENGTH = 500;
const MAX_TOOL_NAME_LENGTH = 100;

const DETAIL_KEYS = new Set<string>(DETAIL_FIELDS.map((field) => field.key));

/** Plan-level provenance applied to every node the plan touches. */
export interface PlanProvenance {
  tool: string;
  sourceFiles?: string[];
  commit?: string;
}

export interface ApplyPlanInput {
  ops: unknown;
  dryRun?: boolean;
  provenance?: unknown;
}

export type OperationAction = 'created' | 'updated' | 'unchanged';

export type OperationKind = 'upsert-node' | 'update-node' | 'reparent-node' | 'connect';

export interface OperationChange {
  op: number;
  operation: OperationKind;
  action: OperationAction;
  key?: string;
  nodeId?: string;
  title?: string;
}

export interface ApplyPlanSummary {
  created: number;
  updated: number;
  unchanged: number;
  /** New graph connections created by the plan. */
  connected: number;
}

export interface ApplyPlanResult {
  ok: boolean;
  dryRun: boolean;
  errors: string[];
  changes: OperationChange[];
  summary: ApplyPlanSummary;
  /** The simulated or applied project. Callers should not send it to the UI. */
  project?: Project;
}

type NormalizedOperation =
  | {
      kind: 'upsert-node';
      index: number;
      key: string;
      type: NodeType;
      title: string;
      parent: string | null | undefined;
      description?: string;
      markdown?: string;
      details?: Partial<NodeDetails>;
      position?: Point;
      sourceFiles?: string[];
    }
  | {
      kind: 'update-node';
      index: number;
      key: string;
      title?: string;
      type?: NodeType;
      description?: string;
      markdown?: string;
      details?: Partial<NodeDetails>;
      sourceFiles?: string[];
    }
  | {
      kind: 'reparent-node';
      index: number;
      key: string;
      parent: string | null;
    }
  | {
      kind: 'connect';
      index: number;
      source: string;
      target: string;
      type?: ConnectionType | null;
      label?: string;
    };

type NodeUpdate = Parameters<typeof updateNodeInProject>[2];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNodeType(value: unknown): value is NodeType {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).includes(value);
}

function isConnectionType(value: unknown): value is ConnectionType {
  return typeof value === 'string' && (CONNECTION_TYPES as readonly string[]).includes(value);
}

function readText(
  raw: unknown,
  field: string,
  label: string,
  errors: string[],
  options: { required?: boolean; max?: number } = {},
): string | undefined {
  if (raw === undefined) {
    if (options.required) errors.push(`${label} needs a "${field}".`);
    return undefined;
  }
  if (typeof raw !== 'string') {
    errors.push(`${label} has an invalid "${field}".`);
    return undefined;
  }
  const value = raw.trim();
  if (options.required && !value) {
    errors.push(`${label} needs a non-empty "${field}".`);
    return undefined;
  }
  if (options.max !== undefined && value.length > options.max) {
    errors.push(`${label} has a "${field}" longer than ${options.max} characters.`);
    return undefined;
  }
  return value;
}

/** Markdown keeps its leading/trailing whitespace on purpose. */
function readBody(
  raw: unknown,
  field: string,
  label: string,
  errors: string[],
  max: number,
): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') {
    errors.push(`${label} has an invalid "${field}".`);
    return undefined;
  }
  if (raw.length > max) {
    errors.push(`${label} has a "${field}" longer than ${max} characters.`);
    return undefined;
  }
  return raw;
}

function readRef(
  raw: unknown,
  field: string,
  label: string,
  errors: string[],
): string | undefined {
  const value = readText(raw, field, label, errors, {
    required: true,
    max: MAX_KEY_LENGTH,
  });
  if (value === undefined) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    errors.push(`${label} has a "${field}" containing control characters.`);
    return undefined;
  }
  return value;
}

function readUpsertKey(
  raw: unknown,
  label: string,
  errors: string[],
): string | undefined {
  const value = readRef(raw, 'key', label, errors);
  if (value === undefined) return undefined;
  return value;
}

function readOptionalType(
  raw: unknown,
  label: string,
  errors: string[],
): NodeType | undefined {
  if (raw === undefined) return undefined;
  if (!isNodeType(raw)) {
    errors.push(`${label} has an unknown node type "${String(raw)}".`);
    return undefined;
  }
  return raw;
}

function readParent(
  raw: unknown,
  label: string,
  errors: string[],
  required: boolean,
): string | null | undefined {
  if (raw === undefined) {
    if (required) errors.push(`${label} needs a "parent" (use null for the project root).`);
    return undefined;
  }
  if (raw === null) return null;
  if (typeof raw !== 'string' || !raw.trim()) {
    errors.push(`${label} has an invalid parent reference.`);
    return undefined;
  }
  const parent = raw.trim();
  if (parent.length > MAX_KEY_LENGTH) {
    errors.push(`${label} has a parent reference that is too long.`);
    return undefined;
  }
  return parent;
}

function readPosition(
  raw: unknown,
  label: string,
  errors: string[],
): Point | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) {
    errors.push(`${label} has invalid canvas coordinates.`);
    return undefined;
  }
  return { x: raw.x, y: raw.y };
}

function readDetails(
  raw: unknown,
  label: string,
  errors: string[],
): Partial<NodeDetails> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    errors.push(`${label} has invalid details.`);
    return undefined;
  }
  const details: Partial<NodeDetails> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!DETAIL_KEYS.has(key)) {
      errors.push(`${label} has an unknown detail field "${key}".`);
      continue;
    }
    if (typeof value !== 'string') {
      errors.push(`${label} has a non-text "${key}" detail.`);
      continue;
    }
    if (value.length > MAX_MARKDOWN_LENGTH) {
      errors.push(`${label} has a "${key}" detail that is too long.`);
      continue;
    }
    details[key as DetailKey] = value;
  }
  return details;
}

function readSourceFiles(
  raw: unknown,
  label: string,
  errors: string[],
): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    errors.push(`${label} has an invalid source file list.`);
    return undefined;
  }
  const files: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      errors.push(`${label} has a non-text source file.`);
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed) files.push(trimmed.slice(0, MAX_SOURCE_FILE_LENGTH));
  }
  return files.slice(0, MAX_SOURCE_FILES);
}

function readPlanProvenance(
  raw: unknown,
  errors: string[],
): PlanProvenance | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isRecord(raw)) {
    errors.push('The plan provenance must be an object.');
    return undefined;
  }
  const tool =
    typeof raw.tool === 'string' ? raw.tool.trim().slice(0, MAX_TOOL_NAME_LENGTH) : '';
  if (!tool) {
    errors.push('The plan provenance needs a tool name.');
    return undefined;
  }
  const sourceFiles =
    readSourceFiles(raw.sourceFiles, 'The plan provenance', errors) ?? [];
  const commit =
    typeof raw.commit === 'string' && raw.commit.trim()
      ? raw.commit.trim().slice(0, 200)
      : undefined;
  return { tool, sourceFiles, ...(commit ? { commit } : {}) };
}

function parseOperation(
  raw: unknown,
  index: number,
  errors: string[],
): NormalizedOperation | null {
  const label = `Operation ${index + 1}`;
  if (!isRecord(raw)) {
    errors.push(`${label} must be an object.`);
    return null;
  }
  const before = errors.length;
  const kind = raw.op;
  let operation: NormalizedOperation | null = null;

  if (kind === 'upsert-node') {
    const key = readUpsertKey(raw.key, label, errors);
    const title = readText(raw.title, 'title', label, errors, {
      required: true,
      max: MAX_TITLE_LENGTH,
    });
    const type = readOptionalType(raw.type, label, errors);
    if (raw.type === undefined) errors.push(`${label} needs a "type".`);
    const parent = readParent(raw.parent, label, errors, false);
    const description = readText(raw.description, 'description', label, errors, {
      max: MAX_DESCRIPTION_LENGTH,
    });
    const markdown = readBody(raw.markdown, 'markdown', label, errors, MAX_MARKDOWN_LENGTH);
    const details = readDetails(raw.details, label, errors);
    const position = readPosition(raw.position, label, errors);
    const sourceFiles = readSourceFiles(raw.sourceFiles, label, errors);

    if (key && title && type) {
      operation = {
        kind: 'upsert-node',
        index,
        key,
        type,
        title,
        parent,
        ...(description !== undefined ? { description } : {}),
        ...(markdown !== undefined ? { markdown } : {}),
        ...(details !== undefined ? { details } : {}),
        ...(position !== undefined ? { position } : {}),
        ...(sourceFiles !== undefined ? { sourceFiles } : {}),
      };
    }
  } else if (kind === 'update-node') {
    const key = readRef(raw.key, 'key', label, errors);
    const title = readText(raw.title, 'title', label, errors, {
      max: MAX_TITLE_LENGTH,
    });
    const type = readOptionalType(raw.type, label, errors);
    const description = readText(raw.description, 'description', label, errors, {
      max: MAX_DESCRIPTION_LENGTH,
    });
    const markdown = readBody(raw.markdown, 'markdown', label, errors, MAX_MARKDOWN_LENGTH);
    const details = readDetails(raw.details, label, errors);
    const sourceFiles = readSourceFiles(raw.sourceFiles, label, errors);

    if (key) {
      operation = {
        kind: 'update-node',
        index,
        key,
        ...(title !== undefined ? { title } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(markdown !== undefined ? { markdown } : {}),
        ...(details !== undefined ? { details } : {}),
        ...(sourceFiles !== undefined ? { sourceFiles } : {}),
      };
    }
  } else if (kind === 'reparent-node') {
    const key = readRef(raw.key, 'key', label, errors);
    const parent = readParent(raw.parent, label, errors, true);
    if (key && parent !== undefined) {
      operation = { kind: 'reparent-node', index, key, parent };
    }
  } else if (kind === 'connect') {
    const source = readRef(raw.source, 'source', label, errors);
    const target = readRef(raw.target, 'target', label, errors);
    let type: ConnectionType | null | undefined;
    if (raw.type === undefined) {
      type = undefined;
    } else if (raw.type === null) {
      type = null;
    } else if (isConnectionType(raw.type)) {
      type = raw.type;
    } else {
      errors.push(`${label} has an unknown connection type "${String(raw.type)}".`);
    }
    const labelText = readText(raw.label, 'label', label, errors, {
      max: MAX_LABEL_LENGTH,
    });
    if (source && target) {
      operation = {
        kind: 'connect',
        index,
        source,
        target,
        ...(type !== undefined ? { type } : {}),
        ...(labelText !== undefined ? { label: labelText } : {}),
      };
    }
  } else {
    errors.push(`${label} has an unknown operation "${String(kind)}".`);
  }

  if (errors.length > before) return null;
  return operation;
}

function resolveRef(project: Project, ref: string): FlowNode | undefined {
  if (ref === ROOT_REF) return getRootNode(project);
  return (
    project.nodes.find((node) => node.externalKey === ref) ?? getNode(project, ref)
  );
}

function resolveUpsertTarget(project: Project, key: string): FlowNode | undefined {
  if (key === ROOT_REF) return getRootNode(project);
  return project.nodes.find((node) => node.externalKey === key);
}

function hasNodeId(project: Project, id: string): boolean {
  return project.nodes.some((node) => node.id === id);
}

function provenanceFor(
  plan: PlanProvenance | undefined,
  sourceFiles: string[] | undefined,
): NodeProvenance | undefined {
  if (!plan) return undefined;
  return {
    tool: plan.tool,
    at: now(),
    sourceFiles: sourceFiles ?? plan.sourceFiles ?? [],
    ...(plan.commit ? { commit: plan.commit } : {}),
  };
}

function applyToExisting(
  project: Project,
  node: FlowNode,
  desired: {
    title?: string;
    type?: NodeType;
    description?: string;
    markdown?: string;
    details?: Partial<NodeDetails>;
    externalKey?: string;
    position?: Point;
    provenance?: NodeProvenance;
  },
): { project: Project; changed: boolean } {
  const patch: NodeUpdate = {};

  if (desired.title !== undefined && desired.title !== node.title) {
    patch.title = desired.title;
  }
  if (desired.type !== undefined && desired.type !== node.type) {
    patch.type = desired.type;
  }
  if (desired.description !== undefined && desired.description !== node.description) {
    patch.description = desired.description;
  }
  if (desired.markdown !== undefined && desired.markdown !== node.markdown) {
    patch.markdown = desired.markdown;
  }
  if (desired.details) {
    const merged = { ...node.details, ...desired.details };
    if (DETAIL_FIELDS.some(({ key }) => merged[key] !== node.details[key])) {
      patch.details = desired.details;
    }
  }
  if (desired.externalKey && !node.externalKey) {
    patch.externalKey = desired.externalKey;
  }
  if (
    desired.position &&
    (desired.position.x !== node.position.x || desired.position.y !== node.position.y)
  ) {
    patch.position = desired.position;
  }

  if (Object.keys(patch).length === 0) {
    return { project, changed: false };
  }
  if (desired.provenance) patch.provenance = desired.provenance;
  return { project: updateNodeInProject(project, node.id, patch), changed: true };
}

function createFromUpsert(
  project: Project,
  op: Extract<NormalizedOperation, { kind: 'upsert-node' }>,
  parentId: string,
  provenance: NodeProvenance | undefined,
): { project: Project; node: FlowNode } {
  const result = addChildNode(project, parentId, {
    type: op.type,
    title: op.title,
    description: op.description ?? '',
  });
  const node: FlowNode = {
    ...result.node,
    ...(op.key !== ROOT_REF ? { externalKey: op.key } : {}),
    ...(op.markdown !== undefined ? { markdown: op.markdown } : {}),
    ...(op.details
      ? { details: { ...result.node.details, ...op.details } }
      : {}),
    ...(provenance ? { provenance } : {}),
    ...(op.position ? { position: op.position } : {}),
  };
  return {
    node,
    project: {
      ...result.project,
      nodes: result.project.nodes.map((candidate) =>
        candidate.id === node.id ? node : candidate,
      ),
      updatedAt: now(),
    },
  };
}

function emptySummary(): ApplyPlanSummary {
  return { created: 0, updated: 0, unchanged: 0, connected: 0 };
}

function summarize(changes: OperationChange[]): ApplyPlanSummary {
  const summary = emptySummary();
  for (const change of changes) {
    // Edges are reported separately so "created" always means nodes.
    if (change.operation === 'connect') {
      if (change.action === 'created') summary.connected += 1;
      else if (change.action === 'updated') summary.updated += 1;
      else summary.unchanged += 1;
      continue;
    }
    if (change.action === 'created') summary.created += 1;
    else if (change.action === 'updated') summary.updated += 1;
    else summary.unchanged += 1;
  }
  return summary;
}

function fail(
  errors: string[],
  dryRun: boolean,
): ApplyPlanResult {
  return {
    ok: false,
    dryRun,
    errors,
    changes: [],
    summary: emptySummary(),
  };
}

/**
 * Validates and applies a plan. `dryRun` returns the simulated project without
 * changing the caller's project; the input object is never mutated either way.
 */
export function applyPlan(project: Project, input: ApplyPlanInput): ApplyPlanResult {
  const dryRun = input.dryRun === true;
  const errors: string[] = [];

  if (!Array.isArray(input.ops)) {
    return fail(['The plan must contain an "ops" array.'], dryRun);
  }
  if (input.ops.length === 0) {
    return fail(['The plan contains no operations.'], dryRun);
  }
  if (input.ops.length > MAX_PLAN_OPERATIONS) {
    return fail(
      [`The plan has more than ${MAX_PLAN_OPERATIONS} operations.`],
      dryRun,
    );
  }

  const planProvenance = readPlanProvenance(input.provenance, errors);
  const operations: NormalizedOperation[] = [];
  input.ops.forEach((raw, index) => {
    const parsed = parseOperation(raw, index, errors);
    if (parsed) operations.push(parsed);
  });
  if (errors.length > 0) return fail(errors, dryRun);

  // Duplicate upsert keys would make the result order-dependent.
  const upsertKeys = new Set<string>();
  for (const op of operations) {
    if (op.kind !== 'upsert-node') continue;
    if (upsertKeys.has(op.key)) {
      errors.push(`Operation ${op.index + 1} repeats the external key "${op.key}".`);
    }
    upsertKeys.add(op.key);
    if (op.key !== ROOT_REF && hasNodeId(project, op.key)) {
      errors.push(
        `Operation ${op.index + 1} uses external key "${op.key}", which collides with a node id.`,
      );
    }
  }
  if (errors.length > 0) return fail(errors, dryRun);

  let current = project;
  const changes: OperationChange[] = [];

  const upsertOps = operations.filter(
    (op): op is Extract<NormalizedOperation, { kind: 'upsert-node' }> =>
      op.kind === 'upsert-node',
  );

  const existingUpserts: Array<{
    op: Extract<NormalizedOperation, { kind: 'upsert-node' }>;
    target: FlowNode;
  }> = [];
  const pending: Array<Extract<NormalizedOperation, { kind: 'upsert-node' }>> = [];
  for (const op of upsertOps) {
    const target = resolveUpsertTarget(project, op.key);
    if (target) existingUpserts.push({ op, target });
    else pending.push(op);
  }

  /* ------------------------------------------------------ new node creation */

  // Create new nodes before touching existing ones so an existing node can be
  // moved beneath a node this same plan creates.
  let remaining = [...pending];
  while (remaining.length > 0) {
    let progressed = false;
    const next: typeof remaining = [];
    for (const op of remaining) {
      let parentId: string | null = null;
      if (op.parent === undefined || op.parent === null) {
        parentId = getRootNode(current)?.id ?? null;
      } else {
        parentId = resolveRef(current, op.parent)?.id ?? null;
      }
      if (!parentId) {
        next.push(op);
        continue;
      }
      const provenance = provenanceFor(planProvenance, op.sourceFiles);
      const result = createFromUpsert(current, op, parentId, provenance);
      current = result.project;
      progressed = true;
      changes.push({
        op: op.index,
        operation: 'upsert-node',
        action: 'created',
        key: op.key,
        nodeId: result.node.id,
        title: result.node.title,
      });
    }
    if (!progressed) break;
    remaining = next;
  }

  if (remaining.length > 0) {
    for (const op of remaining) {
      const parentKey = op.parent ?? ROOT_REF;
      const dependsOnPlan = pending.some((candidate) => candidate.key === parentKey);
      errors.push(
        dependsOnPlan || parentKey === op.key
          ? `Operation ${op.index + 1} creates a hierarchy cycle with parent "${parentKey}".`
          : `Operation ${op.index + 1} cannot find parent "${parentKey}".`,
      );
    }
    return fail(errors, dryRun);
  }

  /* --------------------------------------------------- update existing nodes */

  for (const { op, target } of existingUpserts) {
    const provenance = provenanceFor(planProvenance, op.sourceFiles);

    if (op.parent !== undefined && op.key === ROOT_REF) {
      errors.push(`Operation ${op.index + 1} cannot re-parent the project root.`);
      return fail(errors, dryRun);
    }

    const content = applyToExisting(current, target, {
      title: op.title,
      type: op.type,
      description: op.description,
      markdown: op.markdown,
      details: op.details,
      position: op.position,
      provenance,
    });
    current = content.project;
    let changed = content.changed;

    if (op.parent !== undefined) {
      const parent = resolveRef(current, op.parent ?? ROOT_REF);
      if (!parent) {
        errors.push(
          `Operation ${op.index + 1} cannot find parent "${op.parent ?? ROOT_REF}".`,
        );
        return fail(errors, dryRun);
      }
      if (parent.id !== target.parentId) {
        const result = reparentInProject(current, target.id, parent.id);
        if (!result.ok) {
          errors.push(`Operation ${op.index + 1}: ${result.error}`);
          return fail(errors, dryRun);
        }
        current = result.project;
        changed = true;
      }
    }

    if (changed && provenance && !content.changed) {
      current = updateNodeInProject(current, target.id, { provenance });
    }

    const updated = getNode(current, target.id);
    changes.push({
      op: op.index,
      operation: 'upsert-node',
      action: changed ? 'updated' : 'unchanged',
      key: op.key,
      nodeId: target.id,
      title: updated?.title ?? op.title,
    });
  }

  /* --------------------------------------------------------------- updates */

  for (const op of operations) {
    if (op.kind !== 'update-node') continue;
    const node = resolveRef(current, op.key);
    if (!node) {
      errors.push(`Operation ${op.index + 1} cannot find node "${op.key}".`);
      return fail(errors, dryRun);
    }
    const provenance = provenanceFor(planProvenance, op.sourceFiles);
    const result = applyToExisting(current, node, {
      title: op.title,
      type: op.type,
      description: op.description,
      markdown: op.markdown,
      details: op.details,
      provenance,
    });
    current = result.project;
    changes.push({
      op: op.index,
      operation: 'update-node',
      action: result.changed ? 'updated' : 'unchanged',
      key: op.key,
      nodeId: node.id,
      title: op.title ?? node.title,
    });
  }

  /* ------------------------------------------------------------- reparents */

  for (const op of operations) {
    if (op.kind !== 'reparent-node') continue;
    const node = resolveRef(current, op.key);
    if (!node) {
      errors.push(`Operation ${op.index + 1} cannot find node "${op.key}".`);
      return fail(errors, dryRun);
    }
    const parent = op.parent === null ? null : resolveRef(current, op.parent);
    if (op.parent !== null && !parent) {
      errors.push(`Operation ${op.index + 1} cannot find parent "${op.parent}".`);
      return fail(errors, dryRun);
    }
    const targetParentId = parent?.id ?? getRootNode(current)?.id ?? null;
    if (targetParentId === null) {
      errors.push(`Operation ${op.index + 1}: the project has no root node.`);
      return fail(errors, dryRun);
    }
    if (node.parentId === targetParentId) {
      changes.push({
        op: op.index,
        operation: 'reparent-node',
        action: 'unchanged',
        key: op.key,
        nodeId: node.id,
        title: node.title,
      });
      continue;
    }
    const result = reparentInProject(current, node.id, targetParentId);
    if (!result.ok) {
      errors.push(`Operation ${op.index + 1}: ${result.error}`);
      return fail(errors, dryRun);
    }
    current = result.project;
    changes.push({
      op: op.index,
      operation: 'reparent-node',
      action: 'updated',
      key: op.key,
      nodeId: node.id,
      title: node.title,
    });
  }

  /* ------------------------------------------------------------ connections */

  for (const op of operations) {
    if (op.kind !== 'connect') continue;
    const source = resolveRef(current, op.source);
    const target = resolveRef(current, op.target);
    if (!source) {
      errors.push(`Operation ${op.index + 1} cannot find source node "${op.source}".`);
      return fail(errors, dryRun);
    }
    if (!target) {
      errors.push(`Operation ${op.index + 1} cannot find target node "${op.target}".`);
      return fail(errors, dryRun);
    }
    if (source.id === target.id) {
      errors.push(`Operation ${op.index + 1} connects a node to itself.`);
      return fail(errors, dryRun);
    }

    // Connections are "ensured": a repeated plan updates the existing edge
    // instead of failing or creating a duplicate.
    const existing = current.connections.find(
      (connection) =>
        connection.source === source.id && connection.target === target.id,
    );
    if (existing) {
      const patch: { type?: ConnectionType | null; label?: string } = {};
      if (op.type !== undefined && op.type !== existing.type) patch.type = op.type;
      if (op.label !== undefined && op.label !== existing.label) patch.label = op.label;
      const changed = Object.keys(patch).length > 0;
      if (changed) current = updateConnection(current, existing.id, patch);
      changes.push({
        op: op.index,
        operation: 'connect',
        action: changed ? 'updated' : 'unchanged',
        key: `${op.source}->${op.target}`,
        title: source.title,
      });
      continue;
    }

    const result = createConnection(
      current,
      source.id,
      target.id,
      op.type ?? null,
      op.label ?? '',
    );
    if (!result.ok) {
      errors.push(`Operation ${op.index + 1}: ${result.error}`);
      return fail(errors, dryRun);
    }
    current = result.project;
    changes.push({
      op: op.index,
      operation: 'connect',
      action: 'created',
      key: `${op.source}->${op.target}`,
      nodeId: result.connection?.id,
      title: source.title,
    });
  }

  const integrityErrors = validateProjectIntegrity(current);
  if (integrityErrors.length > 0) {
    return fail(integrityErrors, dryRun);
  }

  changes.sort((a, b) => a.op - b.op);

  return {
    ok: true,
    dryRun,
    errors: [],
    changes,
    summary: summarize(changes),
    project: current,
  };
}

/**
 * Structural checks for a project produced by a plan (or loaded from storage).
 * Returns human-readable problems instead of throwing.
 */
export function validateProjectIntegrity(project: Project): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const parentById = new Map<string, string | null>();

  for (const node of project.nodes) {
    if (ids.has(node.id)) {
      errors.push(`Duplicate node id "${node.id}".`);
    }
    ids.add(node.id);
    parentById.set(node.id, node.parentId);
    if (node.projectId !== project.id) {
      errors.push(`Node "${node.title}" belongs to another project.`);
    }
  }

  const externalKeys = new Set<string>();
  for (const node of project.nodes) {
    if (node.parentId !== null) {
      if (!ids.has(node.parentId)) {
        errors.push(`Node "${node.title}" references a missing parent.`);
      }
      if (node.parentId === node.id) {
        errors.push(`Node "${node.title}" is its own parent.`);
      }
    }

    if (node.externalKey) {
      if (node.externalKey === ROOT_REF) {
        errors.push(`Node "${node.title}" uses the reserved key "${ROOT_REF}".`);
      } else if (externalKeys.has(node.externalKey)) {
        errors.push(`External key "${node.externalKey}" is used by more than one node.`);
      } else if (ids.has(node.externalKey)) {
        errors.push(`External key "${node.externalKey}" collides with a node id.`);
      }
      externalKeys.add(node.externalKey);
    }
  }

  for (const node of project.nodes) {
    const seen = new Set<string>([node.id]);
    let cursor = node.parentId;
    while (cursor) {
      if (seen.has(cursor)) {
        errors.push(`Hierarchy cycle detected around node "${node.title}".`);
        break;
      }
      seen.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
  }

  const pairs = new Set<string>();
  for (const connection of project.connections) {
    if (connection.projectId !== project.id) {
      errors.push('A connection belongs to another project.');
    }
    if (!ids.has(connection.source)) {
      errors.push('A connection starts at a missing node.');
    }
    if (!ids.has(connection.target)) {
      errors.push('A connection ends at a missing node.');
    }
    if (connection.source === connection.target) {
      errors.push('A connection links a node to itself.');
    }
    const pair = `${connection.source}->${connection.target}`;
    if (pairs.has(pair)) {
      errors.push('Two connections share the same source and target.');
    }
    pairs.add(pair);
  }

  return errors;
}
