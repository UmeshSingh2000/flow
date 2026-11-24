'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyPlan,
  computeAutoLayout,
  createProject,
} = require('../.test-build/core.cjs');

const DEFAULT_HEIGHT = 78;

function buildProject() {
  const result = applyPlan(createProject('Layout'), {
    ops: [
      { op: 'upsert-node', key: 'module/a', type: 'module', title: 'A', parent: '@root' },
      { op: 'upsert-node', key: 'module/a/b', type: 'feature', title: 'B', parent: 'module/a' },
      { op: 'upsert-node', key: 'module/a/c', type: 'feature', title: 'C', parent: 'module/a' },
      {
        op: 'upsert-node',
        key: 'module/a/b/deep',
        type: 'sub-feature',
        title: 'Deep',
        parent: 'module/a/b',
      },
    ],
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
  return result.project;
}

function byKey(project, key) {
  return project.nodes.find((node) => node.externalKey === key);
}

test('places every node in hierarchy columns without overlap', () => {
  const project = buildProject();
  const positions = computeAutoLayout(project);

  assert.equal(Object.keys(positions).length, project.nodes.length);

  const root = project.nodes.find((node) => node.parentId === null);
  const a = byKey(project, 'module/a');
  const b = byKey(project, 'module/a/b');
  const c = byKey(project, 'module/a/c');
  const deep = byKey(project, 'module/a/b/deep');

  assert.ok(positions[root.id].x < positions[a.id].x);
  assert.ok(positions[a.id].x < positions[b.id].x);
  assert.ok(positions[b.id].x < positions[deep.id].x);
  assert.equal(positions[b.id].x, positions[c.id].x);

  for (const node of project.nodes) {
    const position = positions[node.id];
    assert.equal(Number.isFinite(position.x), true);
    assert.equal(Number.isFinite(position.y), true);
  }

  // Sibling subtrees keep a readable vertical gap with default heights.
  assert.ok(Math.abs(positions[b.id].y - positions[c.id].y) >= DEFAULT_HEIGHT);
  // A single child stays vertically aligned with its parent.
  assert.equal(positions[b.id].y, positions[deep.id].y);
});

test('centres a parent on the block formed by its children', () => {
  const project = buildProject();
  const positions = computeAutoLayout(project, {
    rowGap: 20,
    nodeHeights: Object.fromEntries(project.nodes.map((node) => [node.id, 80])),
  });

  const a = byKey(project, 'module/a');
  const b = byKey(project, 'module/a/b');
  const c = byKey(project, 'module/a/c');

  const parentCentre = positions[a.id].y + 40;
  const childTop = Math.min(positions[b.id].y, positions[c.id].y);
  const childBottom = Math.max(positions[b.id].y, positions[c.id].y) + 80;
  assert.equal(parentCentre, (childTop + childBottom) / 2);
});

test('uses measured heights to space taller cards', () => {
  const project = buildProject();
  const a = byKey(project, 'module/a');
  const b = byKey(project, 'module/a/b');
  const c = byKey(project, 'module/a/c');

  const positions = computeAutoLayout(project, {
    rowGap: 24,
    nodeHeights: { [a.id]: 80, [b.id]: 200, [c.id]: 80 },
  });

  const gap = Math.abs(positions[b.id].y - positions[c.id].y);
  assert.ok(gap >= 200 + 24, `expected at least 224px, received ${gap}`);
});

test('is deterministic and keeps orphaned nodes visible', () => {
  const project = buildProject();
  const first = computeAutoLayout(project);
  const second = computeAutoLayout(project);
  assert.deepEqual(first, second);

  const damaged = {
    ...project,
    nodes: project.nodes.map((node) =>
      node.externalKey === 'module/a/c' ? { ...node, parentId: 'n_missing' } : node,
    ),
  };
  const positions = computeAutoLayout(damaged);
  const c = byKey(damaged, 'module/a/c');
  assert.ok(positions[c.id]);
  assert.equal(Number.isFinite(positions[c.id].y), true);
});

test('connections never influence layout', () => {
  const project = buildProject();
  const a = byKey(project, 'module/a');
  const c = byKey(project, 'module/a/c');

  const withConnection = {
    ...project,
    connections: [
      {
        id: 'c_test',
        projectId: project.id,
        source: a.id,
        target: c.id,
        type: 'depends-on',
        label: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };

  assert.deepEqual(computeAutoLayout(project), computeAutoLayout(withConnection));
});
