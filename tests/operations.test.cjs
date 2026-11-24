'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyPlan,
  validateProjectIntegrity,
  createProject,
  duplicateNode,
} = require('../.test-build/core.cjs');

const PROVENANCE = { tool: 'test', sourceFiles: ['src/auth/session.ts'] };

function baseProject() {
  return createProject('Demo');
}

function plan(ops, extra = {}) {
  return { provenance: PROVENANCE, ops, ...extra };
}

function keyed(project, key) {
  return project.nodes.find((node) => node.externalKey === key);
}

test('creates a hierarchy, documentation, and connections in one plan', () => {
  const project = baseProject();
  const result = applyPlan(
    project,
    plan([
      {
        op: 'upsert-node',
        key: 'module/auth',
        type: 'module',
        title: 'Auth',
        parent: '@root',
        markdown: '# Auth',
        details: { purpose: 'Identify users.' },
      },
      {
        op: 'upsert-node',
        key: 'module/auth/login',
        type: 'feature',
        title: 'Login',
        parent: 'module/auth',
      },
      {
        op: 'connect',
        source: 'module/auth/login',
        target: 'module/auth',
        type: 'depends-on',
      },
    ]),
  );

  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.summary.created, 2);
  assert.equal(result.summary.connected, 1);
  const auth = keyed(result.project, 'module/auth');
  const login = keyed(result.project, 'module/auth/login');
  assert.equal(auth.markdown, '# Auth');
  assert.equal(auth.details.purpose, 'Identify users.');
  assert.equal(auth.provenance.tool, 'test');
  assert.equal(login.parentId, auth.id);
  assert.equal(result.project.connections.length, 1);
});

test('re-running the same plan is idempotent', () => {
  const first = applyPlan(
    baseProject(),
    plan([
      {
        op: 'upsert-node',
        key: 'module/auth',
        type: 'module',
        title: 'Auth',
        parent: '@root',
        markdown: '# Auth',
      },
      {
        op: 'connect',
        source: 'module/auth',
        target: '@root',
        type: 'related-to',
      },
    ]),
  );
  assert.equal(first.ok, true, first.errors.join('\n'));

  const second = applyPlan(first.project, plan([
    {
      op: 'upsert-node',
      key: 'module/auth',
      type: 'module',
      title: 'Auth',
      parent: '@root',
      markdown: '# Auth',
    },
    {
      op: 'connect',
      source: 'module/auth',
      target: '@root',
      type: 'related-to',
    },
  ]));

  assert.equal(second.ok, true, second.errors.join('\n'));
  assert.equal(second.summary.created, 0);
  assert.equal(second.summary.updated, 0);
  assert.equal(second.summary.unchanged, 2);
  assert.equal(second.project.nodes.length, first.project.nodes.length);
  assert.equal(second.project.connections.length, 1);
});

test('updates existing nodes by external key without duplicating them', () => {
  const first = applyPlan(
    baseProject(),
    plan([
      { op: 'upsert-node', key: 'module/db', type: 'module', title: 'DB', parent: '@root' },
    ]),
  );
  assert.equal(first.ok, true);
  const nodeCount = first.project.nodes.length;

  const second = applyPlan(
    first.project,
    plan([
      {
        op: 'update-node',
        key: 'module/db',
        markdown: 'Stores users.',
        details: { purpose: 'Persistence.' },
      },
    ]),
  );
  assert.equal(second.ok, true, second.errors.join('\n'));
  assert.equal(second.project.nodes.length, nodeCount);
  const db = keyed(second.project, 'module/db');
  assert.equal(db.markdown, 'Stores users.');
  assert.equal(db.details.purpose, 'Persistence.');
});

test('creates parents before children even when the plan lists children first', () => {
  const result = applyPlan(
    baseProject(),
    plan([
      {
        op: 'upsert-node',
        key: 'module/a/child',
        type: 'feature',
        title: 'Child',
        parent: 'module/a',
      },
      {
        op: 'upsert-node',
        key: 'module/a',
        type: 'module',
        title: 'A',
        parent: '@root',
      },
    ]),
  );
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.summary.created, 2);
  assert.equal(keyed(result.project, 'module/a/child').parentId, keyed(result.project, 'module/a').id);
});

test('moves an existing node under a node created by the same plan', () => {
  const first = applyPlan(
    baseProject(),
    plan([
      { op: 'upsert-node', key: 'module/old', type: 'feature', title: 'Old', parent: '@root' },
    ]),
  );
  assert.equal(first.ok, true);
  const second = applyPlan(
    first.project,
    plan([
      {
        op: 'upsert-node',
        key: 'module/old',
        type: 'feature',
        title: 'Old',
        parent: 'module/new',
      },
      {
        op: 'upsert-node',
        key: 'module/new',
        type: 'module',
        title: 'New',
        parent: '@root',
      },
    ]),
  );
  assert.equal(second.ok, true, second.errors.join('\n'));
  assert.equal(
    keyed(second.project, 'module/old').parentId,
    keyed(second.project, 'module/new').id,
  );
});

