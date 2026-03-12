import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRunMemoryDrafts, buildSlideQuery, parseFeedbackTimestampToMs, rankMemoryChunks } from '../server/services/runMemoryCore.ts';

const projectFixture = {
  id: 'project-memory',
  name: 'Memory Demo',
  description: 'Deck for run memory tests.',
  content: '',
  filePath: null,
  fileType: 'pptx' as const,
  slideCount: 2,
  createdAt: '2026-03-11T10:00:00.000Z',
  updatedAt: '2026-03-11T10:00:00.000Z',
  runCount: 0,
  rehearsalRunCount: 0,
  presentationRunCount: 0,
  lastOverallScore: null,
  slides: [
    {
      id: 'slide-1',
      projectId: 'project-memory',
      slideNumber: 1,
      title: 'Intro',
      content: 'Opening story and thesis',
      speakerNotes: 'Land the story cleanly',
    },
    {
      id: 'slide-2',
      projectId: 'project-memory',
      slideNumber: 2,
      title: 'Roadmap',
      content: 'Timeline, milestones, and launch plan',
      speakerNotes: 'Slow down before the milestones',
    },
  ],
};

const runFixture = {
  id: 'run-memory-1',
  projectId: 'project-memory',
  mode: 'rehearsal' as const,
  duration: 100_000,
  avgPaceWpm: 154,
  avgConfidence: 68,
  fillerWordCount: 5,
  eyeContactPct: 64,
  postureGoodPct: 67,
  overallScore: 74,
  createdAt: '2026-03-11T10:05:00.000Z',
  feedbacks: [
    {
      id: 'feedback-1',
      runId: 'run-memory-1',
      timestamp: '00:42',
      message: 'Transition got rushed before the milestones.',
      slideNumber: 2,
      severity: 'warning' as const,
      category: 'structure' as const,
    },
  ],
  slideAnalyses: [
    {
      id: 'analysis-1',
      runId: 'run-memory-1',
      slideNumber: 2,
      issues: ['Rushed transition into milestones'],
      bestPhrase: 'Take a breath, then name the three milestones.',
      riskLevel: 'fragile' as const,
    },
  ],
  artifacts: [
    {
      id: 'artifact-1',
      runId: 'run-memory-1',
      kind: 'full_recording' as const,
      mimeType: 'video/webm',
      filePath: '/tmp/run-memory-1.webm',
      startMs: 0,
      endMs: 100_000,
      createdAt: '2026-03-11T10:05:00.000Z',
    },
  ],
  transcriptSegments: [
    {
      id: 'segment-1',
      runId: 'run-memory-1',
      sequence: 0,
      startMs: 35_000,
      endMs: 39_000,
      text: 'Today I will walk through the roadmap and the milestones.',
      slideNumber: 2,
    },
    {
      id: 'segment-2',
      runId: 'run-memory-1',
      sequence: 1,
      startMs: 40_000,
      endMs: 45_000,
      text: 'First comes beta, then launch, then expansion.',
      slideNumber: 2,
    },
  ],
  runReport: null,
};

test('parseFeedbackTimestampToMs converts mm:ss timestamps', () => {
  assert.equal(parseFeedbackTimestampToMs('00:42'), 42_000);
  assert.equal(parseFeedbackTimestampToMs('01:02:03'), 3_723_000);
  assert.equal(parseFeedbackTimestampToMs('oops'), null);
});

test('buildRunMemoryDrafts produces transcript, flagged, and recovery chunks', () => {
  const drafts = buildRunMemoryDrafts(runFixture, projectFixture);

  assert.ok(drafts.some((chunk) => chunk.sourceType === 'transcript_window'));
  assert.ok(drafts.some((chunk) => chunk.sourceType === 'flagged_moment'));
  assert.ok(drafts.some((chunk) => chunk.sourceType === 'recovery_phrase'));
  assert.ok(drafts.every((chunk) => chunk.projectId === projectFixture.id));
  assert.ok(drafts.every((chunk) => chunk.artifactId === 'artifact-1'));
});

test('buildSlideQuery includes slide content and speaker notes', () => {
  const query = buildSlideQuery(projectFixture, 2);

  assert.match(query, /Roadmap/);
  assert.match(query, /milestones/i);
  assert.match(query, /speaker notes/i);
});

test('rankMemoryChunks prefers same-slide recovery cues over generic transcript windows', () => {
  const ranked = rankMemoryChunks([
    {
      id: 'chunk-1',
      projectId: projectFixture.id,
      runId: runFixture.id,
      artifactId: 'artifact-1',
      sourceType: 'transcript_window',
      slideNumber: null,
      startMs: 0,
      endMs: 45_000,
      textForEmbedding: 'General transcript',
      cueText: 'General transcript',
      severity: 'info',
      riskLevel: null,
      embedding: [0.8, 0.2],
      createdAt: runFixture.createdAt,
    },
    {
      id: 'chunk-2',
      projectId: projectFixture.id,
      runId: runFixture.id,
      artifactId: 'artifact-1',
      sourceType: 'recovery_phrase',
      slideNumber: 2,
      startMs: null,
      endMs: null,
      textForEmbedding: 'Recovery phrase for roadmap milestones',
      cueText: 'Take a breath, then name the three milestones.',
      severity: 'info',
      riskLevel: 'fragile',
      embedding: [0.79, 0.21],
      createdAt: runFixture.createdAt,
    },
  ], [0.8, 0.2], { slideNumber: 2, limit: 2 });

  assert.equal(ranked[0]?.chunkId, 'chunk-2');
  assert.match(ranked[0]?.cueText ?? '', /milestones/i);
});
