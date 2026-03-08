import Database from 'better-sqlite3';
import { applySchema, DATABASE_PATH, prepareDatabaseFile } from './migrations.js';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;
  prepareDatabaseFile();
  db = new Database(DATABASE_PATH);
  applySchema(db);
  return db;
}
