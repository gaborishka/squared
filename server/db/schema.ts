export const V2_SCHEMA = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    content TEXT DEFAULT '',
    file_path TEXT,
    file_type TEXT,
    slide_count INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS project_slides (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    slide_number INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    speaker_notes TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, slide_number)
  );

  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    mode TEXT NOT NULL,
    duration INTEGER NOT NULL,
    avg_pace_wpm REAL,
    avg_confidence REAL,
    filler_word_count INTEGER NOT NULL DEFAULT 0,
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
    severity TEXT NOT NULL DEFAULT 'info',
    category TEXT,
    FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS run_slide_analyses (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    slide_number INTEGER NOT NULL,
    issues_json TEXT NOT NULL DEFAULT '[]',
    best_phrase TEXT NOT NULL DEFAULT '',
    risk_level TEXT NOT NULL DEFAULT 'safe',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS risk_segments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    slide_number INTEGER,
    risk_type TEXT NOT NULL,
    frequency INTEGER NOT NULL DEFAULT 0,
    avg_severity REAL NOT NULL DEFAULT 0,
    last_occurrence DATETIME NOT NULL,
    best_recovery TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS game_plans (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    run_count INTEGER NOT NULL DEFAULT 0,
    plan_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_runs_project_created_at ON runs(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_feedbacks_run_id ON feedbacks(run_id);
  CREATE INDEX IF NOT EXISTS idx_slide_analyses_run_id ON run_slide_analyses(run_id);
  CREATE INDEX IF NOT EXISTS idx_risk_segments_project_id ON risk_segments(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_slides_project_number ON project_slides(project_id, slide_number);
`;
