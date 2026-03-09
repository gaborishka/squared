import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildLocalUrl, findAvailablePort } from '../electron/runtime.ts';
import { migrateLegacyAppData } from '../server/config/dataMigration.ts';

async function listen(server: net.Server, port: number, host?: string): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine listening port.');
  }
  return address.port;
}

async function close(server: net.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

test('findAvailablePort keeps the preferred port when it is free', async () => {
  const probe = net.createServer();
  const preferredPort = await listen(probe, 0, '127.0.0.1');
  await close(probe);

  const selectedPort = await findAvailablePort(preferredPort);

  assert.equal(selectedPort, preferredPort);
  assert.equal(buildLocalUrl(selectedPort), `http://127.0.0.1:${preferredPort}`);
});

test('findAvailablePort falls back when the preferred port is occupied', async () => {
  const occupiedServer = net.createServer();
  const occupiedPort = await listen(occupiedServer, 0);

  try {
    const selectedPort = await findAvailablePort(occupiedPort);
    assert.notEqual(selectedPort, occupiedPort);
    assert.match(buildLocalUrl(selectedPort), /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await close(occupiedServer);
  }
});

test('migrateLegacyAppData copies database and nested uploads once', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'squared-migrate-'));
  const legacyRoot = path.join(tempRoot, 'legacy');
  const currentRoot = path.join(tempRoot, 'current');
  const legacyUploads = path.join(legacyRoot, 'server', 'storage', 'uploads');
  const currentUploads = path.join(currentRoot, 'uploads');

  await fs.mkdir(legacyUploads, { recursive: true });
  await fs.writeFile(path.join(legacyRoot, 'database.sqlite'), 'legacy-db');
  await fs.writeFile(path.join(legacyUploads, 'deck.pptx'), 'slides');

  const result = migrateLegacyAppData({
    legacyRoots: [legacyRoot],
    currentDataRoot: currentRoot,
  });

  assert.equal(result.copiedDatabase, true);
  assert.equal(result.copiedUploads, true);
  assert.equal(result.sourceRoot, legacyRoot);
  assert.equal(await fs.readFile(path.join(currentRoot, 'database.sqlite'), 'utf8'), 'legacy-db');
  assert.equal(await fs.readFile(path.join(currentUploads, 'deck.pptx'), 'utf8'), 'slides');
});

test('migrateLegacyAppData does not overwrite existing current data', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'squared-migrate-'));
  const legacyRoot = path.join(tempRoot, 'legacy');
  const currentRoot = path.join(tempRoot, 'current');
  const legacyUploads = path.join(legacyRoot, 'uploads');
  const currentUploads = path.join(currentRoot, 'uploads');

  await fs.mkdir(legacyUploads, { recursive: true });
  await fs.mkdir(currentUploads, { recursive: true });
  await fs.writeFile(path.join(legacyRoot, 'database.sqlite'), 'legacy-db');
  await fs.writeFile(path.join(legacyUploads, 'deck.pptx'), 'legacy-slides');
  await fs.writeFile(path.join(currentRoot, 'database.sqlite'), 'current-db');
  await fs.writeFile(path.join(currentUploads, 'deck.pptx'), 'current-slides');

  const result = migrateLegacyAppData({
    legacyRoots: [legacyRoot],
    currentDataRoot: currentRoot,
  });

  assert.equal(result.copiedDatabase, false);
  assert.equal(result.copiedUploads, false);
  assert.equal(await fs.readFile(path.join(currentRoot, 'database.sqlite'), 'utf8'), 'current-db');
  assert.equal(await fs.readFile(path.join(currentUploads, 'deck.pptx'), 'utf8'), 'current-slides');
});
