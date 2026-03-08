import crypto from 'node:crypto';
import type {
  FeedbackCategory,
  ProjectAnalysis,
  ProjectDetails,
  RiskLevel,
  RiskSegment,
  RiskType,
  RunDetails,
} from '../../shared/types.js';
import {
  getLatestGamePlan,
  getProject,
  getRun,
  listRiskSegments,
  listRuns,
  replaceRiskSegments,
} from '../db/queries.js';

type MutableRiskBucket = {
  id: string;
  projectId: string;
  slideNumber: number | null;
  riskType: RiskType;
  frequency: number;
  severityTotal: number;
  lastOccurrence: string;
  recoveries: Set<string>;
  notes: Set<string>;
};

function calculateTrend(scores: number[]): ProjectAnalysis['trend'] {
  if (scores.length < 2) return 'stable';
  const latest = scores[0];
  const earliest = scores[scores.length - 1];
  if (latest >= earliest + 5) return 'improving';
  if (latest <= earliest - 5) return 'declining';
  return 'stable';
}

function severityFromRiskLevel(riskLevel: RiskLevel): number {
  if (riskLevel === 'fragile') return 0.92;
  if (riskLevel === 'watch') return 0.6;
  return 0.25;
}

function severityFromFeedback(category: FeedbackCategory | null, message: string): number {
  if (category === 'content' || category === 'structure') return 0.78;
  if (/freeze|stuck|lost|confused/i.test(message)) return 0.86;
  if (/too fast|too slow|filler|look away|slouch/i.test(message)) return 0.68;
  return 0.42;
}

function mapCategoryToRiskType(category: FeedbackCategory | null, message: string): RiskType {
  if (category === 'pace') return 'pace_spike';
  if (category === 'eye_contact') return 'eye_contact_loss';
  if (category === 'posture') return 'confidence_drop';
  if (category === 'filler') return 'filler_cluster';
  if (category === 'structure') return 'structure_drift';

  const lower = message.toLowerCase();
  if (lower.includes('filler')) return 'filler_cluster';
  if (lower.includes('eye') || lower.includes('look')) return 'eye_contact_loss';
  if (lower.includes('fast') || lower.includes('slow') || lower.includes('pace')) return 'pace_spike';
  if (lower.includes('freeze') || lower.includes('stuck') || lower.includes('lost')) return 'freeze';
  return 'confidence_drop';
}

function inferRiskTypes(issue: string): RiskType[] {
  const lower = issue.toLowerCase();
  const risks = new Set<RiskType>();
  if (lower.includes('filler')) risks.add('filler_cluster');
  if (lower.includes('fast') || lower.includes('slow') || lower.includes('pace')) risks.add('pace_spike');
  if (lower.includes('eye') || lower.includes('camera') || lower.includes('contact')) risks.add('eye_contact_loss');
  if (lower.includes('freeze') || lower.includes('stuck') || lower.includes('transition') || lower.includes('lost')) risks.add('freeze');
  if (lower.includes('structure') || lower.includes('order')) risks.add('structure_drift');
  if (risks.size === 0) risks.add('confidence_drop');
  return [...risks];
}

function getRunDetailsForProject(projectId: string): RunDetails[] {
  return listRuns(projectId)
    .map((run) => getRun(run.id))
    .filter((run): run is RunDetails => Boolean(run));
}

function upsertBucket(
  buckets: Map<string, MutableRiskBucket>,
  payload: {
    projectId: string;
    slideNumber: number | null;
    riskType: RiskType;
    severity: number;
    note: string;
    recovery?: string;
    occurredAt: string;
  },
): void {
  const key = `${payload.slideNumber ?? 'global'}:${payload.riskType}`;
  const bucket = buckets.get(key) ?? {
    id: crypto.randomUUID(),
    projectId: payload.projectId,
    slideNumber: payload.slideNumber,
    riskType: payload.riskType,
    frequency: 0,
    severityTotal: 0,
    lastOccurrence: payload.occurredAt,
    recoveries: new Set<string>(),
    notes: new Set<string>(),
  };

  bucket.frequency += 1;
  bucket.severityTotal += payload.severity;
  bucket.lastOccurrence = payload.occurredAt > bucket.lastOccurrence ? payload.occurredAt : bucket.lastOccurrence;
  if (payload.note) bucket.notes.add(payload.note);
  if (payload.recovery) bucket.recoveries.add(payload.recovery);
  buckets.set(key, bucket);
}

