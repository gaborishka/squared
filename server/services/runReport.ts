import type {
  ProjectDetails,
  RiskLevel,
  RunDetails,
  RunFeedback,
  RunReport,
  RunReportComparison,
  RunReportHighlight,
  RunReportSlideCard,
  RunSummary,
} from '../../shared/types.js';
import { getProject, getRun, listRuns } from '../db/queries.js';

function findComparisonRunFromRuns(runs: RunSummary[], run: RunDetails): RunSummary | null {
  const currentIndex = runs.findIndex((candidate) => candidate.id === run.id);
  if (currentIndex === -1) return null;

  for (let index = currentIndex + 1; index < runs.length; index += 1) {
    const candidate = runs[index];
    if (candidate?.mode === run.mode) return candidate;
  }

  return null;
}

function findComparisonRun(run: RunDetails): RunSummary | null {
  if (!run.projectId) return null;

  return findComparisonRunFromRuns(listRuns(run.projectId), run);
}

function getEarlierRuns(run: RunDetails): RunDetails[] {
  if (!run.projectId) return [];

  const runs = listRuns(run.projectId);
  const currentIndex = runs.findIndex((candidate) => candidate.id === run.id);
  if (currentIndex === -1) return [];

  return runs
    .slice(currentIndex + 1)
    .filter((candidate) => candidate.mode === run.mode)
    .map((candidate) => getRun(candidate.id))
    .filter((candidate): candidate is RunDetails => Boolean(candidate));
}

function toVerdict(run: RunDetails): RunReport['verdict'] {
  const fragileSlides = run.slideAnalyses.filter((analysis) => analysis.riskLevel === 'fragile').length;
  const warnings = run.feedbacks.filter((feedback) => feedback.severity !== 'info').length;
  const score = run.overallScore ?? 0;

  if (score >= 80 && fragileSlides === 0 && warnings <= 1) return 'strong';
  if (score >= 62 && fragileSlides <= 1) return 'mixed';
  return 'needs_work';
}

function formatVerdictLabel(verdict: RunReport['verdict']): string {
  if (verdict === 'strong') return 'The run was strong overall';
  if (verdict === 'mixed') return 'The run had solid moments';
  return 'The run still needs another pass';
}

function buildSummary(run: RunDetails, project: ProjectDetails | null, riskySlides: number[], comparison: RunReportComparison | null): string {
  const score = run.overallScore != null ? `${Math.round(run.overallScore)} overall` : 'a usable read on the session';
  const slideText = riskySlides.length > 0 ? `The main pressure points were slides ${riskySlides.join(', ')}.` : 'No single slide dominated the risk profile.';
  const comparisonText =
    comparison?.overallScoreDelta == null
      ? ''
      : comparison.overallScoreDelta > 0
        ? `This was up ${Math.round(comparison.overallScoreDelta)} points from the previous ${run.mode} run.`
        : comparison.overallScoreDelta < 0
          ? `This was down ${Math.round(Math.abs(comparison.overallScoreDelta))} points from the previous ${run.mode} run.`
          : 'This landed roughly in line with the previous run.';

  return [
    `${formatVerdictLabel(toVerdict(run))} for ${project?.name || 'this project'}, finishing with ${score}.`,
    slideText,
    comparisonText,
  ]
    .filter(Boolean)
    .join(' ');
}

function groupFeedbackBySlide(feedbacks: RunFeedback[]): Map<number, RunFeedback[]> {
  const grouped = new Map<number, RunFeedback[]>();

  for (const feedback of feedbacks) {
    if (feedback.slideNumber == null) continue;
    const bucket = grouped.get(feedback.slideNumber) ?? [];
    bucket.push(feedback);
    grouped.set(feedback.slideNumber, bucket);
  }

  return grouped;
}

