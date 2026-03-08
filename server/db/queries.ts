import crypto from 'node:crypto';
import type {
  GamePlan,
  ProjectDetails,
  ProjectInput,
  ProjectSlide,
  ProjectSummary,
  RiskSegment,
  RunDetails,
  RunFeedback,
  RunSlideAnalysis,
  RunSummary,
  SaveRunPayload,
} from '../../shared/types.js';
import { getDatabase } from './database.js';

type ProjectRow = {
  id: string;
  name: string;
  description: string | null;
  content: string | null;
  file_path: string | null;
  file_type: ProjectSummary['fileType'];
  slide_count: number;
  created_at: string;
  updated_at: string;
  run_count: number;
  rehearsal_run_count: number;
  presentation_run_count: number;
  last_overall_score: number | null;
};

type ProjectSlideRow = {
  id: string;
  project_id: string;
  slide_number: number;
  title: string;
  content: string;
  speaker_notes: string;
};

type RunRow = {
  id: string;
  project_id: string | null;
  mode: RunSummary['mode'];
  duration: number;
  avg_pace_wpm: number | null;
  avg_confidence: number | null;
  filler_word_count: number;
  eye_contact_pct: number | null;
  posture_good_pct: number | null;
  overall_score: number | null;
  created_at: string;
};

type FeedbackRow = {
  id: string;
  run_id: string;
  timestamp: string;
  message: string;
  slide_number: number | null;
  severity: RunFeedback['severity'];
  category: RunFeedback['category'];
};

type SlideAnalysisRow = {
  id: string;
  run_id: string;
  slide_number: number;
  issues_json: string;
  best_phrase: string;
  risk_level: RunSlideAnalysis['riskLevel'];
};

type RiskSegmentRow = {
  id: string;
  project_id: string;
  slide_number: number | null;
  risk_type: RiskSegment['riskType'];
  frequency: number;
  avg_severity: number;
  last_occurrence: string;
  best_recovery: string;
  notes: string;
};

type GamePlanRow = {
  id: string;
  project_id: string;
  run_count: number;
  plan_json: string;
  created_at: string;
};

const db = getDatabase();

const baseProjectListSql = `
  SELECT
    p.*,
    COUNT(r.id) AS run_count,
    SUM(CASE WHEN r.mode = 'rehearsal' THEN 1 ELSE 0 END) AS rehearsal_run_count,
    SUM(CASE WHEN r.mode = 'presentation' THEN 1 ELSE 0 END) AS presentation_run_count,
    (
      SELECT r2.overall_score
      FROM runs r2
      WHERE r2.project_id = p.id AND r2.overall_score IS NOT NULL
      ORDER BY r2.created_at DESC
      LIMIT 1
    ) AS last_overall_score
  FROM projects p
  LEFT JOIN runs r ON r.project_id = p.id
  GROUP BY p.id
  ORDER BY p.updated_at DESC
`;

