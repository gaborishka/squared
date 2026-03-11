import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const sourcePngPath = path.resolve(projectRoot, 'squared_icon.png');
const outputIcnsPath = path.resolve(projectRoot, 'build/icon.icns');

// Percentage of each side reserved for padding (macOS masks ~4-5% on each edge)
const PADDING_RATIO = 0.06;

if (process.platform !== 'darwin') {
  throw new Error('App icon generation requires macOS because it uses sips and iconutil.');
}

if (!fs.existsSync(sourcePngPath)) {
  throw new Error(`Missing app icon source: ${sourcePngPath}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

async function createPaddedIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const img = await loadImage(sourcePngPath);

  const pad = Math.round(size * PADDING_RATIO);
  const inner = size - pad * 2;
  ctx.drawImage(img, pad, pad, inner, inner);

  return canvas.toBuffer('image/png');
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'squared-app-icon-'));
const iconsetDir = path.resolve(tempRoot, 'squared.iconset');

try {
  fs.mkdirSync(path.dirname(outputIcnsPath), { recursive: true });
  fs.mkdirSync(iconsetDir, { recursive: true });

  for (const size of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.resolve(iconsetDir, `icon_${size}x${size}.png`), await createPaddedIcon(size));
    const retinaSize = size * 2;
    fs.writeFileSync(path.resolve(iconsetDir, `icon_${size}x${size}@2x.png`), await createPaddedIcon(retinaSize));
  }

  run('iconutil', ['-c', 'icns', iconsetDir, '-o', outputIcnsPath]);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