function feedbackRiskLevel(feedbacks: RunFeedback[]): RiskLevel {
  if (feedbacks.some((feedback) => feedback.severity === 'critical')) return 'fragile';
  if (feedbacks.some((feedback) => feedback.severity === 'warning')) return 'watch';
  return 'safe';
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function buildSlideCards(run: RunDetails, project: ProjectDetails | null, earlierRuns: RunDetails[]): RunReportSlideCard[] {
  const slideTitleByNumber = new Map(project?.slides.map((slide) => [slide.slideNumber, slide.title]) ?? []);
  const feedbackBySlide = groupFeedbackBySlide(run.feedbacks);
  const slideNumbers = new Set<number>([
    ...run.slideAnalyses.map((analysis) => analysis.slideNumber),
    ...feedbackBySlide.keys(),
  ]);

  return [...slideNumbers]
    .sort((left, right) => left - right)
    .map((slideNumber) => {
      const analysis = run.slideAnalyses.find((entry) => entry.slideNumber === slideNumber);
      const feedbacks = feedbackBySlide.get(slideNumber) ?? [];
      const issues = uniqueStrings([
        ...(analysis?.issues ?? []),
        ...feedbacks.map((feedback) => feedback.message),
      ]).slice(0, 4);
      const riskLevel = analysis?.riskLevel ?? feedbackRiskLevel(feedbacks);
      const repeatedFromHistory = earlierRuns.some((previous) =>
        previous.slideAnalyses.some((entry) => entry.slideNumber === slideNumber && entry.riskLevel !== 'safe')
        || previous.feedbacks.some((feedback) => feedback.slideNumber === slideNumber && feedback.severity !== 'info'),
      );

      return {
        slideNumber,
        slideTitle: slideTitleByNumber.get(slideNumber) ?? `Slide ${slideNumber}`,
        riskLevel,
        issues,
        bestPhrase: analysis?.bestPhrase ?? '',
        repeatedFromHistory,
      };
    });
}

function buildComparison(run: RunDetails, comparisonRun: RunSummary | null): RunReportComparison | null {
  if (!comparisonRun) return null;

  return {
    overallScoreDelta: run.overallScore != null && comparisonRun.overallScore != null
      ? Number((run.overallScore - comparisonRun.overallScore).toFixed(1))
      : null,
    avgPaceWpmDelta: run.avgPaceWpm != null && comparisonRun.avgPaceWpm != null
      ? Number((run.avgPaceWpm - comparisonRun.avgPaceWpm).toFixed(1))
      : null,
    avgConfidenceDelta: run.avgConfidence != null && comparisonRun.avgConfidence != null
      ? Number((run.avgConfidence - comparisonRun.avgConfidence).toFixed(1))
      : null,
    fillerWordCountDelta: Number((run.fillerWordCount - comparisonRun.fillerWordCount).toFixed(1)),
    eyeContactPctDelta: run.eyeContactPct != null && comparisonRun.eyeContactPct != null
      ? Number((run.eyeContactPct - comparisonRun.eyeContactPct).toFixed(1))
      : null,
    postureGoodPctDelta: run.postureGoodPct != null && comparisonRun.postureGoodPct != null
      ? Number((run.postureGoodPct - comparisonRun.postureGoodPct).toFixed(1))
      : null,
  };
}

function buildWins(run: RunDetails, fillerPerMinute: number | null): string[] {
  const wins: string[] = [];

  if ((run.overallScore ?? 0) >= 75) wins.push('Overall delivery held together well across most of the session.');
  if ((run.avgConfidence ?? 0) >= 70) wins.push('Confidence stayed high enough to keep the talk feeling intentional.');
  if ((run.eyeContactPct ?? 0) >= 65) wins.push('Eye contact stayed steady enough to make the delivery feel direct.');
  if ((run.postureGoodPct ?? 0) >= 70) wins.push('Posture looked composed, which supported a more confident presence.');
  if (fillerPerMinute != null && fillerPerMinute <= 2) wins.push('Filler usage stayed controlled, so the message sounded cleaner.');

  const recovery = run.slideAnalyses.find((analysis) => Boolean(analysis.bestPhrase));
  if (recovery?.bestPhrase) {
    wins.push(`You captured a recovery phrase on slide ${recovery.slideNumber} that can be reused in the next run.`);
  }

  return wins.slice(0, 3);
}

function buildRisks(run: RunDetails, fillerPerMinute: number | null, slideCards: RunReportSlideCard[]): string[] {
  const risks: string[] = [];
  const fragileSlides = slideCards.filter((slide) => slide.riskLevel === 'fragile').map((slide) => slide.slideNumber);

  if (run.avgPaceWpm != null && run.avgPaceWpm > 170) {
    risks.push(`Average pace reached ${Math.round(run.avgPaceWpm)} WPM, which is likely compressing transitions.`);
  } else if (run.avgPaceWpm != null && run.avgPaceWpm < 105) {
    risks.push(`Average pace fell to ${Math.round(run.avgPaceWpm)} WPM, which can make the talk feel hesitant.`);
  }

  if (fillerPerMinute != null && fillerPerMinute > 3) {
    risks.push(`Filler words are still appearing at ${fillerPerMinute.toFixed(1)}/min, which is high enough to muddy key points.`);
  }

  if ((run.eyeContactPct ?? 100) < 55) risks.push('Eye contact dropped too often, so the delivery can feel less direct on camera.');
  if ((run.postureGoodPct ?? 100) < 60) risks.push('Posture consistency is still soft, which can read as hesitation.');
  if (fragileSlides.length > 0) risks.push(`Slides ${fragileSlides.join(', ')} are still the main breakpoints from this session.`);

  if (risks.length === 0 && run.feedbacks.length > 0) {
    risks.push('The remaining issue is consistency: coaching was still needed even when the run mostly held together.');
  }

  return risks.slice(0, 3);
}

function buildNextSteps(run: RunDetails, fillerPerMinute: number | null, slideCards: RunReportSlideCard[]): string[] {
  const nextSteps: string[] = [];
  const riskySlides = slideCards.filter((slide) => slide.riskLevel !== 'safe').map((slide) => slide.slideNumber);
  const repeatedSlides = slideCards.filter((slide) => slide.repeatedFromHistory).map((slide) => slide.slideNumber);

  if (riskySlides.length > 0) {
    nextSteps.push(`Run slides ${riskySlides.join(', ')} in isolation until the transition into each one feels automatic.`);
  }
  if (repeatedSlides.length > 0) {
    nextSteps.push(`Spend one extra pass on slides ${repeatedSlides.join(', ')} because they are repeating from earlier sessions.`);
  }
  if (run.avgPaceWpm != null && (run.avgPaceWpm > 170 || run.avgPaceWpm < 105)) {
    nextSteps.push('Do one timed pass focused only on pace, keeping delivery in a steady 105-170 WPM lane.');
  }
  if (fillerPerMinute != null && fillerPerMinute > 3) {
    nextSteps.push('Redo the opening and each transition beat with a deliberate pause instead of speaking through silence.');
  }
  if ((run.eyeContactPct ?? 100) < 55 || (run.postureGoodPct ?? 100) < 60) {
    nextSteps.push('Practice one short camera-on run focused only on visual presence and posture discipline.');
  }

  if (nextSteps.length === 0) {
    nextSteps.push('Repeat the full run once more and try to make the strongest moments feel repeatable, not accidental.');
  }

  return nextSteps.slice(0, 3);
}

function feedbackHighlightType(feedback: RunFeedback): RunReportHighlight['type'] {
  if (feedback.severity === 'critical' || feedback.severity === 'warning') return 'risk';
  return 'win';
}

function buildHighlights(run: RunDetails): RunReportHighlight[] {
  const feedbackHighlights = run.feedbacks.slice(0, 4).map((feedback) => ({
    timestamp: feedback.timestamp,
    slideNumber: feedback.slideNumber,
    type: feedbackHighlightType(feedback),
    severity: feedback.severity,
    message: feedback.message,
  }));

  const recoveryHighlights = run.slideAnalyses
    .filter((analysis) => Boolean(analysis.bestPhrase))
    .slice(0, 2)
    .map((analysis) => ({
      timestamp: run.feedbacks.find((feedback) => feedback.slideNumber === analysis.slideNumber)?.timestamp ?? 'End',
      slideNumber: analysis.slideNumber,
      type: 'recovery' as const,
      severity: 'info' as const,
      message: `Recovery phrase captured: "${analysis.bestPhrase}"`,
    }));

  return [...feedbackHighlights, ...recoveryHighlights].slice(0, 6);
}

export function buildRunReport(run: RunDetails): RunReport {
  const project = run.projectId ? getProject(run.projectId) : null;
  const comparisonRun = findComparisonRun(run);
  const comparison = buildComparison(run, comparisonRun);
  const earlierRuns = getEarlierRuns(run);
  const slideCards = buildSlideCards(run, project, earlierRuns);
  const riskySlides = slideCards.filter((slide) => slide.riskLevel !== 'safe').map((slide) => slide.slideNumber);
  const minutes = run.duration > 0 ? run.duration / 60000 : 0;
  const fillerPerMinute = minutes > 0 ? run.fillerWordCount / minutes : null;

  return {
    verdict: toVerdict(run),
    summary: buildSummary(run, project, riskySlides, comparison),
    wins: buildWins(run, fillerPerMinute),
    risks: buildRisks(run, fillerPerMinute, slideCards),
    nextSteps: buildNextSteps(run, fillerPerMinute, slideCards),
    highlights: buildHighlights(run),
    slideCards,
    comparison,
  };
}

export function attachRunReport(run: RunDetails): RunDetails {
  return {
    ...run,
    runReport: buildRunReport(run),
  };
}
