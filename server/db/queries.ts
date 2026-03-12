import crypto from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import type {
  GamePlan,
  ProjectDetails,
  ProjectInput,
  ProjectSlide,
  ProjectSummary,
  RiskSegment,
  RunArtifact,
  RunDetails,
  RunFeedback,
  RunMemoryChunk,
  RunSlideAnalysis,
  RunSummary,
  RunTranscriptSegment,
  SaveRunPayload,
} from '../../shared/types.js';
import { queryRow, queryRows, toVectorLiteral, withTransaction } from './database.js';

type DbTimestamp = string | Date;

type ProjectRow = QueryResultRow & {
  id: string;
  name: string;
  description: string | null;
  content: string | null;
  file_path: string | null;
  file_type: ProjectSummary['fileType'];
  slide_count: number;
  created_at: DbTimestamp;
  updated_at: DbTimestamp;
  run_count: string | number;
  rehearsal_run_count: string | number;
  presentation_run_count: string | number;
  last_overall_score: number | null;
};

type ProjectSlideRow = QueryResultRow & {
  id: string;
  project_id: string;
  slide_number: number;
  title: string;
  content: string;
  speaker_notes: string;
};

type RunRow = QueryResultRow & {
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
  created_at: DbTimestamp;
};

type FeedbackRow = QueryResultRow & {
  id: string;
  run_id: string;
  timestamp: string;
  message: string;
  slide_number: number | null;
  severity: RunFeedback['severity'];
  category: RunFeedback['category'];
  created_at: DbTimestamp;
};

type SlideAnalysisRow = QueryResultRow & {
  id: string;
  run_id: string;
  slide_number: number;
  issues_json: string[] | string;
  best_phrase: string;
  risk_level: RunSlideAnalysis['riskLevel'];
};

type RunArtifactRow = QueryResultRow & {
  id: string;
  run_id: string;
  kind: RunArtifact['kind'];
  mime_type: string;
  file_path: string;
  start_ms: number | null;
  end_ms: number | null;
  created_at: DbTimestamp;
};

type RunTranscriptSegmentRow = QueryResultRow & {
  id: string;
  run_id: string;
  sequence: number;
  start_ms: number;
  end_ms: number;
  text: string;
  slide_number: number | null;
};

type RunMemoryChunkRow = QueryResultRow & {
  id: string;
  project_id: string;
  run_id: string;
  artifact_id: string | null;
  source_type: RunMemoryChunk['sourceType'];
  slide_number: number | null;
  start_ms: number | null;
  end_ms: number | null;
  text_for_embedding: string;
  cue_text: string;
  severity: RunMemoryChunk['severity'];
  risk_level: RunMemoryChunk['riskLevel'];
  embedding: string | number[];
  created_at: DbTimestamp;
};

type RiskSegmentRow = QueryResultRow & {
  id: string;
  project_id: string;
  slide_number: number | null;
  risk_type: RiskSegment['riskType'];
  frequency: number;
  avg_severity: number;
  last_occurrence: DbTimestamp;
  best_recovery: string;
  notes: string;
};

type GamePlanRow = QueryResultRow & {
  id: string;
  project_id: string;
  run_count: number;
  plan_json: Omit<GamePlan, 'id' | 'projectId' | 'runCount' | 'createdAt'> | string;
  created_at: DbTimestamp;
};

type MemorySearchRow = RunMemoryChunkRow & {
  similarity_score: number;
  rank_score: number;
};

const PROJECT_SELECT_SQL = `
  SELECT
    p.*,
    COALESCE(run_stats.run_count, 0) AS run_count,
    COALESCE(run_stats.rehearsal_run_count, 0) AS rehearsal_run_count,
    COALESCE(run_stats.presentation_run_count, 0) AS presentation_run_count,
    last_run.last_overall_score
  FROM projects p
  LEFT JOIN (
    SELECT
      project_id,
      COUNT(*) AS run_count,
      COUNT(*) FILTER (WHERE mode = 'rehearsal') AS rehearsal_run_count,
      COUNT(*) FILTER (WHERE mode = 'presentation') AS presentation_run_count
    FROM runs
    GROUP BY project_id
  ) AS run_stats ON run_stats.project_id = p.id
  LEFT JOIN LATERAL (
    SELECT overall_score AS last_overall_score
    FROM runs r2
    WHERE r2.project_id = p.id AND r2.overall_score IS NOT NULL
    ORDER BY r2.created_at DESC
    LIMIT 1
  ) AS last_run ON TRUE
`;