const listProjectsStmt = db.prepare(baseProjectListSql);
const getProjectStmt = db.prepare(`
  SELECT *
  FROM (${baseProjectListSql})
  WHERE id = ?
`);
const getProjectSlidesStmt = db.prepare(`
  SELECT *
  FROM project_slides
  WHERE project_id = ?
  ORDER BY slide_number ASC
`);
const insertProjectStmt = db.prepare(`
  INSERT INTO projects (id, name, description, content, file_path, file_type, slide_count, updated_at)
  VALUES (@id, @name, @description, @content, @filePath, @fileType, @slideCount, CURRENT_TIMESTAMP)
`);
const updateProjectMetaStmt = db.prepare(`
  UPDATE projects
  SET name = @name,
      description = @description,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = @id
`);
const updateProjectSlideNotesStmt = db.prepare(`
  UPDATE project_slides
  SET speaker_notes = @speakerNotes
  WHERE id = @id AND project_id = @projectId
`);
const deleteProjectStmt = db.prepare(`DELETE FROM projects WHERE id = ?`);
const replaceProjectUploadMetaStmt = db.prepare(`
  UPDATE projects
  SET content = @content,
      file_path = @filePath,
      file_type = @fileType,
      slide_count = @slideCount,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = @id
`);
const deleteProjectSlidesStmt = db.prepare(`DELETE FROM project_slides WHERE project_id = ?`);
const insertProjectSlideStmt = db.prepare(`
  INSERT INTO project_slides (id, project_id, slide_number, title, content, speaker_notes)
  VALUES (@id, @projectId, @slideNumber, @title, @content, @speakerNotes)
`);
const listRunsStmt = db.prepare(`
  SELECT *
  FROM runs
  WHERE (@projectId IS NULL OR project_id = @projectId)
  ORDER BY created_at DESC
`);
const getRunStmt = db.prepare(`SELECT * FROM runs WHERE id = ?`);
const getRunFeedbacksStmt = db.prepare(`
  SELECT *
  FROM feedbacks
  WHERE run_id = ?
  ORDER BY rowid ASC
`);
const getRunSlideAnalysesStmt = db.prepare(`
  SELECT *
  FROM run_slide_analyses
  WHERE run_id = ?
  ORDER BY slide_number ASC, created_at ASC
`);
const insertRunStmt = db.prepare(`
  INSERT INTO runs (
    id,
    project_id,
    mode,
    duration,
    avg_pace_wpm,
    avg_confidence,
    filler_word_count,
    eye_contact_pct,
    posture_good_pct,
    overall_score
  ) VALUES (
    @id,
    @projectId,
    @mode,
    @duration,
    @avgPaceWpm,
    @avgConfidence,
    @fillerWordCount,
    @eyeContactPct,
    @postureGoodPct,
    @overallScore
  )
`);
const insertFeedbackStmt = db.prepare(`
  INSERT INTO feedbacks (id, run_id, timestamp, message, slide_number, severity, category)
  VALUES (@id, @runId, @timestamp, @message, @slideNumber, @severity, @category)
`);
const insertRunSlideAnalysisStmt = db.prepare(`
  INSERT INTO run_slide_analyses (id, run_id, slide_number, issues_json, best_phrase, risk_level)
  VALUES (@id, @runId, @slideNumber, @issuesJson, @bestPhrase, @riskLevel)
`);
const listRiskSegmentsStmt = db.prepare(`
  SELECT *
  FROM risk_segments
  WHERE project_id = ?
  ORDER BY COALESCE(slide_number, 9999) ASC, avg_severity DESC
`);
const deleteRiskSegmentsStmt = db.prepare(`DELETE FROM risk_segments WHERE project_id = ?`);
const insertRiskSegmentStmt = db.prepare(`
  INSERT INTO risk_segments (
    id,
    project_id,
    slide_number,
    risk_type,
    frequency,
    avg_severity,
    last_occurrence,
    best_recovery,
    notes
  ) VALUES (
    @id,
    @projectId,
    @slideNumber,
    @riskType,
    @frequency,
    @avgSeverity,
    @lastOccurrence,
    @bestRecovery,
    @notes
  )
`);
const insertGamePlanStmt = db.prepare(`
  INSERT INTO game_plans (id, project_id, run_count, plan_json)
  VALUES (@id, @projectId, @runCount, @planJson)
`);
const getGamePlanStmt = db.prepare(`SELECT * FROM game_plans WHERE id = ?`);
const getLatestGamePlanStmt = db.prepare(`
  SELECT *
  FROM game_plans
  WHERE project_id = ?
  ORDER BY created_at DESC
  LIMIT 1
`);

function mapProjectSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    content: row.content ?? '',
    filePath: row.file_path,
    fileType: row.file_type ?? null,
    slideCount: row.slide_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    runCount: Number(row.run_count ?? 0),
    rehearsalRunCount: Number(row.rehearsal_run_count ?? 0),
    presentationRunCount: Number(row.presentation_run_count ?? 0),
    lastOverallScore: row.last_overall_score,
  };
}

function mapProjectSlide(row: ProjectSlideRow): ProjectSlide {
  return {
    id: row.id,
    projectId: row.project_id,
    slideNumber: row.slide_number,
    title: row.title,
    content: row.content,
    speakerNotes: row.speaker_notes,
  };
}

