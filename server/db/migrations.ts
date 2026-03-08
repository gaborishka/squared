import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { V2_SCHEMA } from './schema.js';

export const DATABASE_PATH = path.resolve(process.cwd(), 'database.sqlite');

function listTables(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  const db = new Database(filePath, { readonly: true });
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  } finally {
    db.close();
  }
}

function getBackupPath(): string {
  const base = path.resolve(process.cwd(), 'database.legacy.sqlite');
  if (!fs.existsSync(base)) return base;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.resolve(process.cwd(), `database.legacy.${stamp}.sqlite`);
}

export function prepareDatabaseFile(): void {
  const tables = listTables(DATABASE_PATH);
  const isLegacy =
    tables.length > 0 &&
    tables.includes('runs') &&
    tables.includes('feedbacks') &&
    !tables.includes('projects');

  if (isLegacy) {
    fs.renameSync(DATABASE_PATH, getBackupPath());
  }
}

export function applySchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(V2_SCHEMA);
}