test('rejects missing references and leaves the project untouched', () => {
  const project = baseProject();
  const result = applyPlan(
    project,
    plan([
      { op: 'upsert-node', key: 'module/ok', type: 'module', title: 'Ok', parent: '@root' },
      { op: 'upsert-node', key: 'module/bad', type: 'module', title: 'Bad', parent: 'missing' },
    ]),
  );
  assert.equal(result.ok, false);
  assert.equal(result.project, undefined);
  assert.equal(project.nodes.length, 1);
  assert.match(result.errors.join('\n'), /missing/);
});

test('rejects hierarchy cycles between planned nodes', () => {
  const result = applyPlan(
    baseProject(),
    plan([
      { op: 'upsert-node', key: 'a', type: 'module', title: 'A', parent: 'b' },
      { op: 'upsert-node', key: 'b', type: 'module', title: 'B', parent: 'a' },
    ]),
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /cycle/i);
});

test('rejects reparenting a node beneath its own descendant', () => {
  const first = applyPlan(
    baseProject(),
    plan([
      { op: 'upsert-node', key: 'a', type: 'module', title: 'A', parent: '@root' },
      { op: 'upsert-node', key: 'a/b', type: 'feature', title: 'B', parent: 'a' },
    ]),
  );
  assert.equal(first.ok, true);
  const result = applyPlan(
    first.project,
    plan([{ op: 'reparent-node', key: 'a', parent: 'a/b' }]),
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /descendant/i);
});

test('rejects self-connections and validates unknown types', () => {
  const first = applyPlan(
    baseProject(),
    plan([{ op: 'upsert-node', key: 'a', type: 'module', title: 'A', parent: '@root' }]),
  );
  assert.equal(first.ok, true);

  const self = applyPlan(first.project, plan([
    { op: 'connect', source: 'a', target: 'a' },
  ]));
  assert.equal(self.ok, false);
  assert.match(self.errors.join('\n'), /itself/i);

  const badType = applyPlan(first.project, plan([
    { op: 'upsert-node', key: 'b', type: 'nonsense', title: 'B' },
  ]));
  assert.equal(badType.ok, false);
  assert.match(badType.errors.join('\n'), /unknown node type/i);
});

test('rejects duplicate upsert keys and unknown detail fields', () => {
  const duplicate = applyPlan(
    baseProject(),
    plan([
      { op: 'upsert-node', key: 'a', type: 'module', title: 'A', parent: '@root' },
      { op: 'upsert-node', key: 'a', type: 'module', title: 'A2', parent: '@root' },
    ]),
  );
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.errors.join('\n'), /repeats the external key/i);

  const detail = applyPlan(
    baseProject(),
    plan([
      {
        op: 'upsert-node',
        key: 'a',
        type: 'module',
        title: 'A',
        details: { purpose: 'ok', notAField: 'bad' },
      },
    ]),
  );
  assert.equal(detail.ok, false);
  assert.match(detail.errors.join('\n'), /unknown detail field/i);
});

test('dry run returns the proposed project without mutating the input', () => {
  const project = baseProject();
  const result = applyPlan(
    project,
    plan(
      [{ op: 'upsert-node', key: 'a', type: 'module', title: 'A', parent: '@root' }],
      { dryRun: true },
    ),
  );
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.dryRun, true);
  assert.equal(project.nodes.length, 1);
  assert.equal(result.project.nodes.length, 2);
  assert.equal(result.summary.created, 1);
});

test('records per-operation provenance and leaves unchanged nodes alone', () => {
  const first = applyPlan(
    baseProject(),
    plan([
      {
        op: 'upsert-node',
        key: 'a',
        type: 'module',
        title: 'A',
        parent: '@root',
        sourceFiles: ['src/a.ts'],
      },
    ]),
  );
  assert.equal(first.ok, true);
  const node = keyed(first.project, 'a');
  assert.deepEqual(node.provenance.sourceFiles, ['src/a.ts']);

  const second = applyPlan(
    first.project,
    plan([
      {
        op: 'upsert-node',
        key: 'a',
        type: 'module',
        title: 'A',
        parent: '@root',
        sourceFiles: ['src/other.ts'],
      },
    ]),
  );
  assert.equal(second.ok, true);
  assert.equal(second.summary.unchanged, 1);
  assert.deepEqual(keyed(second.project, 'a').provenance.sourceFiles, ['src/a.ts']);
});

test('duplicating a generated node does not clone its external key', () => {
  const first = applyPlan(
    baseProject(),
    plan([
      { op: 'upsert-node', key: 'module/a', type: 'module', title: 'A', parent: '@root' },
    ]),
  );
  assert.equal(first.ok, true);
  const node = keyed(first.project, 'module/a');
  const duplicate = duplicateNode(first.project, node.id);
  assert.ok(duplicate);
  assert.equal(duplicate.node.externalKey, undefined);
  assert.equal(duplicate.node.provenance, undefined);
  assert.equal(validateProjectIntegrity(duplicate.project).length, 0);
});

test('integrity validation catches duplicate external keys', () => {
  const project = baseProject();
  project.nodes.push({
    ...project.nodes[0],
    id: 'extra',
    parentId: project.nodes[0].id,
    title: 'Extra',
    externalKey: 'dup',
  });
  project.nodes[0].externalKey = 'dup';
  const errors = validateProjectIntegrity(project);
  assert.match(errors.join('\n'), /used by more than one node/i);
});
