import path from 'node:path';

function resolveDataRoot(): string {
  const configuredRoot = process.env.SQUARED_DATA_DIR?.trim();
  if (configuredRoot) {
    return path.resolve(configuredRoot);
  }

  return process.cwd();
}

export function getDataRoot(): string {
  return resolveDataRoot();
}

export function getDatabasePath(): string {
  return path.resolve(resolveDataRoot(), 'database.sqlite');
}

export function getLegacyDatabasePath(): string {
  return path.resolve(resolveDataRoot(), 'database.legacy.sqlite');
}

export function getUploadsDir(): string {
  return path.resolve(resolveDataRoot(), 'uploads');
}
