import crypto from 'node:crypto';
import type { GamePlan, InterventionPolicy, ProjectDetails, RiskLevel, RiskSegment, RunSummary } from '../../shared/types.js';
import { getProject, listRuns, saveGamePlan } from '../db/queries.js';
import { refreshRiskSegments } from './analysis.js';

function calculateTrend(scores: number[]): GamePlan['overview']['trend'] {
  if (scores.length < 2) return 'stable';
  const latest = scores[0];
  const earliest = scores[scores.length - 1];
  if (latest >= earliest + 5) return 'improving';
  if (latest <= earliest - 5) return 'declining';
  return 'stable';
}

function riskLevelForSlide(segments: RiskSegment[]): RiskLevel {
  const severity = Math.max(0, ...segments.map((segment) => segment.avgSeverity));
  if (severity >= 0.74) return 'fragile';
  if (severity >= 0.42) return 'watch';
  return 'safe';
}

function interventionPolicyForRisk(riskLevel: RiskLevel): InterventionPolicy {
  if (riskLevel === 'fragile') return 'directive';
  if (riskLevel === 'watch') return 'soft_cue';
  return 'silent';
}

function cuesForRiskType(riskType: RiskSegment['riskType']): string[] {
  switch (riskType) {
    case 'pace_spike':
      return ['Slow down', 'Breathe first'];
    case 'freeze':
      return ['Anchor transition', 'Name the point'];
    case 'filler_cluster':
      return ['Pause instead', 'Land the sentence'];
    case 'eye_contact_loss':
      return ['Find the camera', 'Hold the lens'];
    case 'structure_drift':
      return ['Return to outline', 'State the headline'];
    default:
      return ['Stay grounded', 'One clear line'];
  }
}

function buildTimingStrategy(slideCount: number, runs: RunSummary[], prioritySlides: number[]): GamePlan['timingStrategy'] {
  const averageDurationMs = runs.length
    ? runs.reduce((sum, run) => sum + run.duration, 0) / runs.length
    : slideCount * 45000;
  const totalTargetMinutes = Math.max(1, Math.round(averageDurationMs / 60000));
  const totalSeconds = totalTargetMinutes * 60;
  const baseSeconds = slideCount > 0 ? Math.floor(totalSeconds / slideCount) : totalSeconds;
  const perSlideTargets: Record<number, number> = {};

  for (let slideNumber = 1; slideNumber <= Math.max(slideCount, 1); slideNumber += 1) {
    perSlideTargets[slideNumber] = prioritySlides.includes(slideNumber)
      ? baseSeconds + 10
      : baseSeconds;
  }

  return { totalTargetMinutes, perSlideTargets };
}

function ensureSlides(project: ProjectDetails): ProjectDetails['slides'] {
  if (project.slides.length > 0) return project.slides;
  return [
    {
      id: `${project.id}-synthetic-slide`,
      projectId: project.id,
      slideNumber: 1,
      title: project.name,
      content: project.content || project.description || 'Opening message',
      speakerNotes: '',
    },
  ];
}

export async function generateGamePlan(projectId: string): Promise<GamePlan | null> {
  const project = await getProject(projectId);
  if (!project) return null;

  const slides = ensureSlides(project);
  const rehearsalRuns = (await listRuns(projectId)).filter((run) => run.mode === 'rehearsal');
  const scores = rehearsalRuns
    .map((run) => run.overallScore)
    .filter((score): score is number => typeof score === 'number');
  const segments = await refreshRiskSegments(projectId);

  const slideSegments = slides.map((slide) => {
    const relatedSegments = segments.filter((segment) => segment.slideNumber === slide.slideNumber);
    const riskLevel = riskLevelForSlide(relatedSegments);
    const knownIssues = relatedSegments.flatMap((segment) => segment.notes.split(' | ')).filter(Boolean).slice(0, 3);
    const preparedCues = Array.from(new Set(relatedSegments.flatMap((segment) => cuesForRiskType(segment.riskType)))).slice(0, 4);
    const recoveryPhrases = relatedSegments
      .flatMap((segment) => segment.bestRecovery.split(' | '))
      .map((phrase) => phrase.trim())
      .filter(Boolean)
      .slice(0, 3);

    return {
      slideNumber: slide.slideNumber,
      slideTitle: slide.title,
      riskLevel,
      knownIssues,
      preparedCues,
      recoveryPhrases,
      interventionPolicy: recoveryPhrases.length > 0 && riskLevel === 'fragile'
        ? 'teleprompter'
        : interventionPolicyForRisk(riskLevel),
    };
  });

  const prioritySlides = slideSegments
    .slice()
    .sort((left, right) => {
      const riskRank = { safe: 0, watch: 1, fragile: 2 };
      return riskRank[right.riskLevel] - riskRank[left.riskLevel];
    })
    .filter((segment) => segment.riskLevel !== 'safe')
    .slice(0, 5)
    .map((segment) => segment.slideNumber);

  const plan: GamePlan = {
    id: crypto.randomUUID(),
    projectId,
    runCount: rehearsalRuns.length,
    createdAt: new Date().toISOString(),
    overview: {
      totalRuns: rehearsalRuns.length,
      avgScore: scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1)) : 0,
      trend: calculateTrend(scores),
    },
    segments: slideSegments,
    attentionBudget: {
      maxInterventions: Math.max(1, Math.min(6, prioritySlides.length * 2 || 2)),
      prioritySlides,
    },
    timingStrategy: buildTimingStrategy(slides.length, rehearsalRuns, prioritySlides),
  };

  return saveGamePlan(plan);
}
