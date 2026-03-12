import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

const projectRoot = process.cwd();
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

for (const envFile of ['.env.local', '.env']) {
  const envPath = path.resolve(projectRoot, envFile);
  dotenv.config({ path: envPath, override: false });
}

function runStep(args) {
  const result = spawnSync(npmExecutable, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Command failed: npm ${args.join(' ')}`);
  }
}

async function writeDesktopRuntimeConfig() {
  const hostedAppUrl = process.env.APP_URL?.trim();
  if (!hostedAppUrl) {
    throw new Error('APP_URL is required to package the hosted Electron desktop app.');
  }

  const runtimeConfigPath = path.resolve(projectRoot, 'dist-resources/electron/runtime-config.json');
  await fs.mkdir(path.dirname(runtimeConfigPath), { recursive: true });
  await fs.writeFile(runtimeConfigPath, JSON.stringify({ hostedAppUrl }, null, 2));
}

runStep(['run', 'clean']);
runStep(['run', 'build']);
runStep(['run', 'copy:desktop-resources']);
await writeDesktopRuntimeConfig();
runStep(['run', 'package:desktop']);