function timestampToIso(value: DbTimestamp | null | undefined): string {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : value;
}

function parseIssues(value: SlideAnalysisRow['issues_json']): string[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return JSON.parse(value) as string[];
}

function parsePlanJson(value: GamePlanRow['plan_json']): Omit<GamePlan, 'id' | 'projectId' | 'runCount' | 'createdAt'> {
  if (typeof value === 'string') {
    return JSON.parse(value) as Omit<GamePlan, 'id' | 'projectId' | 'runCount' | 'createdAt'>;
  }
  return value;
}

function parseEmbedding(value: RunMemoryChunkRow['embedding']): number[] {
  if (Array.isArray(value)) return value.map(Number);
  const trimmed = String(value).trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as number[];
  }
  return trimmed
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => !Number.isNaN(entry));
}

function mapProjectSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    content: row.content ?? '',
    filePath: row.file_path,
    fileType: row.file_type ?? null,
    slideCount: row.slide_count ?? 0,
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
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
    createdAt: timestampToIso(row.created_at),
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
    issues: parseIssues(row.issues_json),
    bestPhrase: row.best_phrase,
    riskLevel: row.risk_level,
  };
}

function mapRunArtifact(row: RunArtifactRow): RunArtifact {
  return {
    id: row.id,
    runId: row.run_id,
    kind: row.kind,
    mimeType: row.mime_type,
    filePath: row.file_path,
    startMs: row.start_ms,
    endMs: row.end_ms,
    createdAt: timestampToIso(row.created_at),
  };
}

function mapRunTranscriptSegment(row: RunTranscriptSegmentRow): RunTranscriptSegment {
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
    slideNumber: row.slide_number,
  };
}

function mapRunMemoryChunk(row: RunMemoryChunkRow): RunMemoryChunk {
  return {
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id,
    artifactId: row.artifact_id,
    sourceType: row.source_type,
    slideNumber: row.slide_number,
    startMs: row.start_ms,
    endMs: row.end_ms,
    textForEmbedding: row.text_for_embedding,
    cueText: row.cue_text,
    severity: row.severity,
    riskLevel: row.risk_level,
    embedding: parseEmbedding(row.embedding),
    createdAt: timestampToIso(row.created_at),
  };
}

function mapRiskSegment(row: RiskSegmentRow): RiskSegment {
  return {
    id: row.id,
    projectId: row.project_id,
    slideNumber: row.slide_number,
    riskType: row.risk_type,
    frequency: row.frequency,
    avgSeverity: Number(row.avg_severity),
    lastOccurrence: timestampToIso(row.last_occurrence),
    bestRecovery: row.best_recovery,
    notes: row.notes,
  };
}

function mapGamePlan(row: GamePlanRow): GamePlan {
  const parsed = parsePlanJson(row.plan_json);
  return {
    id: row.id,
    projectId: row.project_id,
    runCount: row.run_count,
    createdAt: timestampToIso(row.created_at),
    ...parsed,
  };
}

async function getProjectSummaryRow(id: string, client?: Pick<PoolClient, 'query'>): Promise<ProjectRow | null> {
  return queryRow<ProjectRow>(`${PROJECT_SELECT_SQL} WHERE p.id = $1`, [id], client);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const rows = await queryRows<ProjectRow>(`${PROJECT_SELECT_SQL} ORDER BY p.updated_at DESC`);
  return rows.map(mapProjectSummary);
}

