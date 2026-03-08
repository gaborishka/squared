import type {
  AgentMode,
  GamePlan,
  IndicatorData,
  ProjectAnalysis,
  ProjectDetails,
  RunFeedback,
  SlideAnalysisToolPayload,
} from '../types';

export interface SessionMetricsTracker {
  paceSamples: number[];
  confidenceSamples: number[];
  overallSamples: number[];
  fillerWordCount: number;
  eyeSamples: number;
  eyePositive: number;
  postureSamples: number;
  posturePositive: number;
}

export function createSessionMetricsTracker(): SessionMetricsTracker {
  return {
    paceSamples: [],
    confidenceSamples: [],
    overallSamples: [],
    fillerWordCount: 0,
    eyeSamples: 0,
    eyePositive: 0,
    postureSamples: 0,
    posturePositive: 0,
  };
}

export function ingestIndicatorSample(tracker: SessionMetricsTracker, indicators: IndicatorData): void {
  if (typeof indicators.paceWpm === 'number' && !Number.isNaN(indicators.paceWpm)) {
    tracker.paceSamples.push(indicators.paceWpm);
  }
  if (typeof indicators.confidenceScore === 'number') {
    tracker.confidenceSamples.push(indicators.confidenceScore);
  }
  if (typeof indicators.overallScore === 'number') {
    tracker.overallSamples.push(indicators.overallScore);
  }
  tracker.fillerWordCount = Math.max(tracker.fillerWordCount, indicators.fillerWords.total);

  const eye = indicators.eyeContact.toLowerCase();
  if (eye && !eye.includes('analyzing') && !eye.includes('calibrating') && !eye.includes('not visible')) {
    tracker.eyeSamples += 1;
    if (eye.includes('camera')) tracker.eyePositive += 1;
  }

  const posture = indicators.posture.toLowerCase();
  if (posture && !posture.includes('analyzing') && !posture.includes('calibrating') && !posture.includes('not visible')) {
    tracker.postureSamples += 1;
    if (posture.includes('upright') || posture.includes('good')) tracker.posturePositive += 1;
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

export function summarizeSessionMetrics(tracker: SessionMetricsTracker) {
  return {
    avgPaceWpm: average(tracker.paceSamples),
    avgConfidence: average(tracker.confidenceSamples),
    fillerWordCount: tracker.fillerWordCount,
    eyeContactPct: tracker.eyeSamples > 0 ? Number(((tracker.eyePositive / tracker.eyeSamples) * 100).toFixed(1)) : null,
    postureGoodPct: tracker.postureSamples > 0 ? Number(((tracker.posturePositive / tracker.postureSamples) * 100).toFixed(1)) : null,
    overallScore: average(tracker.overallSamples),
  };
}

export function formatTimestampFromStart(sessionStartTime: number | null): string {
  if (!sessionStartTime) return '00:00';
  const diffMs = Date.now() - sessionStartTime;
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function feedbackCategoryFromMessage(message: string): RunFeedback['category'] {
  const lower = message.toLowerCase();
  if (lower.includes('pace') || lower.includes('fast') || lower.includes('slow') || lower.includes('volume')) return 'pace';
  if (lower.includes('eye') || lower.includes('camera') || lower.includes('look')) return 'eye_contact';
  if (lower.includes('posture') || lower.includes('slouch') || lower.includes('upright')) return 'posture';
  if (lower.includes('filler') || lower.includes('um') || lower.includes('uh')) return 'filler';
  if (lower.includes('transition') || lower.includes('structure') || lower.includes('outline')) return 'structure';
  if (lower.includes('point') || lower.includes('content') || lower.includes('evidence')) return 'content';
  return null;
}

export function feedbackSeverityFromAgentMode(agentMode: AgentMode): RunFeedback['severity'] {
  if (agentMode === 'rescue') return 'critical';
  if (agentMode === 'directive') return 'warning';
  return 'info';
}

export function mergeSlideAnalysis(
  current: Map<number, Omit<SlideAnalysisToolPayload, 'slideNumber'> & { slideNumber: number }>,
  payload: SlideAnalysisToolPayload,
): Map<number, Omit<SlideAnalysisToolPayload, 'slideNumber'> & { slideNumber: number }> {
  const next = new Map(current);
  const existing = next.get(payload.slideNumber);
  next.set(payload.slideNumber, {
    slideNumber: payload.slideNumber,
    riskLevel:
      payload.riskLevel === 'fragile' || existing?.riskLevel === 'fragile'
        ? 'fragile'
        : payload.riskLevel === 'watch' || existing?.riskLevel === 'watch'
          ? 'watch'
          : 'safe',
    issues: Array.from(new Set([...(existing?.issues ?? []), ...payload.issues])),
    bestPhrase: payload.bestPhrase || existing?.bestPhrase || '',
  });
  return next;
}

function buildSlideOutline(project: ProjectDetails): string {
  if (project.slides.length === 0) {
    return `Project: ${project.name}\nDescription: ${project.description || 'No description'}\nMain content:\n${project.content || 'No uploaded content yet.'}`;
  }

  return project.slides
    .map((slide) =>
      [
        `Slide ${slide.slideNumber}: ${slide.title}`,
        slide.content ? `Content: ${slide.content}` : '',
        slide.speakerNotes ? `Speaker notes: ${slide.speakerNotes}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');
}

export function buildRehearsalContext(project: ProjectDetails, analysis: ProjectAnalysis | null): string {
  const riskSummary = analysis?.riskSegments.length
    ? analysis.riskSegments
        .slice(0, 8)
        .map((segment) =>
          `Slide ${segment.slideNumber ?? '?'}: ${segment.riskType} (${segment.frequency}x, severity ${segment.avgSeverity}) | notes: ${segment.notes} | recovery: ${segment.bestRecovery || 'n/a'}`,
        )
        .join('\n')
    : 'No prior rehearsal history yet.';

  return [
    `Project name: ${project.name}`,
    project.description ? `Project description: ${project.description}` : '',
    'Presentation structure:',
    buildSlideOutline(project),
    'Prior weak spots and risky transitions:',
    riskSummary,
    'Instructions:',
    '- Track which slide the speaker is currently on.',
    '- Use updateIndicators for live UI/HUD updates, including currentSlide and microPrompt when useful.',
    '- Use saveSlideAnalysis for each slide where you identify issues or a strong recovery phrase.',
    '- In rehearsal mode you may interrupt briefly with spoken feedback when the user drifts badly.',
    '- If this is a repeated trouble spot from history, mention that context explicitly.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildPresentationContext(project: ProjectDetails, gamePlan: GamePlan): string {
  const segments = gamePlan.segments
    .map((segment) =>
      [
        `Slide ${segment.slideNumber}: ${segment.slideTitle}`,
        `Risk: ${segment.riskLevel}`,
        `Known issues: ${segment.knownIssues.join(', ') || 'none'}`,
        `Prepared cues: ${segment.preparedCues.join(', ') || 'none'}`,
        `Recovery phrases: ${segment.recoveryPhrases.join(' | ') || 'none'}`,
        `Intervention policy: ${segment.interventionPolicy}`,
        `Target seconds: ${gamePlan.timingStrategy.perSlideTargets[segment.slideNumber] ?? 'n/a'}`,
      ].join('\n'),
    )
    .join('\n\n');

  return [
    `Project name: ${project.name}`,
    project.description ? `Project description: ${project.description}` : '',
    'Presentation structure:',
    buildSlideOutline(project),
    'Game plan:',
    `Total rehearsal runs used: ${gamePlan.runCount}`,
    `Trend: ${gamePlan.overview.trend}`,
    `Average score: ${gamePlan.overview.avgScore}`,
    `Attention budget: max ${gamePlan.attentionBudget.maxInterventions} interventions. Priority slides: ${gamePlan.attentionBudget.prioritySlides.join(', ') || 'none'}.`,
    segments,
    'Instructions:',
    '- Do not speak. Use updateIndicators only.',
    '- Keep microPrompt extremely short, ideally 1-3 words.',
    '- Use rescueText only when the user is clearly stuck and you have a recovery phrase or concise teleprompter line.',
    '- Include currentSlide, slideTimeRemaining, and agentMode in updates.',
    '- Respect the attention budget and favor interventions on priority slides.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
