import crypto from 'node:crypto';
import type {
  LiveMemoryCue,
  ProjectDetails,
  RunArtifact,
  RunDetails,
  RunMemoryChunk,
  RunTranscriptSegment,
} from '../../shared/types.js';
import { cosineSimilarity } from './embeddings.js';

export const WINDOW_MS = 45_000;
export const MAX_QUERY_CHARS = 900;

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function parseFeedbackTimestampToMs(timestamp: string): number | null {
  const parts = timestamp.split(':').map((value) => Number(value));
  if (parts.some((value) => Number.isNaN(value))) return null;
  if (parts.length === 2) {
    return ((parts[0] * 60) + parts[1]) * 1000;
  }
  if (parts.length === 3) {
    return ((parts[0] * 3600) + (parts[1] * 60) + parts[2]) * 1000;
  }
  return null;
}

export function severityFromRiskLevel(riskLevel: RunMemoryChunk['riskLevel']): RunMemoryChunk['severity'] {
  if (riskLevel === 'fragile') return 'critical';
  if (riskLevel === 'watch') return 'warning';
  return 'info';
}

export function findPrimaryArtifactId(artifacts: RunArtifact[]): string | null {
  return artifacts.find((artifact) => artifact.kind === 'full_recording')?.id ?? artifacts[0]?.id ?? null;
}

function buildTranscriptChunks(
  run: RunDetails,
  project: ProjectDetails,
  artifactId: string | null,
): Array<Omit<RunMemoryChunk, 'embedding' | 'createdAt'>> {
  const chunks: Array<Omit<RunMemoryChunk, 'embedding' | 'createdAt'>> = [];
  const slideTitleByNumber = new Map(project.slides.map((slide) => [slide.slideNumber, slide.title]));

  const bySlide = new Map<number, RunTranscriptSegment[]>();
  const unassigned: RunTranscriptSegment[] = [];
  for (const segment of run.transcriptSegments) {
    if (segment.slideNumber != null) {
      const bucket = bySlide.get(segment.slideNumber) ?? [];
      bucket.push(segment);
      bySlide.set(segment.slideNumber, bucket);
    } else {
      unassigned.push(segment);
    }
  }

  for (const [slideNumber, segments] of bySlide.entries()) {
    const text = normalizeWhitespace(segments.map((segment) => segment.text).join(' '));
    if (!text) continue;
    const slideTitle = slideTitleByNumber.get(slideNumber) ?? `Slide ${slideNumber}`;
    chunks.push({
      id: crypto.randomUUID(),
      projectId: project.id,
      runId: run.id,
      artifactId,
      sourceType: 'transcript_window',
      slideNumber,
      startMs: segments[0]?.startMs ?? null,
      endMs: segments[segments.length - 1]?.endMs ?? null,
      textForEmbedding: normalizeWhitespace(`Slide ${slideNumber}: ${slideTitle}\nTranscript: ${text}`),
      cueText: truncate(text, 160),
      severity: 'info',
      riskLevel: null,
    });
  }

  const buckets = new Map<number, RunTranscriptSegment[]>();
  for (const segment of unassigned) {
    const bucketKey = Math.floor(segment.startMs / WINDOW_MS);
    const bucket = buckets.get(bucketKey) ?? [];
    bucket.push(segment);
    buckets.set(bucketKey, bucket);
  }

  for (const [bucketKey, segments] of buckets.entries()) {
    const text = normalizeWhitespace(segments.map((segment) => segment.text).join(' '));
    if (!text) continue;
    chunks.push({
      id: crypto.randomUUID(),
      projectId: project.id,
      runId: run.id,
      artifactId,
      sourceType: 'transcript_window',
      slideNumber: null,
      startMs: bucketKey * WINDOW_MS,
      endMs: ((bucketKey + 1) * WINDOW_MS),
      textForEmbedding: normalizeWhitespace(`General transcript window: ${text}`),
      cueText: truncate(text, 160),
      severity: 'info',
      riskLevel: null,
    });
  }

  return chunks;
}

