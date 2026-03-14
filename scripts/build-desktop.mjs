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
  const backendBaseUrl =
    process.env.DESKTOP_API_BASE_URL?.trim()
    || process.env.VITE_API_BASE_URL?.trim()
    || process.env.APP_URL?.trim();
  if (!backendBaseUrl) {
    throw new Error('DESKTOP_API_BASE_URL, VITE_API_BASE_URL, or APP_URL is required to package the desktop app. It should point at the backend base URL desktop should use.');
  }
  const runtimeConfigPath = path.resolve(projectRoot, 'dist-resources/electron/runtime-config.json');
  await fs.mkdir(path.dirname(runtimeConfigPath), { recursive: true });
  const capturableOverlays = process.env.VITE_FORCE_OVERLAY === 'true';
  await fs.writeFile(runtimeConfigPath, JSON.stringify({ apiBaseUrl: backendBaseUrl, capturableOverlays }, null, 2));
}

runStep(['run', 'clean']);
runStep(['run', 'build']);
runStep(['run', 'copy:desktop-resources']);
await writeDesktopRuntimeConfig();
runStep(['run', 'package:desktop']);
