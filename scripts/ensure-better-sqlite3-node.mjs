import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const force = process.argv.includes('--force');

function rebuildForNode() {
  const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawnSync(npmExecutable, ['rebuild', 'better-sqlite3'], {
    stdio: 'inherit',
  });
}

function isAbiMismatch(error) {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === 'object' && error && 'code' in error ? error.code : null;
  return code === 'ERR_DLOPEN_FAILED' || message.includes('NODE_MODULE_VERSION');
}

try {
  if (!force) {
    require('better-sqlite3');
    console.log(`better-sqlite3 is ready for Node ABI ${process.versions.modules}.`);
    process.exit(0);
  }
} catch (error) {
  if (!isAbiMismatch(error)) {
    throw error;
  }

  console.warn('better-sqlite3 needs a Node rebuild. Restoring the native module for the current runtime...');
}

const result = rebuildForNode();
if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
