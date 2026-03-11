import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runStep(args) {
  const result = spawnSync(npmExecutable, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Command failed: npm ${args.join(' ')}`);
  }
}

function runNpx(args) {
  const result = spawnSync('npx', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Command failed: npx ${args.join(' ')}`);
  }
}

function patchNativeModule() {
  const releaseDirs = ['release/mac-arm64', 'release/mac-x64', 'release/mac'];
  const nativeModuleRelPath =
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node';

  const source = path.resolve(projectRoot, nativeModuleRelPath);
  if (!fs.existsSync(source)) {
    console.warn('No local better-sqlite3 native module found, skipping patch.');
    return;
  }

  for (const dir of releaseDirs) {
    const fullDir = path.resolve(projectRoot, dir);
    if (!fs.existsSync(fullDir)) continue;

    const appDir = fs.readdirSync(fullDir).find(
      (f) => f.endsWith('.app'),
    );
    if (!appDir) continue;

    const dest = path.resolve(
      projectRoot,
      dir,
      appDir,
      'Contents/Resources/app.asar.unpacked',
      nativeModuleRelPath,
    );
    if (!fs.existsSync(dest)) continue;

    fs.copyFileSync(source, dest);
    console.log(`Patched native module in ${dir}/${appDir}`);
  }
}

let buildError = null;

try {
  runStep(['run', 'clean']);
  runStep(['run', 'build']);
  runStep(['run', 'copy:desktop-resources']);
  runNpx(['electron-rebuild', '-f', '-o', 'better-sqlite3']);
  runStep(['run', 'package:desktop']);
  patchNativeModule();
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
