export * from '../shared/types';
import type {
  AudienceAgentState,
  AudienceAgentUpdate,
  DeliveryAgentState,
  DeliveryAgentUpdate,
  DualAgentOverlayState,
  IndicatorData,
  IndicatorUpdate,
  PillState,
  SubtitleState,
} from '../shared/types';

export const DEFAULT_INDICATORS: IndicatorData = {
  pace: 'Analyzing...',
  paceWpm: null,
  eyeContact: 'Analyzing...',
  posture: 'Analyzing...',
  fillerWords: { total: 0, breakdown: {} },
  feedbackMessage: '',
  confidenceScore: 0,
  volumeLevel: 'Good',
  overallScore: 0,
  currentSlide: null,
  microPrompt: '',
  rescueText: '',
  agentMode: 'monitor',
  slideTimeRemaining: null,
};

export const DEFAULT_DELIVERY_AGENT_STATE: DeliveryAgentState = {
  pace: 'Analyzing...',
  paceWpm: null,
  eyeContact: 'Analyzing...',
  posture: 'Analyzing...',
  fillerWords: { total: 0, breakdown: {} },
  feedbackMessage: '',
  confidenceScore: 0,
  volumeLevel: 'Good',
  overallScore: 0,
  microPrompt: '',
  rescueText: '',
  agentMode: 'monitor',
  fallbackCurrentSlide: null,
  fallbackSlideTimeRemaining: null,
};

export const DEFAULT_AUDIENCE_AGENT_STATE: AudienceAgentState = {
  captureStatus: 'inactive',
  engagement: null,
  reactions: '',
  handsRaised: null,
  audiencePrompt: '',
  audienceDetails: '',
  priority: 'info',
  sourceLabel: '',
};

export function mergeIndicatorData(previous: IndicatorData | null, update: IndicatorUpdate): IndicatorData {
  const base = previous ?? DEFAULT_INDICATORS;
  const nextFillerWords = update.fillerWords
    ? {
      total: update.fillerWords.total ?? base.fillerWords.total,
      breakdown: update.fillerWords.breakdown ?? base.fillerWords.breakdown,
    }
    : base.fillerWords;

  return {
    pace: update.pace ?? base.pace,
    paceWpm: update.paceWpm ?? base.paceWpm,
    eyeContact: update.eyeContact ?? base.eyeContact,
    posture: update.posture ?? base.posture,
    fillerWords: nextFillerWords,
    feedbackMessage: update.feedbackMessage !== undefined ? update.feedbackMessage : base.feedbackMessage,
    confidenceScore: update.confidenceScore ?? base.confidenceScore,
    volumeLevel: update.volumeLevel ?? base.volumeLevel,
    overallScore: update.overallScore ?? base.overallScore,
    currentSlide: update.currentSlide ?? base.currentSlide,
    microPrompt: update.microPrompt !== undefined ? update.microPrompt : base.microPrompt,
    rescueText: update.rescueText !== undefined ? update.rescueText : base.rescueText,
    agentMode: update.agentMode ?? base.agentMode,
    slideTimeRemaining: update.slideTimeRemaining ?? base.slideTimeRemaining,
  };
}

export function mergeDeliveryAgentState(
  previous: DeliveryAgentState | null,
  update: DeliveryAgentUpdate,
): DeliveryAgentState {
  const base = previous ?? DEFAULT_DELIVERY_AGENT_STATE;
  const nextFillerWords = update.fillerWords
    ? {
      total: update.fillerWords.total ?? base.fillerWords.total,
      breakdown: update.fillerWords.breakdown ?? base.fillerWords.breakdown,
    }
    : base.fillerWords;

  return {
    pace: update.pace ?? base.pace,
    paceWpm: update.paceWpm ?? base.paceWpm,
    eyeContact: update.eyeContact ?? base.eyeContact,
    posture: update.posture ?? base.posture,
    fillerWords: nextFillerWords,
    feedbackMessage: update.feedbackMessage !== undefined ? update.feedbackMessage : base.feedbackMessage,
    confidenceScore: update.confidenceScore ?? base.confidenceScore,
    volumeLevel: update.volumeLevel ?? base.volumeLevel,
    overallScore: update.overallScore ?? base.overallScore,
    microPrompt: update.microPrompt !== undefined ? update.microPrompt : base.microPrompt,
    rescueText: update.rescueText !== undefined ? update.rescueText : base.rescueText,
    agentMode: update.agentMode ?? base.agentMode,
    fallbackCurrentSlide: update.fallbackCurrentSlide ?? base.fallbackCurrentSlide,
    fallbackSlideTimeRemaining: update.fallbackSlideTimeRemaining ?? base.fallbackSlideTimeRemaining,
  };
}

export function mergeAudienceAgentState(previous: AudienceAgentState | null, update: AudienceAgentUpdate): AudienceAgentState {
  const base = previous ?? DEFAULT_AUDIENCE_AGENT_STATE;
  return {
    captureStatus: update.captureStatus ?? base.captureStatus,
    engagement: update.engagement !== undefined ? update.engagement : base.engagement,
    reactions: update.reactions !== undefined ? update.reactions : base.reactions,
    handsRaised: update.handsRaised !== undefined ? update.handsRaised : base.handsRaised,
    audiencePrompt: update.audiencePrompt !== undefined ? update.audiencePrompt : base.audiencePrompt,
    audienceDetails: update.audienceDetails !== undefined ? update.audienceDetails : base.audienceDetails,
    priority: update.priority ?? base.priority,
    sourceLabel: update.sourceLabel !== undefined ? update.sourceLabel : base.sourceLabel,
  };
}

