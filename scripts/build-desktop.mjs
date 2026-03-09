import { spawnSync } from 'node:child_process';

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runStep(args) {
  const result = spawnSync(npmExecutable, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Command failed: npm ${args.join(' ')}`);
  }
}

let buildError = null;

try {
  runStep(['run', 'clean']);
  runStep(['run', 'build']);
  runStep(['run', 'copy:desktop-resources']);
  runStep(['run', 'package:desktop']);
} catch (error) {
  buildError = error;
} finally {
  try {
    runStep(['run', 'native:restore-node']);
  } catch (restoreError) {
    if (buildError) {
      console.error('Failed to restore better-sqlite3 for Node after build failure.', restoreError);
    } else {
      throw restoreError;
    }
  }
}

if (buildError) {
  throw buildError;
}