export async function getProject(id: string): Promise<ProjectDetails | null> {
  const row = await getProjectSummaryRow(id);
  if (!row) return null;
  const slides = await queryRows<ProjectSlideRow>(
    `SELECT * FROM project_slides WHERE project_id = $1 ORDER BY slide_number ASC`,
    [id],
  );
  return {
    ...mapProjectSummary(row),
    slides: slides.map(mapProjectSlide),
  };
}

export async function createProject(input: ProjectInput): Promise<ProjectDetails> {
  const id = crypto.randomUUID();
  await queryRows(
    `INSERT INTO projects (id, name, description, content, file_path, file_type, slide_count)
     VALUES ($1, $2, $3, '', NULL, NULL, 0)`,
    [id, input.name.trim(), input.description?.trim() ?? ''],
  );
  return (await getProject(id))!;
}

export async function updateProject(id: string, input: ProjectInput): Promise<ProjectDetails | null> {
  const existing = await getProject(id);
  if (!existing) return null;

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE projects
       SET name = $2, description = $3, updated_at = NOW()
       WHERE id = $1`,
      [id, input.name.trim(), input.description?.trim() ?? ''],
    );

    for (const slide of input.slides ?? []) {
      await client.query(
        `UPDATE project_slides
         SET speaker_notes = $3
         WHERE id = $1 AND project_id = $2`,
        [slide.id, id, slide.speakerNotes],
      );
    }
  });

  return getProject(id);
}

export async function deleteProject(id: string): Promise<boolean> {
  const result = await queryRows<QueryResultRow>(`DELETE FROM projects WHERE id = $1 RETURNING id`, [id]);
  return result.length > 0;
}

export async function replaceProjectUpload(
  projectId: string,
  fileMeta: {
    content: string;
    filePath: string;
    fileType: ProjectSummary['fileType'];
    slideCount: number;
  },
  slides: Array<Pick<ProjectSlide, 'slideNumber' | 'title' | 'content' | 'speakerNotes'>>,
): Promise<ProjectDetails | null> {
  const existing = await getProject(projectId);
  if (!existing) return null;

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE projects
       SET content = $2,
           file_path = $3,
           file_type = $4,
           slide_count = $5,
           updated_at = NOW()
       WHERE id = $1`,
      [projectId, fileMeta.content, fileMeta.filePath, fileMeta.fileType, fileMeta.slideCount],
    );

    await client.query(`DELETE FROM project_slides WHERE project_id = $1`, [projectId]);

    for (const slide of slides) {
      await client.query(
        `INSERT INTO project_slides (id, project_id, slide_number, title, content, speaker_notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [crypto.randomUUID(), projectId, slide.slideNumber, slide.title, slide.content, slide.speakerNotes],
      );
    }
  });

  return getProject(projectId);
}

export async function listRuns(projectId?: string): Promise<RunSummary[]> {
  const rows = await queryRows<RunRow>(
    `SELECT *
     FROM runs
     WHERE ($1::uuid IS NULL OR project_id = $1::uuid)
     ORDER BY created_at DESC`,
    [projectId ?? null],
  );
  return rows.map(mapRunSummary);
}

export async function getRun(id: string): Promise<RunDetails | null> {
  const row = await queryRow<RunRow>(`SELECT * FROM runs WHERE id = $1`, [id]);
  if (!row) return null;

  const [feedbacks, slideAnalyses, artifacts, transcriptSegments] = await Promise.all([
    queryRows<FeedbackRow>(`SELECT * FROM feedbacks WHERE run_id = $1 ORDER BY created_at ASC, id ASC`, [id]),
    queryRows<SlideAnalysisRow>(`SELECT * FROM run_slide_analyses WHERE run_id = $1 ORDER BY slide_number ASC, created_at ASC`, [id]),
    queryRows<RunArtifactRow>(`SELECT * FROM run_artifacts WHERE run_id = $1 ORDER BY created_at ASC, id ASC`, [id]),
    queryRows<RunTranscriptSegmentRow>(`SELECT * FROM run_transcript_segments WHERE run_id = $1 ORDER BY sequence ASC, created_at ASC`, [id]),
  ]);

  return {
    ...mapRunSummary(row),
    feedbacks: feedbacks.map(mapFeedback),
    slideAnalyses: slideAnalyses.map(mapRunSlideAnalysis),
    artifacts: artifacts.map(mapRunArtifact),
    transcriptSegments: transcriptSegments.map(mapRunTranscriptSegment),
    runReport: null,
  };
}

export async function saveRun(payload: SaveRunPayload): Promise<RunDetails> {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO runs (
        id, project_id, mode, duration, avg_pace_wpm, avg_confidence,
        filler_word_count, eye_contact_pct, posture_good_pct, overall_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        payload.run.id,
        payload.run.projectId,
        payload.run.mode,
        payload.run.duration,
        payload.run.avgPaceWpm,
        payload.run.avgConfidence,
        payload.run.fillerWordCount,
        payload.run.eyeContactPct,
        payload.run.postureGoodPct,
        payload.run.overallScore,
      ],
    );

    for (const feedback of payload.feedbacks) {
      await client.query(
        `INSERT INTO feedbacks (id, run_id, timestamp, message, slide_number, severity, category)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [feedback.id, payload.run.id, feedback.timestamp, feedback.message, feedback.slideNumber, feedback.severity, feedback.category],
      );
    }

    for (const slideAnalysis of payload.slideAnalyses) {
      await client.query(
        `INSERT INTO run_slide_analyses (id, run_id, slide_number, issues_json, best_phrase, risk_level)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
        [
          crypto.randomUUID(),
          payload.run.id,
          slideAnalysis.slideNumber,
          JSON.stringify(slideAnalysis.issues),
          slideAnalysis.bestPhrase,
          slideAnalysis.riskLevel,
        ],
      );
    }

    for (const artifact of payload.artifacts ?? []) {
      await client.query(
        `INSERT INTO run_artifacts (id, run_id, kind, mime_type, file_path, start_ms, end_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [artifact.id, payload.run.id, artifact.kind, artifact.mimeType, artifact.filePath, artifact.startMs, artifact.endMs],
      );
    }

    for (const segment of payload.transcriptSegments ?? []) {
      await client.query(
        `INSERT INTO run_transcript_segments (id, run_id, sequence, start_ms, end_ms, text, slide_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [segment.id, payload.run.id, segment.sequence, segment.startMs, segment.endMs, segment.text, segment.slideNumber],
      );
    }
  });

  return (await getRun(payload.run.id))!;
}

export async function listRiskSegments(projectId: string): Promise<RiskSegment[]> {
  const rows = await queryRows<RiskSegmentRow>(
    `SELECT * FROM risk_segments
     WHERE project_id = $1
     ORDER BY COALESCE(slide_number, 9999) ASC, avg_severity DESC`,
    [projectId],
  );
  return rows.map(mapRiskSegment);
}

export async function replaceRiskSegments(projectId: string, segments: RiskSegment[]): Promise<RiskSegment[]> {
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM risk_segments WHERE project_id = $1`, [projectId]);
    for (const segment of segments) {
      await client.query(
        `INSERT INTO risk_segments (
          id, project_id, slide_number, risk_type, frequency, avg_severity,
          last_occurrence, best_recovery, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          segment.id,
          projectId,
          segment.slideNumber,
          segment.riskType,
          segment.frequency,
          segment.avgSeverity,
          segment.lastOccurrence,
          segment.bestRecovery,
          segment.notes,
        ],
      );
    }
  });

  return listRiskSegments(projectId);
}

export async function saveGamePlan(plan: GamePlan): Promise<GamePlan> {
  await queryRows(
    `INSERT INTO game_plans (id, project_id, run_count, plan_json, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [
      plan.id,
      plan.projectId,
      plan.runCount,
      JSON.stringify({
        overview: plan.overview,
        segments: plan.segments,
        attentionBudget: plan.attentionBudget,
        timingStrategy: plan.timingStrategy,
      }),
      plan.createdAt,
    ],
  );
  return (await getGamePlan(plan.id))!;
}

export async function getGamePlan(id: string): Promise<GamePlan | null> {
  const row = await queryRow<GamePlanRow>(`SELECT * FROM game_plans WHERE id = $1`, [id]);
  return row ? mapGamePlan(row) : null;
}

export async function getLatestGamePlan(projectId: string): Promise<GamePlan | null> {
  const row = await queryRow<GamePlanRow>(
    `SELECT * FROM game_plans WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [projectId],
  );
  return row ? mapGamePlan(row) : null;
}

export async function listRunMemoryChunks(projectId: string, runId?: string): Promise<RunMemoryChunk[]> {
  const rows = await queryRows<RunMemoryChunkRow>(
    `SELECT
       id, project_id, run_id, artifact_id, source_type, slide_number, start_ms, end_ms,
       text_for_embedding, cue_text, severity, risk_level, embedding::text AS embedding, created_at
     FROM run_memory_chunks
     WHERE project_id = $1
       AND ($2::uuid IS NULL OR run_id = $2::uuid)
     ORDER BY created_at DESC, id DESC`,
    [projectId, runId ?? null],
  );
  return rows.map(mapRunMemoryChunk);
}

export async function replaceRunMemoryChunks(runId: string, projectId: string, chunks: RunMemoryChunk[]): Promise<RunMemoryChunk[]> {
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM run_memory_chunks WHERE run_id = $1`, [runId]);
    for (const chunk of chunks) {
      await client.query(
        `INSERT INTO run_memory_chunks (
          id, project_id, run_id, artifact_id, source_type, slide_number, start_ms, end_ms,
          text_for_embedding, cue_text, severity, risk_level, embedding, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13::vector, $14
        )`,
        [
          chunk.id,
          projectId,
          runId,
          chunk.artifactId,
          chunk.sourceType,
          chunk.slideNumber,
          chunk.startMs,
          chunk.endMs,
          chunk.textForEmbedding,
          chunk.cueText,
          chunk.severity,
          chunk.riskLevel,
          toVectorLiteral(chunk.embedding),
          chunk.createdAt,
        ],
      );
    }
  });

  return listRunMemoryChunks(projectId, runId);
}

export async function searchRunMemoryChunks(
  projectId: string,
  queryEmbedding: number[],
  filters?: { slideNumber?: number | null; limit?: number; runId?: string },
): Promise<Array<{ chunk: RunMemoryChunk; similarityScore: number; rankScore: number }>> {
  const rows = await queryRows<MemorySearchRow>(
    `SELECT
       id, project_id, run_id, artifact_id, source_type, slide_number, start_ms, end_ms,
       text_for_embedding, cue_text, severity, risk_level, embedding::text AS embedding, created_at,
       (1 - (embedding <=> $2::vector)) AS similarity_score,
       (
         (1 - (embedding <=> $2::vector))
         + CASE WHEN $3::int IS NOT NULL AND slide_number = $3::int THEN 0.12 ELSE 0 END
         + CASE WHEN source_type = 'recovery_phrase' THEN 0.07
                WHEN source_type = 'flagged_moment' THEN 0.04
                ELSE 0 END
         + CASE WHEN severity = 'critical' THEN 0.03
                WHEN severity = 'warning' THEN 0.015
                ELSE 0 END
       ) AS rank_score
     FROM run_memory_chunks
     WHERE project_id = $1
       AND ($4::uuid IS NULL OR run_id = $4::uuid)
       AND ($3::int IS NULL OR slide_number = $3::int OR slide_number IS NULL)
     ORDER BY rank_score DESC, created_at DESC
     LIMIT $5`,
    [
      projectId,
      toVectorLiteral(queryEmbedding),
      filters?.slideNumber ?? null,
      filters?.runId ?? null,
      filters?.limit ?? 5,
    ],
  );

  return rows.map((row) => ({
    chunk: mapRunMemoryChunk(row),
    similarityScore: Number(row.similarity_score),
    rankScore: Number(row.rank_score),
  }));
}
