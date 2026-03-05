import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'database.sqlite');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    duration INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS feedbacks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    message TEXT NOT NULL,
    FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
  );
`);

export interface RunData {
    id: string;
    mode: 'rehearsal' | 'presentation';
    duration: number; // in milliseconds
}

export interface FeedbackData {
    id: string;
    run_id: string;
    timestamp: string; // "01:23"
    message: string;
}

export function saveRun(run: RunData, feedbacks: Omit<FeedbackData, 'run_id'>[]) {
    const insertRun = db.prepare('INSERT INTO runs (id, mode, duration) VALUES (?, ?, ?)');
    const insertFeedback = db.prepare('INSERT INTO feedbacks (id, run_id, timestamp, message) VALUES (?, ?, ?, ?)');

    const transaction = db.transaction(() => {
        insertRun.run(run.id, run.mode, run.duration);
        for (const fb of feedbacks) {
            insertFeedback.run(fb.id, run.id, fb.timestamp, fb.message);
        }
    });

    transaction();
}

export function getRuns(): (RunData & { created_at: string; feedbacks: FeedbackData[] })[] {
    const getRunsStmt = db.prepare('SELECT * FROM runs ORDER BY created_at DESC');
    const getFeedbacksStmt = db.prepare('SELECT * FROM feedbacks WHERE run_id = ?');

    const runs = getRunsStmt.all() as (RunData & { created_at: string })[];

    return runs.map(run => ({
        ...run,
        feedbacks: getFeedbacksStmt.all(run.id) as FeedbackData[]
    }));
}

export function getRun(id: string): (RunData & { created_at: string; feedbacks: Omit<FeedbackData, 'run_id'>[] }) | null {
    const getRunStmt = db.prepare('SELECT * FROM runs WHERE id = ?');
    const getFeedbacksStmt = db.prepare('SELECT * FROM feedbacks WHERE run_id = ?');

    const run = getRunStmt.get(id) as (RunData & { created_at: string }) | undefined;
    if (!run) return null;

    const feedbacks = getFeedbacksStmt.all(run.id) as FeedbackData[];
    return {
        ...run,
        feedbacks: feedbacks.map(({ run_id, ...fb }) => fb)
    };
}
