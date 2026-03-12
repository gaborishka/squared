import type {
  AgentMode,
  AudienceAgentState,
  DeliveryAgentState,
  GamePlan,
  IndicatorData,
  LiveMemoryCue,
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

const MAX_SLIDE_CONTENT_CHARS = 300;
const MAX_SLIDE_NOTES_CHARS = 200;
const MAX_OUTLINE_CHARS = 8000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}

function buildSlideOutline(project: ProjectDetails): string {
  if (project.slides.length === 0) {
    return `Project: ${project.name}\nDescription: ${project.description || 'No description'}\nMain content:\n${truncate(project.content || 'No uploaded content yet.', MAX_SLIDE_CONTENT_CHARS)}`;
  }

  let outline = '';
  for (const slide of project.slides) {
    const parts = [`Slide ${slide.slideNumber}: ${slide.title}`];
    if (slide.content) parts.push(`Content: ${truncate(slide.content, MAX_SLIDE_CONTENT_CHARS)}`);
    if (slide.speakerNotes) parts.push(`Speaker notes: ${truncate(slide.speakerNotes, MAX_SLIDE_NOTES_CHARS)}`);
    const entry = parts.join('\n');
    if (outline.length + entry.length + 2 > MAX_OUTLINE_CHARS) {
      outline += `\n\n... (${project.slides.length - project.slides.indexOf(slide)} more slides omitted for brevity)`;
      break;
    }
    outline += (outline ? '\n\n' : '') + entry;
  }
  return outline;
}

function buildMemorySummary(memoryBySlide: Record<number, LiveMemoryCue[]> | null | undefined): string {
  if (!memoryBySlide) return 'No rehearsal memory indexed yet.';

  const lines = Object.entries(memoryBySlide)
    .map(([slideNumber, cues]) => {
      const cue = cues[0];
      if (!cue) return null;
      return `Slide ${slideNumber}: ${cue.cueText} (${cue.sourceType}, score ${cue.similarityScore.toFixed(2)})`;
    })
    .filter((value): value is string => Boolean(value))
    .slice(0, 6);

  return lines.length > 0 ? lines.join('\n') : 'No rehearsal memory indexed yet.';
}

export function buildRehearsalContext(
  project: ProjectDetails,
  analysis: ProjectAnalysis | null,
  memoryBySlide?: Record<number, LiveMemoryCue[]> | null,
): string {
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
    'Historical memory cues:',
    buildMemorySummary(memoryBySlide),
    'Instructions:',
    '- Track which slide the speaker is currently on.',
    '- Use updateIndicators for live UI/HUD updates, including currentSlide.',
    '- Set microPrompt for concise visual cues shown as a subtitle overlay on the speaker\'s screen (e.g. "Slow down", "Eye contact"). Set rescueText when the speaker is stuck. Both require agentMode other than "monitor" to appear.',
    '- Use saveSlideAnalysis for each slide where you identify issues or a strong recovery phrase.',
    '- In rehearsal mode you may interrupt briefly with spoken feedback when the user drifts badly.',
    '- If this is a repeated trouble spot from history, mention that context explicitly.',
    '- When a historical memory cue is relevant, ground your advice in that prior weak spot or recovery phrase.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function resolveLiveMemoryCue(
  memoryBySlide: Record<number, LiveMemoryCue[]> | null | undefined,
  currentSlide: number | null,
): LiveMemoryCue | null {
  if (!memoryBySlide || currentSlide == null) return null;
  return memoryBySlide[currentSlide]?.[0] ?? null;
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
    '- microPrompt and rescueText are rendered as a subtitle overlay on the speaker\'s screen — they are your only way to communicate with the speaker during the live presentation.',
    '- Keep microPrompt extremely short, ideally 1-3 words. Set microPrompt to "" (empty string) when the cue is no longer needed.',
    '- Use rescueText only when the user is clearly stuck and you have a recovery phrase or concise teleprompter line. Set rescueText to "" when no longer needed.',
    '- Set agentMode to "monitor" when no intervention is needed, "soft_cue" for gentle hints, "directive" for strong guidance, "rescue" for emergencies. The subtitle overlay only appears when agentMode is not "monitor".',
    '- Include currentSlide, slideTimeRemaining, and agentMode in every update.',
    '- Respect the attention budget and favor interventions on priority slides.',
    '',
    'TIME STRATEGY — Content-Aware Pacing:',
    '- Track elapsed time against per-slide targets. Communicate strategic time decisions via microPrompt.',
    '- If the speaker is running behind schedule: use cues like "Wrap up", "Skip example", "Jump ahead".',
    '- If the speaker has extra time: "Elaborate here", "Add detail".',
    '- When total time is critically short, use agentMode "directive" and suggest which remaining slides to skip or compress.',
    '- Prioritize key-message slides over supporting-evidence slides when time is tight.',
    '---',
    'NARRATIVE THREAD — Content Navigation:',
    '- Track which key points from each slide\'s content and speaker notes have been covered by the speaker.',
    '- If the speaker goes off-track or misses a critical point, use microPrompt to guide back: "Back to [topic]", "Key point: [topic]".',
    '- If the speaker is completely lost or frozen, use rescueText with the next logical sentence based on the slide content and speaker notes.',
    '- Track the argument\'s logical flow across slides. If the speaker jumps slides or skips a critical transition, provide a bridging cue via microPrompt.',
    '- When recovery phrases exist for the current slide in the game plan, prefer those over generating new text.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildDeliveryContext(options: {
  mode: 'rehearsal' | 'presentation';
  project: ProjectDetails;
  analysis?: ProjectAnalysis | null;
  gamePlan?: GamePlan | null;
  memoryBySlide?: Record<number, LiveMemoryCue[]> | null;
}): string {
  const base = options.mode === 'rehearsal'
    ? buildRehearsalContext(options.project, options.analysis ?? null, options.memoryBySlide ?? null)
    : buildPresentationContext(options.project, options.gamePlan ?? options.analysis?.latestGamePlan ?? {
      id: 'fallback',
      projectId: options.project.id,
      runCount: 0,
      createdAt: '',
      overview: { totalRuns: 0, avgScore: 0, trend: 'stable' },
      segments: [],
      attentionBudget: { maxInterventions: 0, prioritySlides: [] },
      timingStrategy: { totalTargetMinutes: 0, perSlideTargets: {} },
    });

  return [
    base,
    'Audience agent coordination:',
    '- You may receive trusted user messages prefixed with "[AudienceAgent]" that summarize audience engagement from the video call gallery view.',
    '- Treat those messages as reliable audience observations.',
    '- In rehearsal mode, audience monitoring is not available.',
    '- In presentation mode, adapt your delivery lane cues based on audience signals (engagement drops, raised hands, confused reactions).',
  ].join('\n\n');
}