function mapRunSummary(row: RunRow): RunSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    mode: row.mode,
    duration: row.duration,
    avgPaceWpm: row.avg_pace_wpm,
    avgConfidence: row.avg_confidence,
    fillerWordCount: row.filler_word_count ?? 0,
    eyeContactPct: row.eye_contact_pct,
    postureGoodPct: row.posture_good_pct,
    overallScore: row.overall_score,
    createdAt: row.created_at,
  };
}

function mapFeedback(row: FeedbackRow): RunFeedback {
  return {
    id: row.id,
    runId: row.run_id,
    timestamp: row.timestamp,
    message: row.message,
    slideNumber: row.slide_number,
    severity: row.severity,
    category: row.category,
  };
}

function mapRunSlideAnalysis(row: SlideAnalysisRow): RunSlideAnalysis {
  return {
    id: row.id,
    runId: row.run_id,
    slideNumber: row.slide_number,
    issues: JSON.parse(row.issues_json) as string[],
    bestPhrase: row.best_phrase,
    riskLevel: row.risk_level,
  };
}

function mapRiskSegment(row: RiskSegmentRow): RiskSegment {
  return {
    id: row.id,
    projectId: row.project_id,
    slideNumber: row.slide_number,
    riskType: row.risk_type,
    frequency: row.frequency,
    avgSeverity: row.avg_severity,
    lastOccurrence: row.last_occurrence,
    bestRecovery: row.best_recovery,
    notes: row.notes,
  };
}

function mapGamePlan(row: GamePlanRow): GamePlan {
  const parsed = JSON.parse(row.plan_json) as Omit<GamePlan, 'id' | 'projectId' | 'runCount' | 'createdAt'>;
  return {
    id: row.id,
    projectId: row.project_id,
    runCount: row.run_count,
    createdAt: row.created_at,
    ...parsed,
  };
}

export function listProjects(): ProjectSummary[] {
  return (listProjectsStmt.all() as ProjectRow[]).map(mapProjectSummary);
}

export function getProject(id: string): ProjectDetails | null {
  const row = getProjectStmt.get(id) as ProjectRow | undefined;
  if (!row) return null;
  return {
    ...mapProjectSummary(row),
    slides: (getProjectSlidesStmt.all(id) as ProjectSlideRow[]).map(mapProjectSlide),
  };
}

export function createProject(input: ProjectInput): ProjectDetails {
  const id = crypto.randomUUID();
  insertProjectStmt.run({
    id,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    content: '',
    filePath: null,
    fileType: null,
    slideCount: 0,
  });
  return getProject(id)!;
}

export function updateProject(id: string, input: ProjectInput): ProjectDetails | null {
  const existing = getProject(id);
  if (!existing) return null;

  const transaction = db.transaction(() => {
    updateProjectMetaStmt.run({
      id,
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
    });

    for (const slide of input.slides ?? []) {
      updateProjectSlideNotesStmt.run({
        id: slide.id,
        projectId: id,
        speakerNotes: slide.speakerNotes,
      });
    }
  });

  transaction();
  return getProject(id);
}

export function deleteProject(id: string): boolean {
  const result = deleteProjectStmt.run(id);
  return result.changes > 0;
}

export function replaceProjectUpload(
  projectId: string,
  fileMeta: {
    content: string;
    filePath: string;
    fileType: ProjectSummary['fileType'];
    slideCount: number;
  },
  slides: Array<Pick<ProjectSlide, 'slideNumber' | 'title' | 'content' | 'speakerNotes'>>,
): ProjectDetails | null {
  if (!getProject(projectId)) return null;

  const transaction = db.transaction(() => {
    replaceProjectUploadMetaStmt.run({
      id: projectId,
      content: fileMeta.content,
      filePath: fileMeta.filePath,
      fileType: fileMeta.fileType,
      slideCount: fileMeta.slideCount,
    });
    deleteProjectSlidesStmt.run(projectId);
    for (const slide of slides) {
      insertProjectSlideStmt.run({
        id: crypto.randomUUID(),
        projectId,
        slideNumber: slide.slideNumber,
        title: slide.title,
        content: slide.content,
        speakerNotes: slide.speakerNotes,
      });
    }
  });

  transaction();
  return getProject(projectId);
}

