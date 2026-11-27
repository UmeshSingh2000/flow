'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSourceFence } = require('../.test-build/core.cjs');

test('parses file and line annotations from code fences', () => {
  assert.deepEqual(parseSourceFence('ts file=src/auth/session.ts lines=24-38'), {
    language: 'ts',
    path: 'src/auth/session.ts',
    startLine: 24,
    endLine: 38,
  });
});

test('parses hash and title line annotations', () => {
  assert.deepEqual(parseSourceFence('ts src/auth/session.ts#L7-L9'), {
    language: 'ts',
    path: 'src/auth/session.ts',
    startLine: 7,
    endLine: 9,
  });
  assert.deepEqual(parseSourceFence('js title="src/app.js:12"'), {
    language: 'js',
    path: 'src/app.js',
    startLine: 12,
    endLine: 12,
  });
});

test('leaves plain language fences alone', () => {
  assert.equal(parseSourceFence('ts'), null);
  assert.equal(parseSourceFence(''), null);
  assert.equal(parseSourceFence('bash file=https://example.com/x.sh'), null);
});

test('parses braced fence info strings', () => {
  assert.deepEqual(parseSourceFence('{.ts file=src/a.ts lines=3-5}'), {
    language: 'ts',
    path: 'src/a.ts',
    startLine: 3,
    endLine: 5,
  });
});

test('parses annotations without a language', () => {
  assert.deepEqual(parseSourceFence('file=src/a.ts lines=8-9'), {
    language: '',
    path: 'src/a.ts',
    startLine: 8,
    endLine: 9,
  });
});
