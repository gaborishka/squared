import fs from 'node:fs';
import path from 'node:path';

const DATABASE_FILE_NAME = 'database.sqlite';
const UPLOADS_DIR_CANDIDATES = ['uploads', path.join('server', 'storage', 'uploads')];

export interface LegacyDataMigrationOptions {
  legacyRoots: string[];
  currentDataRoot: string;
}

export interface LegacyDataMigrationResult {
  sourceRoot: string | null;
  copiedDatabase: boolean;
  copiedUploads: boolean;
}

function copyFileIfMissing(sourcePath: string, targetPath: string): boolean {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) return false;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function copyDirIfMissing(sourcePath: string, targetPath: string): boolean {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) return false;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.cpSync(sourcePath, targetPath, { recursive: true });
  return true;
}

function resolveUploadsSource(legacyRoot: string): string | null {
  for (const relativePath of UPLOADS_DIR_CANDIDATES) {
    const candidate = path.resolve(legacyRoot, relativePath);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

export function migrateLegacyAppData(options: LegacyDataMigrationOptions): LegacyDataMigrationResult {
  const currentRoot = path.resolve(options.currentDataRoot);
  const seenRoots = new Set<string>();
  let sourceRoot: string | null = null;
  let copiedDatabase = false;
  let copiedUploads = false;

  for (const legacyRootInput of options.legacyRoots) {
    const legacyRoot = path.resolve(legacyRootInput);
    if (legacyRoot === currentRoot || seenRoots.has(legacyRoot)) continue;
    seenRoots.add(legacyRoot);

    const sourceDatabasePath = path.resolve(legacyRoot, DATABASE_FILE_NAME);
    const targetDatabasePath = path.resolve(currentRoot, DATABASE_FILE_NAME);
    const uploadsSource = resolveUploadsSource(legacyRoot);
    const uploadsTarget = path.resolve(currentRoot, 'uploads');

    copiedDatabase = copyFileIfMissing(sourceDatabasePath, targetDatabasePath) || copiedDatabase;
    copiedUploads = (uploadsSource ? copyDirIfMissing(uploadsSource, uploadsTarget) : false) || copiedUploads;

    if (copiedDatabase || copiedUploads) {
      sourceRoot ??= legacyRoot;
    }

    if (copiedDatabase && copiedUploads) {
      break;
    }
  }

  return {
    sourceRoot,
    copiedDatabase,
    copiedUploads,
  };
}
