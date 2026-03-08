import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'database.sqlite');
const db = new Database(dbPath);

// Enable WAL mode and foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    content TEXT,
    file_path TEXT,
    file_type TEXT,
    slide_count INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS project_slides (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    slide_number INTEGER NOT NULL,
    title TEXT,
    content TEXT,
    speaker_notes TEXT,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    mode TEXT NOT NULL,
    duration INTEGER NOT NULL,
    avg_pace_wpm REAL,
    avg_confidence REAL,
    filler_word_count INTEGER,
    eye_contact_pct REAL,
    posture_good_pct REAL,
    overall_score REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS feedbacks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    message TEXT NOT NULL,
    slide_number INTEGER,
    severity TEXT,
    category TEXT,
    FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS risk_segments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    slide_number INTEGER,
    risk_type TEXT NOT NULL,
    frequency INTEGER,
    avg_severity REAL,
    last_occurrence DATETIME,
    best_recovery TEXT,
    notes TEXT,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS game_plans (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    run_count INTEGER,
    plan_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );
`);

export default db;