export function listRuns(projectId?: string): RunSummary[] {
  return (listRunsStmt.all({ projectId: projectId ?? null }) as RunRow[]).map(mapRunSummary);
}

export function getRun(id: string): RunDetails | null {
  const row = getRunStmt.get(id) as RunRow | undefined;
  if (!row) return null;
  return {
    ...mapRunSummary(row),
    feedbacks: (getRunFeedbacksStmt.all(id) as FeedbackRow[]).map(mapFeedback),
    slideAnalyses: (getRunSlideAnalysesStmt.all(id) as SlideAnalysisRow[]).map(mapRunSlideAnalysis),
  };
}

export function saveRun(payload: SaveRunPayload): RunDetails {
  const transaction = db.transaction(() => {
    insertRunStmt.run({
      id: payload.run.id,
      projectId: payload.run.projectId,
      mode: payload.run.mode,
      duration: payload.run.duration,
      avgPaceWpm: payload.run.avgPaceWpm,
      avgConfidence: payload.run.avgConfidence,
      fillerWordCount: payload.run.fillerWordCount,
      eyeContactPct: payload.run.eyeContactPct,
      postureGoodPct: payload.run.postureGoodPct,
      overallScore: payload.run.overallScore,
    });

    for (const feedback of payload.feedbacks) {
      insertFeedbackStmt.run({
        id: feedback.id,
        runId: payload.run.id,
        timestamp: feedback.timestamp,
        message: feedback.message,
        slideNumber: feedback.slideNumber,
        severity: feedback.severity,
        category: feedback.category,
      });
    }

    for (const slideAnalysis of payload.slideAnalyses) {
      insertRunSlideAnalysisStmt.run({
        id: crypto.randomUUID(),
        runId: payload.run.id,
        slideNumber: slideAnalysis.slideNumber,
        issuesJson: JSON.stringify(slideAnalysis.issues),
        bestPhrase: slideAnalysis.bestPhrase,
        riskLevel: slideAnalysis.riskLevel,
      });
    }
  });

  transaction();
  return getRun(payload.run.id)!;
}

export function listRiskSegments(projectId: string): RiskSegment[] {
  return (listRiskSegmentsStmt.all(projectId) as RiskSegmentRow[]).map(mapRiskSegment);
}

export function replaceRiskSegments(projectId: string, segments: RiskSegment[]): RiskSegment[] {
  const transaction = db.transaction(() => {
    deleteRiskSegmentsStmt.run(projectId);
    for (const segment of segments) {
      insertRiskSegmentStmt.run({
        id: segment.id,
        projectId,
        slideNumber: segment.slideNumber,
        riskType: segment.riskType,
        frequency: segment.frequency,
        avgSeverity: segment.avgSeverity,
        lastOccurrence: segment.lastOccurrence,
        bestRecovery: segment.bestRecovery,
        notes: segment.notes,
      });
    }
  });

  transaction();
  return listRiskSegments(projectId);
}

export function saveGamePlan(plan: GamePlan): GamePlan {
  insertGamePlanStmt.run({
    id: plan.id,
    projectId: plan.projectId,
    runCount: plan.runCount,
    planJson: JSON.stringify({
      overview: plan.overview,
      segments: plan.segments,
      attentionBudget: plan.attentionBudget,
      timingStrategy: plan.timingStrategy,
    }),
  });
  return getGamePlan(plan.id)!;
}

export function getGamePlan(id: string): GamePlan | null {
  const row = getGamePlanStmt.get(id) as GamePlanRow | undefined;
  return row ? mapGamePlan(row) : null;
}

export function getLatestGamePlan(projectId: string): GamePlan | null {
  const row = getLatestGamePlanStmt.get(projectId) as GamePlanRow | undefined;
  return row ? mapGamePlan(row) : null;
}
