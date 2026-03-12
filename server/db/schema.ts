export const POSTGRES_SCHEMA = `
  CREATE EXTENSION IF NOT EXISTS vector;

  CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    file_path TEXT,
    file_type TEXT,
    slide_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS project_slides (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    slide_number INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    speaker_notes TEXT NOT NULL DEFAULT '',
    UNIQUE(project_id, slide_number)
  );

  CREATE TABLE IF NOT EXISTS runs (
    id UUID PRIMARY KEY,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    mode TEXT NOT NULL,
    duration INTEGER NOT NULL,
    avg_pace_wpm DOUBLE PRECISION,
    avg_confidence DOUBLE PRECISION,
    filler_word_count INTEGER NOT NULL DEFAULT 0,
    eye_contact_pct DOUBLE PRECISION,
    posture_good_pct DOUBLE PRECISION,
    overall_score DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS feedbacks (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    timestamp TEXT NOT NULL,
    message TEXT NOT NULL,
    slide_number INTEGER,
    severity TEXT NOT NULL DEFAULT 'info',
    category TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE feedbacks
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

  CREATE TABLE IF NOT EXISTS run_slide_analyses (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    slide_number INTEGER NOT NULL,
    issues_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    best_phrase TEXT NOT NULL DEFAULT '',
    risk_level TEXT NOT NULL DEFAULT 'safe',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS run_artifacts (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    start_ms INTEGER,
    end_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS run_transcript_segments (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    slide_number INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS run_memory_chunks (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    artifact_id UUID REFERENCES run_artifacts(id) ON DELETE SET NULL,
    source_type TEXT NOT NULL,
    slide_number INTEGER,
    start_ms INTEGER,
    end_ms INTEGER,
    text_for_embedding TEXT NOT NULL DEFAULT '',
    cue_text TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'info',
    risk_level TEXT,
    embedding VECTOR(256) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS risk_segments (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    slide_number INTEGER,
    risk_type TEXT NOT NULL,
    frequency INTEGER NOT NULL DEFAULT 0,
    avg_severity DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_occurrence TIMESTAMPTZ NOT NULL,
    best_recovery TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS game_plans (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    run_count INTEGER NOT NULL DEFAULT 0,
    plan_json JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_runs_project_created_at ON runs(project_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_feedbacks_run_id ON feedbacks(run_id);
  CREATE INDEX IF NOT EXISTS idx_slide_analyses_run_id ON run_slide_analyses(run_id);
  CREATE INDEX IF NOT EXISTS idx_run_artifacts_run_id ON run_artifacts(run_id);
  CREATE INDEX IF NOT EXISTS idx_transcript_segments_run_id ON run_transcript_segments(run_id);
  CREATE INDEX IF NOT EXISTS idx_memory_chunks_project_id ON run_memory_chunks(project_id);
  CREATE INDEX IF NOT EXISTS idx_memory_chunks_project_slide ON run_memory_chunks(project_id, slide_number);
  CREATE INDEX IF NOT EXISTS idx_memory_chunks_run_id ON run_memory_chunks(run_id);
  CREATE INDEX IF NOT EXISTS idx_risk_segments_project_id ON risk_segments(project_id);
  CREATE INDEX IF NOT EXISTS idx_project_slides_project_number ON project_slides(project_id, slide_number);
  CREATE INDEX IF NOT EXISTS idx_run_memory_chunks_embedding ON run_memory_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
`;