function buildFlaggedMomentChunks(
  run: RunDetails,
  project: ProjectDetails,
  artifactId: string | null,
): Array<Omit<RunMemoryChunk, 'embedding' | 'createdAt'>> {
  const chunks: Array<Omit<RunMemoryChunk, 'embedding' | 'createdAt'>> = [];
  const slideTitleByNumber = new Map(project.slides.map((slide) => [slide.slideNumber, slide.title]));

  for (const feedback of run.feedbacks) {
    if (feedback.severity === 'info') continue;
    const slideLabel = feedback.slideNumber != null
      ? `Slide ${feedback.slideNumber}: ${slideTitleByNumber.get(feedback.slideNumber) ?? `Slide ${feedback.slideNumber}`}`
      : 'General delivery';
    const feedbackMs = parseFeedbackTimestampToMs(feedback.timestamp);
    chunks.push({
      id: crypto.randomUUID(),
      projectId: project.id,
      runId: run.id,
      artifactId,
      sourceType: 'flagged_moment',
      slideNumber: feedback.slideNumber,
      startMs: feedbackMs,
      endMs: feedbackMs,
      textForEmbedding: normalizeWhitespace(`${slideLabel}\nFlagged issue: ${feedback.message}`),
      cueText: truncate(feedback.message, 160),
      severity: feedback.severity,
      riskLevel: null,
    });
  }

  for (const analysis of run.slideAnalyses) {
    if (analysis.riskLevel === 'safe') continue;
    const slideTitle = slideTitleByNumber.get(analysis.slideNumber) ?? `Slide ${analysis.slideNumber}`;
    const issueText = normalizeWhitespace(analysis.issues.join('. '));
    chunks.push({
      id: crypto.randomUUID(),
      projectId: project.id,
      runId: run.id,
      artifactId,
      sourceType: 'flagged_moment',
      slideNumber: analysis.slideNumber,
      startMs: null,
      endMs: null,
      textForEmbedding: normalizeWhitespace(`Slide ${analysis.slideNumber}: ${slideTitle}\nRepeated risk: ${issueText || 'Confidence wobble'}`),
      cueText: truncate(issueText || 'Confidence wobble', 160),
      severity: severityFromRiskLevel(analysis.riskLevel),
      riskLevel: analysis.riskLevel,
    });

    if (!analysis.bestPhrase.trim()) continue;
    chunks.push({
      id: crypto.randomUUID(),
      projectId: project.id,
      runId: run.id,
      artifactId,
      sourceType: 'recovery_phrase',
      slideNumber: analysis.slideNumber,
      startMs: null,
      endMs: null,
      textForEmbedding: normalizeWhitespace(
        `Slide ${analysis.slideNumber}: ${slideTitle}\nRecovery phrase: ${analysis.bestPhrase}\nIssues: ${issueText || 'n/a'}`,
      ),
      cueText: truncate(analysis.bestPhrase.trim(), 160),
      severity: 'info',
      riskLevel: analysis.riskLevel,
    });
  }

  return chunks;
}

export function buildRunMemoryDrafts(run: RunDetails, project: ProjectDetails): Array<Omit<RunMemoryChunk, 'embedding' | 'createdAt'>> {
  const artifactId = findPrimaryArtifactId(run.artifacts);
  return [
    ...buildTranscriptChunks(run, project, artifactId),
    ...buildFlaggedMomentChunks(run, project, artifactId),
  ].filter((chunk) => Boolean(chunk.textForEmbedding));
}

export function toLiveMemoryCue(chunk: RunMemoryChunk, similarityScore: number): LiveMemoryCue {
  return {
    chunkId: chunk.id,
    runId: chunk.runId,
    slideNumber: chunk.slideNumber,
    sourceType: chunk.sourceType,
    cueText: chunk.cueText,
    supportingText: truncate(chunk.textForEmbedding, 220),
    severity: chunk.severity,
    riskLevel: chunk.riskLevel,
    similarityScore: Number(similarityScore.toFixed(3)),
    startMs: chunk.startMs,
    endMs: chunk.endMs,
  };
}

export function buildSlideQuery(project: ProjectDetails, slideNumber: number): string {
  const slide = project.slides.find((entry) => entry.slideNumber === slideNumber);
  if (!slide) return `Slide ${slideNumber}`;
  return truncate(
    normalizeWhitespace(
      [
        `Slide ${slide.slideNumber}: ${slide.title}`,
        slide.content ? `Content: ${slide.content}` : '',
        slide.speakerNotes ? `Speaker notes: ${slide.speakerNotes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    MAX_QUERY_CHARS,
  );
}

export function rankMemoryChunks(
  candidates: RunMemoryChunk[],
  queryEmbedding: number[],
  filters?: { slideNumber?: number | null; limit?: number },
): LiveMemoryCue[] {
  return candidates
    .map((chunk) => {
      let score = cosineSimilarity(queryEmbedding, chunk.embedding);
      if (filters?.slideNumber != null && chunk.slideNumber === filters.slideNumber) score += 0.12;
      if (chunk.sourceType === 'recovery_phrase') score += 0.07;
      else if (chunk.sourceType === 'flagged_moment') score += 0.04;
      if (chunk.severity === 'critical') score += 0.03;
      else if (chunk.severity === 'warning') score += 0.015;
      return { chunk, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, filters?.limit ?? 5)
    .map(({ chunk, score }) => toLiveMemoryCue(chunk, score));
}
