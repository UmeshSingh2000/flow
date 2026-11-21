import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:extension']);

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const version = packageJson.version;
const vsixName = `flow-${version}.vsix`;
const vsixPath = path.resolve(vsixName);

run(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['--no-install', '@vscode/vsce', 'package', '--out', vsixName],
);

if (!existsSync(vsixPath)) {
  throw new Error(`VSIX was not created at ${vsixPath}`);
}

const codeCommand =
  process.env.VSCODE_EXECUTABLE ||
  (process.platform === 'win32' ? 'code.cmd' : 'code');

run(codeCommand, ['--install-extension', vsixPath, '--force']);

spawnSync(codeCommand, ['--reuse-window', '--command', 'workbench.action.reloadWindow'], {
  stdio: 'ignore',
  shell: process.platform === 'win32',
});

console.log(`\nFlow ${version} was packaged and installed: ${vsixPath}`);
