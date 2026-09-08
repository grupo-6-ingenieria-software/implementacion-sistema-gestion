import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vitest', 'run', '--config', 'tests/renderer/inventory-ui.vitest.config.ts', '--reporter=verbose'],
  { cwd: process.cwd(), encoding: 'utf8', env: process.env },
);
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.status !== 0) process.exit(result.status ?? 1);