export function composeLegacyIndicators(
  delivery: DeliveryAgentState | null,
  _audience: AudienceAgentState | null,
): IndicatorData {
  const deliveryState = delivery ?? DEFAULT_DELIVERY_AGENT_STATE;

  return {
    pace: deliveryState.pace,
    paceWpm: deliveryState.paceWpm,
    eyeContact: deliveryState.eyeContact,
    posture: deliveryState.posture,
    fillerWords: deliveryState.fillerWords,
    feedbackMessage: deliveryState.feedbackMessage,
    confidenceScore: deliveryState.confidenceScore,
    volumeLevel: deliveryState.volumeLevel,
    overallScore: deliveryState.overallScore,
    currentSlide: deliveryState.fallbackCurrentSlide,
    microPrompt: deliveryState.microPrompt,
    rescueText: deliveryState.rescueText,
    agentMode: deliveryState.agentMode,
    slideTimeRemaining: deliveryState.fallbackSlideTimeRemaining,
  };
}

export function composeDualAgentOverlayState(
  delivery: DeliveryAgentState | null,
  audience: AudienceAgentState | null,
): DualAgentOverlayState {
  const deliveryState = delivery ?? DEFAULT_DELIVERY_AGENT_STATE;
  const audienceState = audience ?? DEFAULT_AUDIENCE_AGENT_STATE;
  const deliveryVisible = Boolean(deliveryState.microPrompt || deliveryState.rescueText || deliveryState.feedbackMessage);
  const audienceVisible = Boolean(
    audienceState.audiencePrompt
      || audienceState.audienceDetails
      || audienceState.captureStatus === 'lost'
      || audienceState.captureStatus === 'requesting',
  );

  return {
    visible: deliveryVisible || audienceVisible,
    delivery: {
      visible: deliveryVisible,
      mode: deliveryState.agentMode,
      prompt: deliveryState.microPrompt,
      detail: deliveryState.rescueText || deliveryState.feedbackMessage,
    },
    audience: {
      visible: audienceVisible,
      priority: audienceState.priority,
      captureStatus: audienceState.captureStatus,
      prompt: audienceState.audiencePrompt,
      detail: audienceState.audienceDetails,
      engagement: audienceState.engagement,
      reactions: audienceState.reactions,
      handsRaised: audienceState.handsRaised,
    },
  };
}

export function indicatorToPillState(indicators: IndicatorData | null, elapsed: string): PillState {
  return {
    visible: indicators !== null,
    elapsed,
    currentSlide: indicators?.currentSlide ?? null,
    audienceCaptureStatus: 'inactive',
    pace: indicators?.pace ?? 'Analyzing...',
    eyeContact: indicators?.eyeContact ?? 'Analyzing...',
    posture: indicators?.posture ?? 'Analyzing...',
    fillerCount: indicators?.fillerWords?.total ?? 0,
    confidenceScore: indicators?.confidenceScore ?? 0,
    overallScore: indicators?.overallScore ?? 0,
    agentMode: indicators?.agentMode ?? 'monitor',
    slideTimeRemaining: indicators?.slideTimeRemaining ?? null,
  };
}

export function dualAgentToPillState(
  delivery: DeliveryAgentState | null,
  audience: AudienceAgentState | null,
  elapsed: string,
  visible = true,
): PillState {
  const legacyIndicators = composeLegacyIndicators(delivery, audience);
  return {
    visible,
    elapsed,
    currentSlide: legacyIndicators.currentSlide,
    audienceCaptureStatus: (audience ?? DEFAULT_AUDIENCE_AGENT_STATE).captureStatus,
    pace: legacyIndicators.pace,
    eyeContact: legacyIndicators.eyeContact,
    posture: legacyIndicators.posture,
    fillerCount: legacyIndicators.fillerWords.total,
    confidenceScore: legacyIndicators.confidenceScore,
    overallScore: legacyIndicators.overallScore,
    agentMode: legacyIndicators.agentMode,
    slideTimeRemaining: legacyIndicators.slideTimeRemaining,
  };
}

export function indicatorToSubtitleState(indicators: IndicatorData | null): SubtitleState {
  const mode = indicators?.agentMode ?? 'monitor';
  const hasCue = Boolean(indicators?.microPrompt || indicators?.rescueText);
  // Only show subtitles when agent actively provides a cue AND is not in monitor mode
  const visible = hasCue && mode !== 'monitor';
  return {
    visible,
    delivery: {
      visible,
      mode,
      prompt: indicators?.microPrompt ?? '',
      detail: indicators?.rescueText ?? '',
    },
    audience: {
      visible: false,
      priority: 'info',
      captureStatus: 'inactive',
      prompt: '',
      detail: '',
      engagement: null,
      reactions: '',
      handsRaised: null,
    },
  };
}

export function dualAgentToSubtitleState(
  delivery: DeliveryAgentState | null,
  audience: AudienceAgentState | null,
): SubtitleState {
  const overlay = composeDualAgentOverlayState(delivery, audience);
  // Only show audience subtitles for critical priority — routine observations are noise
  const audienceState = audience ?? DEFAULT_AUDIENCE_AGENT_STATE;
  const showAudienceSubtitle = audienceState.priority === 'critical'
    || audienceState.captureStatus === 'lost';
  const audienceSub = showAudienceSubtitle
    ? overlay.audience
    : { ...overlay.audience, visible: false, prompt: '', detail: '' };
  return {
    visible: overlay.delivery.visible || audienceSub.visible,
    delivery: overlay.delivery,
    audience: audienceSub,
  };
}
