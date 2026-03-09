import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { getDatabasePath, getLegacyDatabasePath } from '../config/paths.js';
import { V2_SCHEMA } from './schema.js';

export const DATABASE_PATH = getDatabasePath();

export interface DatabasePreparationResult {
  legacyImportPath: string | null;
}

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
  const base = getLegacyDatabasePath();
  if (!fs.existsSync(base)) return base;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.resolve(path.dirname(base), `database.legacy.${stamp}.sqlite`);
}

function readLegacyRuns(legacyDb: Database.Database) {
  return legacyDb.prepare('SELECT id, mode, duration, created_at FROM runs').all() as Array<{
    id: string;
    mode: string;
    duration: number;
    created_at: string;
  }>;
}

function readLegacyFeedbacks(legacyDb: Database.Database) {
  return legacyDb.prepare('SELECT id, run_id, timestamp, message FROM feedbacks').all() as Array<{
    id: string;
    run_id: string;
    timestamp: string;
    message: string;
  }>;
}

export function prepareDatabaseFile(): DatabasePreparationResult {
  fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
  const tables = listTables(DATABASE_PATH);
  const isLegacy =
    tables.length > 0 &&
    tables.includes('runs') &&
    tables.includes('feedbacks') &&
    !tables.includes('projects');

  if (isLegacy) {
    const backupPath = getBackupPath();
    fs.renameSync(DATABASE_PATH, backupPath);
    return { legacyImportPath: backupPath };
  }

  return { legacyImportPath: null };
}

export function applySchema(db: Database.Database, legacyImportPath: string | null = null): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(V2_SCHEMA);

  if (!legacyImportPath || !fs.existsSync(legacyImportPath)) return;

  const legacyDb = new Database(legacyImportPath, { readonly: true });
  try {
    const runs = readLegacyRuns(legacyDb);
    const feedbacks = readLegacyFeedbacks(legacyDb);
    const insertRun = db.prepare(`
      INSERT OR IGNORE INTO runs (
        id, project_id, mode, duration, avg_pace_wpm, avg_confidence, filler_word_count,
        eye_contact_pct, posture_good_pct, overall_score, created_at
      ) VALUES (
        @id, NULL, @mode, @duration, NULL, NULL, 0,
        NULL, NULL, NULL, @created_at
      )
    `);
    const insertFeedback = db.prepare(`
      INSERT OR IGNORE INTO feedbacks (
        id, run_id, timestamp, message, slide_number, severity, category
      ) VALUES (
        @id, @run_id, @timestamp, @message, NULL, 'info', NULL
      )
    `);

    db.transaction(() => {
      for (const run of runs) insertRun.run(run);
      for (const feedback of feedbacks) insertFeedback.run(feedback);
    })();
  } finally {
    legacyDb.close();
  }
}
