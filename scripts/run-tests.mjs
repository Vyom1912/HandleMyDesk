// Runs Vitest. On Windows, a terminal opened at "f:\..." instead of "F:\..." makes Vitest load
// itself twice and fail with "failed to find the runner", so start it from the upper-case path.
import { spawnSync } from 'child_process';
import path from 'path';

const cwd = /^[a-z]:/.test(process.cwd()) ? process.cwd()[0].toUpperCase() + process.cwd().slice(1) : process.cwd();
const vitest = path.join(cwd, 'node_modules', 'vitest', 'vitest.mjs');
const result = spawnSync(process.execPath, [vitest, 'run', ...process.argv.slice(2)], { cwd, stdio: 'inherit' });
process.exit(result.status ?? 1);
