import db from './schema.ts';

// ── Types ──

export interface RunData {
  id: string;
  project_id?: string | null;
  mode: 'rehearsal' | 'presentation';
  duration: number;
  avg_pace_wpm?: number | null;
  avg_confidence?: number | null;
  filler_word_count?: number | null;
  eye_contact_pct?: number | null;
  posture_good_pct?: number | null;
  overall_score?: number | null;
}

export interface FeedbackData {
  id: string;
  run_id: string;
  timestamp: string;
  message: string;
  slide_number?: number | null;
  severity?: string | null;
  category?: string | null;
}

export interface ProjectData {
  id: string;
  name: string;
  description?: string | null;
  content?: string | null;
  file_path?: string | null;
  file_type?: string | null;
  slide_count?: number | null;
}

export interface ProjectSlideData {
  id: string;
  project_id: string;
  slide_number: number;
  title?: string | null;
  content?: string | null;
  speaker_notes?: string | null;
}

// ── Runs ──

const insertRunStmt = db.prepare(
  'INSERT INTO runs (id, project_id, mode, duration, avg_pace_wpm, avg_confidence, filler_word_count, eye_contact_pct, posture_good_pct, overall_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
);
const insertFeedbackStmt = db.prepare(
  'INSERT INTO feedbacks (id, run_id, timestamp, message, slide_number, severity, category) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const getRunsStmt = db.prepare('SELECT * FROM runs ORDER BY created_at DESC');
const getRunsByProjectStmt = db.prepare('SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC');
const getRunStmt = db.prepare('SELECT * FROM runs WHERE id = ?');
const getFeedbacksStmt = db.prepare('SELECT * FROM feedbacks WHERE run_id = ?');

export function saveRun(run: RunData, feedbacks: Omit<FeedbackData, 'run_id'>[]) {
  const transaction = db.transaction(() => {
    insertRunStmt.run(
      run.id, run.project_id ?? null, run.mode, run.duration,
      run.avg_pace_wpm ?? null, run.avg_confidence ?? null,
      run.filler_word_count ?? null, run.eye_contact_pct ?? null,
      run.posture_good_pct ?? null, run.overall_score ?? null
    );
    for (const fb of feedbacks) {
      insertFeedbackStmt.run(
        fb.id, run.id, fb.timestamp, fb.message,
        fb.slide_number ?? null, fb.severity ?? null, fb.category ?? null
      );
    }
  });
  transaction();
}

export function getRuns(projectId?: string) {
  const runs = projectId
    ? getRunsByProjectStmt.all(projectId) as (RunData & { created_at: string })[]
    : getRunsStmt.all() as (RunData & { created_at: string })[];

  return runs.map(run => ({
    ...run,
    feedbacks: getFeedbacksStmt.all(run.id) as FeedbackData[]
  }));
}

export function getRun(id: string) {
  const run = getRunStmt.get(id) as (RunData & { created_at: string }) | undefined;
  if (!run) return null;

  const feedbacks = getFeedbacksStmt.all(run.id) as FeedbackData[];
  return {
    ...run,
    feedbacks: feedbacks.map(({ run_id, ...fb }) => fb)
  };
}

// ── Projects ──

const insertProjectStmt = db.prepare(
  'INSERT INTO projects (id, name, description, content, file_path, file_type, slide_count) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const getProjectsStmt = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC');
const getProjectStmt = db.prepare('SELECT * FROM projects WHERE id = ?');
const updateProjectStmt = db.prepare(
  'UPDATE projects SET name = ?, description = ?, content = ?, file_path = ?, file_type = ?, slide_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
);
const deleteProjectStmt = db.prepare('DELETE FROM projects WHERE id = ?');
const getProjectSlidesStmt = db.prepare('SELECT * FROM project_slides WHERE project_id = ? ORDER BY slide_number');
const insertSlideStmt = db.prepare(
  'INSERT INTO project_slides (id, project_id, slide_number, title, content, speaker_notes) VALUES (?, ?, ?, ?, ?, ?)'
);
const deleteProjectSlidesStmt = db.prepare('DELETE FROM project_slides WHERE project_id = ?');
const countRunsByProjectStmt = db.prepare('SELECT COUNT(*) as count FROM runs WHERE project_id = ?');
const latestRunScoreStmt = db.prepare('SELECT overall_score FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1');

export function createProject(project: ProjectData) {
  insertProjectStmt.run(
    project.id, project.name, project.description ?? null,
    project.content ?? null, project.file_path ?? null,
    project.file_type ?? null, project.slide_count ?? null
  );
}

export function getProjects() {
  const projects = getProjectsStmt.all() as (ProjectData & { created_at: string; updated_at: string })[];
  return projects.map(p => {
    const runCount = (countRunsByProjectStmt.get(p.id) as { count: number }).count;
    const latestScore = (latestRunScoreStmt.get(p.id) as { overall_score: number | null } | undefined)?.overall_score ?? null;
    return { ...p, run_count: runCount, latest_score: latestScore };
  });
}

export function getProject(id: string) {
  const project = getProjectStmt.get(id) as (ProjectData & { created_at: string; updated_at: string }) | undefined;
  if (!project) return null;

  const slides = getProjectSlidesStmt.all(id) as ProjectSlideData[];
  const runCount = (countRunsByProjectStmt.get(id) as { count: number }).count;
  const latestScore = (latestRunScoreStmt.get(id) as { overall_score: number | null } | undefined)?.overall_score ?? null;

  return { ...project, slides, run_count: runCount, latest_score: latestScore };
}

export function updateProject(id: string, data: Partial<ProjectData>) {
  const existing = getProjectStmt.get(id) as ProjectData | undefined;
  if (!existing) return null;

  updateProjectStmt.run(
    data.name ?? existing.name,
    data.description ?? existing.description ?? null,
    data.content ?? existing.content ?? null,
    data.file_path ?? existing.file_path ?? null,
    data.file_type ?? existing.file_type ?? null,
    data.slide_count ?? existing.slide_count ?? null,
    id
  );
  return getProject(id);
}

export function deleteProject(id: string) {
  deleteProjectStmt.run(id);
}

export function setProjectSlides(projectId: string, slides: Omit<ProjectSlideData, 'project_id'>[]) {
  const transaction = db.transaction(() => {
    deleteProjectSlidesStmt.run(projectId);
    for (const slide of slides) {
      insertSlideStmt.run(
        slide.id, projectId, slide.slide_number,
        slide.title ?? null, slide.content ?? null, slide.speaker_notes ?? null
      );
    }
  });
  transaction();
}
