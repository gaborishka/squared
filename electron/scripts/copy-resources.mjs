import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const projectRoot = path.resolve(currentDir, '..', '..');
const distResourcesDir = path.resolve(projectRoot, 'dist-resources');

async function copyResource(from, to) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.cp(from, to, { recursive: true });
}

await fs.rm(distResourcesDir, { recursive: true, force: true });

await copyResource(
  path.resolve(projectRoot, 'electron/overlay.html'),
  path.resolve(distResourcesDir, 'electron/overlay.html'),
);

await copyResource(
  path.resolve(projectRoot, 'electron/assets'),
  path.resolve(distResourcesDir, 'electron/assets'),
);

console.log('Copied Electron packaging resources to dist-resources.');
