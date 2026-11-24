'use strict';

/**
 * One-click setup orchestration: CLI, Claude skill, and MCP registration.
 *
 * The only process this module runs is the official Claude Code CLI
 * (`claude mcp list` / `claude mcp add`) with fixed arguments. It never runs a
 * shell command supplied by a user, and it never writes to a workspace.
 */

const fs = require('fs');
const path = require('path');
const installer = require('./installer.cjs');

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

function isFlowSkillFile(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (file.endsWith('SKILL.md')) return /^name:\s*flow\s*$/m.test(text);
    return /Flow terminal commands/.test(text) || /flow help --json/.test(text);
  } catch {
    return false;
  }
}

function runProcess(execFileImpl, file, args, options) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      execFileImpl(file, args, options, (error, stdout, stderr) => {
        done({
          ok: !error,
          error: error || null,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      });
    } catch (error) {
      done({ ok: false, error, stdout: '', stderr: '' });
    }
  });
}

function findClaude(env = process.env, platform = process.platform) {
  return installer.findExecutable('claude', env.PATH, platform);
}

/** Quotes one fixed argument for a Windows cmd.exe command line. */
function winQuote(value) {
  const text = String(value);
  if (/[\s"&|<>^]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Claude Code is usually a .cmd shim on Windows, which execFile cannot start
 * directly. Run it through cmd.exe with fixed, quoted arguments.
 */
function runClaude(execFileImpl, claudePath, args, options, platform) {
  if (platform === 'win32') {
    const commandLine = [claudePath, ...args].map(winQuote).join(' ');
    const comspec = options.comspec || process.env.ComSpec || 'cmd.exe';
    return runProcess(
      execFileImpl,
      comspec,
      ['/d', '/s', '/c', commandLine],
      options,
    );
  }
  return runProcess(execFileImpl, claudePath, args, options);
}

async function registerMcp(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const appDataDir = options.appDataDir;
  const execFileImpl = options.execFileImpl || require('child_process').execFile;
  const command = installer.mcpCommandFor({
    appDataDir,
    env,
    platform,
    installDir: options.installDir,
    forceExplicit: options.forceExplicit === true,
  });

  const claudePath = findClaude(env, platform);
  if (!claudePath) {
    return { status: 'claude-missing', command };
  }
  if (!appDataDir || !fs.existsSync(installer.cliEntryPath(appDataDir))) {
    return { status: 'cli-missing', command };
  }

  const execOptions = {
    cwd: options.workspacePath || process.cwd(),
    timeout: 30_000,
    windowsHide: true,
    env: { ...process.env, ...env },
  };

  const list = await runClaude(
    execFileImpl,
    claudePath,
    ['mcp', 'list'],
    execOptions,
    platform,
  );
  const listed = list.stdout.replace(ANSI_PATTERN, '');
  if (/^\s*flow\s*:/m.test(listed)) {
    return { status: 'already', command };
  }

  const launchArgs = installer.mcpLaunchArgs({
    appDataDir,
    env,
    platform,
    installDir: options.installDir,
    forceExplicit: options.forceExplicit === true,
  });
  const add = await runClaude(
    execFileImpl,
    claudePath,
    ['mcp', 'add', '--scope', 'user', 'flow', '--', ...launchArgs],
    execOptions,
    platform,
  );
  if (add.ok) return { status: 'added', command };

  const text = `${add.stdout}\n${add.stderr}`.replace(ANSI_PATTERN, '').trim();
  if (/already exists|already configured|already added/i.test(text)) {
    return { status: 'already', command };
  }
  return {
    status: 'failed',
    command,
    detail:
      text ||
      (add.error && add.error.message) ||
      'The claude mcp add command failed.',
  };
}

async function setupAll(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const homedir = options.homedir;
  const extensionPath = options.extensionPath;
  const appDataDir = options.appDataDir;

  const cli = installer.installCli({
    extensionPath,
    appDataDir,
    env,
    platform,
    homedir,
    force: options.forceCli === true,
    version: options.version,
  });

  let skill = installer.installClaudeIntegration({
    env,
    platform,
    homedir,
    force: options.forceSkill === true,
  });
  let skillUpgraded = false;
  if (!skill.ok && skill.conflict) {
    const ours = skill.files.every(isFlowSkillFile);
    if (ours) {
      skill = installer.installClaudeIntegration({
        env,
        platform,
        homedir,
        force: true,
      });
      skillUpgraded = true;
    }
  }

  let mcp;
  if (cli.ok) {
    mcp = await registerMcp({
      appDataDir,
      workspacePath: options.workspacePath,
      env,
      platform,
      execFileImpl: options.execFileImpl,
      installDir: cli.installDir,
      forceExplicit: Boolean(cli.shadowedBy),
    });
  } else {
    mcp = {
      status: 'cli-missing',
      command: installer.mcpCommandFor({ appDataDir, env, platform }),
    };
  }

  return {
    ok: cli.ok && skill.ok,
    cli,
    skill,
    skillUpgraded,
    mcp,
    platform,
  };
}

function isSetupComplete(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const paths = installer.installPaths({ platform, env, homedir: options.homedir });
  const cliEntry = options.appDataDir
    ? installer.cliEntryPath(options.appDataDir)
    : null;
  const cliReady = Boolean(
    cliEntry && fs.existsSync(cliEntry) && fs.existsSync(paths.file),
  );
  const claudeHome = installer.claudeHome(env, platform, options.homedir);
  const skillReady = fs.existsSync(
    path.join(claudeHome, 'skills', 'flow', 'SKILL.md'),
  );
  return { cliReady, skillReady, complete: cliReady && skillReady };
}

module.exports = {
  findClaude,
  registerMcp,
  setupAll,
  isSetupComplete,
  isFlowSkillFile,
  winQuote,
};