function toRiskLevel(score: number): RiskLevel {
  if (score >= 0.74) return 'fragile';
  if (score >= 0.42) return 'watch';
  return 'safe';
}

function buildSlideSummary(project: ProjectDetails, segments: RiskSegment[]): ProjectAnalysis['slideSummary'] {
  return project.slides.map((slide) => {
    const slideSegments = segments.filter((segment) => segment.slideNumber === slide.slideNumber);
    const issueCount = slideSegments.reduce((total, segment) => total + segment.frequency, 0);
    const highestSeverity = Math.max(0, ...slideSegments.map((segment) => segment.avgSeverity));
    return {
      slideNumber: slide.slideNumber,
      title: slide.title,
      riskLevel: toRiskLevel(highestSeverity),
      issueCount,
      sampleIssues: slideSegments.flatMap((segment) => segment.notes.split(' | ')).filter(Boolean).slice(0, 3),
    };
  });
}

export function refreshRiskSegments(projectId: string): RiskSegment[] {
  const runs = getRunDetailsForProject(projectId).filter((run) => run.mode === 'rehearsal');
  const buckets = new Map<string, MutableRiskBucket>();

  for (const run of runs) {
    for (const analysis of run.slideAnalyses) {
      const issues = analysis.issues.length > 0 ? analysis.issues : ['confidence wobble'];
      const severity = severityFromRiskLevel(analysis.riskLevel);
      for (const issue of issues) {
        for (const riskType of inferRiskTypes(issue)) {
          upsertBucket(buckets, {
            projectId,
            slideNumber: analysis.slideNumber,
            riskType,
            severity,
            note: issue,
            recovery: analysis.bestPhrase,
            occurredAt: run.createdAt,
          });
        }
      }
    }

    for (const feedback of run.feedbacks) {
      if (feedback.slideNumber == null) continue;
      upsertBucket(buckets, {
        projectId,
        slideNumber: feedback.slideNumber,
        riskType: mapCategoryToRiskType(feedback.category, feedback.message),
        severity: severityFromFeedback(feedback.category, feedback.message),
        note: feedback.message,
        occurredAt: run.createdAt,
      });
    }
  }

  const segments: RiskSegment[] = [...buckets.values()].map((bucket) => ({
    id: bucket.id,
    projectId: bucket.projectId,
    slideNumber: bucket.slideNumber,
    riskType: bucket.riskType,
    frequency: bucket.frequency,
    avgSeverity: Number((bucket.severityTotal / Math.max(bucket.frequency, 1)).toFixed(2)),
    lastOccurrence: bucket.lastOccurrence,
    bestRecovery: [...bucket.recoveries].filter(Boolean).slice(0, 3).join(' | '),
    notes: [...bucket.notes].slice(0, 4).join(' | '),
  }));

  return replaceRiskSegments(
    projectId,
    segments.sort((left, right) => {
      const slideDelta = (left.slideNumber ?? 9999) - (right.slideNumber ?? 9999);
      if (slideDelta !== 0) return slideDelta;
      return right.avgSeverity - left.avgSeverity;
    }),
  );
}

export function getProjectAnalysis(projectId: string): ProjectAnalysis | null {
  const project = getProject(projectId);
  if (!project) return null;

  const runs = listRuns(projectId);
  const scores = runs
    .filter((run) => run.mode === 'rehearsal')
    .map((run) => run.overallScore)
    .filter((score): score is number => typeof score === 'number');
  const riskSegments = refreshRiskSegments(projectId);

  return {
    projectId,
    totalRuns: runs.length,
    rehearsalRuns: runs.filter((run) => run.mode === 'rehearsal').length,
    presentationRuns: runs.filter((run) => run.mode === 'presentation').length,
    avgScore: scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1)) : 0,
    latestScore: runs.find((run) => run.mode === 'rehearsal' && run.overallScore != null)?.overallScore ?? null,
    trend: calculateTrend(scores),
    riskSegments,
    slideSummary: buildSlideSummary(project, riskSegments),
    latestGamePlan: getLatestGamePlan(projectId),
  };
}

export function readStoredRiskSegments(projectId: string): RiskSegment[] {
  return listRiskSegments(projectId);
}
