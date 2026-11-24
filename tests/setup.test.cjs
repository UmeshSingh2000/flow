'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const setup = require('../src/extension/setup.cjs');
const installer = require('../src/extension/installer.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeExecutable(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  try {
    fs.chmodSync(file, 0o755);
  } catch {
    /* ignore */
  }
  return file;
}

function fakeExecFile({ list = '', addError = null, addStderr = '' } = {}) {
  const calls = [];
  const impl = (file, args, options, callback) => {
    calls.push({ file, args, options });
    if (args[0] === 'mcp' && args[1] === 'list') {
      callback(null, list, '');
      return;
    }
    if (args[0] === 'mcp' && args[1] === 'add') {
      callback(addError, '', addStderr);
      return;
    }
    callback(null, '', '');
  };
  return { impl, calls };
}

function baseOptions(extra = {}) {
  const home = tempDir('flow-setup-home-');
  const appData = tempDir('flow-setup-data-');
  const workspace = tempDir('flow-setup-ws-');
  const claudeBin = tempDir('flow-setup-claude-');
  const nodeBin = path.dirname(process.execPath);
  makeExecutable(claudeBin, 'claude');
  return {
    extensionPath: REPO_ROOT,
    appDataDir: appData,
    workspacePath: workspace,
    homedir: home,
    platform: 'linux',
    env: {
      HOME: home,
      PATH: [
        path.join(home, '.local', 'bin'),
        claudeBin,
        nodeBin,
      ].join(path.delimiter),
    },
    ...extra,
  };
}

test(
  'one-click setup installs the CLI, skill, and MCP registration',
  { skip: process.platform === 'win32' },
  async () => {
    const options = baseOptions();
    const exec = fakeExecFile({ list: 'No MCP servers configured.' });

    const result = await setup.setupAll({
      ...options,
      execFileImpl: exec.impl,
    });

    assert.equal(result.ok, true);
    assert.equal(result.cli.ok, true);
    assert.equal(result.cli.onPath, true);
    assert.equal(result.skill.ok, true);
    assert.equal(result.mcp.status, 'added');
    assert.equal(exec.calls.length, 2);
    assert.deepEqual(exec.calls[0].args, ['mcp', 'list']);
    assert.deepEqual(exec.calls[1].args, [
      'mcp',
      'add',
      '--scope',
      'user',
      'flow',
      '--',
      'flow',
      'mcp',
    ]);

    assert.ok(fs.existsSync(result.cli.shimPath));
    assert.ok(
      fs.existsSync(
        path.join(options.homedir, '.claude', 'skills', 'flow', 'SKILL.md'),
      ),
    );

    const state = setup.isSetupComplete({
      appDataDir: options.appDataDir,
      env: options.env,
      platform: options.platform,
      homedir: options.homedir,
    });
    assert.equal(state.complete, true);
  },
);

test(
  'skips MCP registration when flow is already listed',
  { skip: process.platform === 'win32' },
  async () => {
    const options = baseOptions();
    const exec = fakeExecFile({
      list: 'Checking MCP server health...\n\nflow: flow mcp - ✔ Connected',
    });
    const result = await setup.setupAll({
      ...options,
      execFileImpl: exec.impl,
    });
    assert.equal(result.mcp.status, 'already');
    assert.equal(exec.calls.length, 1);
  },
);

test(
  'reports a missing Claude CLI and still installs the other pieces',
  { skip: process.platform === 'win32' },
  async () => {
    const options = baseOptions();
    options.env = {
      HOME: options.homedir,
      PATH: [
        path.join(options.homedir, '.local', 'bin'),
        path.dirname(process.execPath),
      ].join(path.delimiter),
    };
    const result = await setup.setupAll({
      ...options,
      execFileImpl: fakeExecFile({}).impl,
    });
    assert.equal(result.cli.ok, true);
    assert.equal(result.skill.ok, true);
    assert.equal(result.mcp.status, 'claude-missing');
    assert.match(result.mcp.command, /claude mcp add/);
  },
);

test(
  'does not overwrite a foreign Claude skill',
  { skip: process.platform === 'win32' },
  async () => {
    const options = baseOptions();
    const skillFile = path.join(
      options.homedir,
      '.claude',
      'skills',
      'flow',
      'SKILL.md',
    );
    const commandFile = path.join(
      options.homedir,
      '.claude',
      'commands',
      'flow-help.md',
    );
    fs.mkdirSync(path.dirname(skillFile), { recursive: true });
    fs.mkdirSync(path.dirname(commandFile), { recursive: true });
    fs.writeFileSync(skillFile, '---\nname: someone-else\n---\n');
    fs.writeFileSync(commandFile, 'not the flow command\n');

    const result = await setup.setupAll({
      ...options,
      execFileImpl: fakeExecFile({}).impl,
    });
    assert.equal(result.skill.ok, false);
    assert.equal(result.skill.conflict, true);
    assert.match(fs.readFileSync(skillFile, 'utf8'), /someone-else/);
  },
);

test(
  'does not overwrite a foreign flow executable',
  { skip: process.platform === 'win32' },
  async () => {
    const options = baseOptions();
    const shim = path.join(options.homedir, '.local', 'bin', 'flow');
    fs.mkdirSync(path.dirname(shim), { recursive: true });
    fs.writeFileSync(shim, '#!/bin/sh\necho foreign\n', { mode: 0o755 });

    const result = await setup.setupAll({
      ...options,
      execFileImpl: fakeExecFile({}).impl,
    });
    assert.equal(result.cli.ok, false);
    assert.equal(result.cli.conflict, true);
    assert.equal(result.mcp.status, 'cli-missing');
    assert.match(fs.readFileSync(shim, 'utf8'), /foreign/);
  },
);

test('quotes Windows command-line arguments safely', () => {
  assert.equal(setup.winQuote('mcp'), 'mcp');
  assert.equal(setup.winQuote('C:\\Program Files\\flow.cmd'), '"C:\\Program Files\\flow.cmd"');
  assert.equal(setup.winQuote('a&b'), '"a&b"');
});

test('recognizes Flow-owned Claude files', () => {
  const home = tempDir('flow-setup-own-');
  const skill = path.join(home, 'skills', 'flow', 'SKILL.md');
  const command = path.join(home, 'commands', 'flow-help.md');
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.mkdirSync(path.dirname(command), { recursive: true });
  fs.writeFileSync(skill, '---\nname: flow\ndescription: test\n---\n');
  fs.writeFileSync(command, 'Run `flow help --json`.\n');
  assert.equal(setup.isFlowSkillFile(skill), true);
  assert.equal(setup.isFlowSkillFile(command), true);

  fs.writeFileSync(skill, '---\nname: other\n---\n');
  assert.equal(setup.isFlowSkillFile(skill), false);
  assert.equal(installer.findExecutable('definitely-not-installed', '', 'linux'), null);
});
