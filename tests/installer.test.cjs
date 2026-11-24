'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const installer = require('../src/extension/installer.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('finds node and directories on PATH', () => {
  const nodeDir = path.dirname(process.execPath);
  assert.ok(installer.nodeExecutableOnPath(`${nodeDir}${path.delimiter}/nope`));
  assert.equal(installer.nodeExecutableOnPath('', process.platform), null);
  assert.equal(installer.isDirectoryOnPath(nodeDir, nodeDir, process.platform), true);
  assert.equal(installer.isDirectoryOnPath(nodeDir, '/nope', process.platform), false);
});

test(
  'installs a working POSIX CLI shim and a stable copy of the CLI',
  { skip: process.platform === 'win32' },
  () => {
    const home = tempDir('flow-inst-home-');
    const appData = tempDir('flow-inst-data-');
    const nodeDir = path.dirname(process.execPath);
    const env = { PATH: nodeDir, HOME: home };

    const result = installer.installCli({
      platform: 'linux',
      env,
      homedir: home,
      extensionPath: REPO_ROOT,
      appDataDir: appData,
    });

    assert.equal(result.ok, true, (result.errors || []).join('\n'));
    assert.equal(result.shimPath, path.join(home, '.local', 'bin', 'flow'));
    assert.equal(result.onPath, false);
    assert.equal(result.nodeFound, true);
    assert.match(result.pathCommand, /\.local\/bin/);
    assert.match(
      result.mcpCommand,
      /claude mcp add --scope user flow -- .*flow\.mjs mcp/,
    );

    const shim = fs.readFileSync(result.shimPath, 'utf8');
    assert.match(shim, /Flow CLI launcher/);
    assert.match(shim, /exec node .*cli\/flow\.mjs/);
    assert.equal(fs.statSync(result.shimPath).mode & 0o777, 0o755);

    assert.ok(fs.existsSync(path.join(appData, 'tools', 'cli', 'flow.mjs')));
    assert.ok(
      fs.existsSync(path.join(appData, 'tools', 'src', 'extension', 'protocol.cjs')),
    );
    assert.ok(
      fs.existsSync(
        path.join(appData, 'tools', 'src', 'extension', 'claudeIntegration.cjs'),
      ),
    );
    assert.ok(fs.existsSync(path.join(appData, 'tools', 'package.json')));

    const version = spawnSync(process.execPath, [result.cliPath, '--version'], {
      env: { ...process.env, FLOW_DATA_DIR: tempDir('flow-inst-cli-') },
      encoding: 'utf8',
    });
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+/);

    const help = spawnSync(process.execPath, [result.cliPath, 'help', '--json'], {
      env: { ...process.env, FLOW_DATA_DIR: tempDir('flow-inst-helps-') },
      encoding: 'utf8',
    });
    assert.equal(help.status, 0, help.stderr);
    const listed = JSON.parse(help.stdout).commands.map((entry) => entry.name);
    assert.ok(listed.includes('apply'));

    const shadowDir = tempDir('flow-inst-shadow-');
    const shadowFile = path.join(shadowDir, 'flow');
    fs.writeFileSync(shadowFile, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const shadowed = installer.installCli({
      platform: 'linux',
      env: {
        PATH: `${shadowDir}${path.delimiter}${result.installDir}${path.delimiter}${nodeDir}`,
        HOME: home,
      },
      homedir: home,
      extensionPath: REPO_ROOT,
      appDataDir: appData,
      force: true,
    });
    assert.equal(shadowed.shadowedBy, shadowFile);

    const onPath = installer.installCli({
      platform: 'linux',
      env: { PATH: `${result.installDir}${path.delimiter}${nodeDir}`, HOME: home },
      homedir: home,
      extensionPath: REPO_ROOT,
      appDataDir: appData,
      force: true,
    });
    assert.equal(onPath.onPath, true);
    assert.equal(
      onPath.mcpCommand,
      'claude mcp add --scope user flow -- flow mcp',
    );
  },
);

test(
  'does not overwrite a foreign flow command without force',
  { skip: process.platform === 'win32' },
  () => {
    const home = tempDir('flow-inst-conflict-');
    const appData = tempDir('flow-inst-conflictd-');
    const dir = path.join(home, '.local', 'bin');
    fs.mkdirSync(dir, { recursive: true });
    const foreign = path.join(dir, 'flow');
    fs.writeFileSync(foreign, '#!/bin/sh\necho someone else\n', { mode: 0o755 });

    const blocked = installer.installCli({
      platform: 'linux',
      env: { PATH: '', HOME: home },
      homedir: home,
      extensionPath: REPO_ROOT,
      appDataDir: appData,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.conflict, true);
    assert.match(fs.readFileSync(foreign, 'utf8'), /someone else/);

    const forced = installer.installCli({
      platform: 'linux',
      env: { PATH: '', HOME: home },
      homedir: home,
      extensionPath: REPO_ROOT,
      appDataDir: appData,
      force: true,
    });
    assert.equal(forced.ok, true);
    assert.match(fs.readFileSync(foreign, 'utf8'), /Flow CLI launcher/);
  },
);

test('refreshes an installed CLI copy after an extension update', () => {
  const home = tempDir('flow-inst-refresh-');
  const appData = tempDir('flow-inst-refreshd-');
  const result = installer.installCli({
    platform: 'linux',
    env: { PATH: '', HOME: home },
    homedir: home,
    extensionPath: REPO_ROOT,
    appDataDir: appData,
  });
  assert.equal(result.ok, true);

  const copied = path.join(appData, 'tools', 'cli', 'flow.mjs');
  fs.writeFileSync(copied, 'BROKEN');
  const refresh = installer.refreshCliTools({
    extensionPath: REPO_ROOT,
    appDataDir: appData,
  });
  assert.equal(refresh.refreshed, true);
  assert.notEqual(fs.readFileSync(copied, 'utf8'), 'BROKEN');

  assert.equal(
    installer.refreshCliTools({
      extensionPath: REPO_ROOT,
      appDataDir: tempDir('flow-inst-empty-'),
    }).refreshed,
    false,
  );
});

test('installs the Claude skill and command, with overwrite protection', () => {
  const claudeHome = tempDir('flow-inst-claude-');
  const first = installer.installClaudeIntegration({ claudeHome });
  assert.equal(first.ok, true);

  const skill = path.join(claudeHome, 'skills', 'flow', 'SKILL.md');
  const command = path.join(claudeHome, 'commands', 'flow-help.md');
  assert.match(fs.readFileSync(skill, 'utf8'), /name: flow/);
  assert.match(fs.readFileSync(command, 'utf8'), /flow help/);

  const blocked = installer.installClaudeIntegration({ claudeHome });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.conflict, true);

  const forced = installer.installClaudeIntegration({ claudeHome, force: true });
  assert.equal(forced.ok, true);
});

test('mcp command uses the shim when its directory is on PATH', () => {
  const appData = tempDir('flow-inst-mcp-');
  const shimDir = '/opt/flow/bin';
  assert.equal(
    installer.mcpCommandFor({
      appDataDir: appData,
      env: { PATH: `${shimDir}${path.delimiter}/usr/bin` },
      platform: 'linux',
      installDir: shimDir,
    }),
    'claude mcp add --scope user flow -- flow mcp',
  );
  assert.match(
    installer.mcpCommandFor({
      appDataDir: appData,
      env: { PATH: '/usr/bin' },
      platform: 'linux',
      installDir: shimDir,
    }),
    /node .*flow\.mjs['"]? mcp/,
  );
});