export function buildAudienceAgentContext(options: {
  mode: 'rehearsal' | 'presentation';
  project: ProjectDetails;
  analysis?: ProjectAnalysis | null;
  gamePlan?: GamePlan | null;
}): string {
  return [
    `Project name: ${options.project.name}`,
    options.project.description ? `Project description: ${options.project.description}` : '',
    `Session mode: ${options.mode}`,
    'Instructions:',
    '- You observe the video call gallery view showing audience participants.',
    '- Your only outward action is updateAudienceState; do not narrate, chat, or coach directly.',
    '- Watch for: engagement (attentive vs distracted/multitasking), reactions (confused, nodding, bored, excited), hands raised (Zoom/Meet UI or physical).',
    '- Report meaningful changes via updateAudienceState. Do not spam minor fluctuations.',
    '- Keep audiencePrompt short and actionable for the speaker. Put richer context in audienceDetails.',
    '- Set priority to "critical" when hands are raised or engagement drops sharply. Use "watch" for gradual declines. Use "info" for routine observations.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function formatAudienceStateForDelivery(state: AudienceAgentState): string | null {
  if (state.captureStatus === 'inactive' || state.captureStatus === 'unsupported' || state.captureStatus === 'denied') {
    return null;
  }

  const parts = ['[AudienceAgent]'];
  parts.push(`capture=${state.captureStatus}`);
  if (state.engagement) parts.push(`engagement=${state.engagement}`);
  if (state.reactions) parts.push(`reactions="${state.reactions}"`);
  if (state.handsRaised != null) parts.push(`hands=${state.handsRaised}`);
  if (state.audiencePrompt) parts.push(`prompt="${state.audiencePrompt}"`);
  if (state.audienceDetails) parts.push(`details="${state.audienceDetails}"`);
  parts.push(`priority=${state.priority}`);
  return parts.join(' | ');
}

export function shouldForwardAudienceStateToDelivery(
  previous: AudienceAgentState | null,
  next: AudienceAgentState,
): boolean {
  if (!previous) {
    return Boolean(
      next.engagement
      || next.reactions
      || next.handsRaised
      || next.audiencePrompt
      || next.captureStatus === 'active'
      || next.captureStatus === 'lost',
    );
  }

  return (
    previous.captureStatus !== next.captureStatus
    || previous.engagement !== next.engagement
    || previous.reactions !== next.reactions
    || previous.handsRaised !== next.handsRaised
    || previous.audiencePrompt !== next.audiencePrompt
    || previous.audienceDetails !== next.audienceDetails
    || previous.priority !== next.priority
  );
}

export function currentSlideForFeedback(delivery: DeliveryAgentState): number | null {
  return delivery.fallbackCurrentSlide;
}
