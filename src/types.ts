export * from '../shared/types';
import type {
  DeliveryAgentState,
  DeliveryAgentUpdate,
  DualAgentOverlayState,
  IndicatorData,
  IndicatorUpdate,
  PillState,
  ScreenAgentState,
  ScreenAgentUpdate,
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

export const DEFAULT_SCREEN_AGENT_STATE: ScreenAgentState = {
  captureStatus: 'inactive',
  currentSlide: null,
  slideTimeRemaining: null,
  screenPrompt: '',
  screenDetails: '',
  screenPriority: 'info',
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

export function mergeScreenAgentState(previous: ScreenAgentState | null, update: ScreenAgentUpdate): ScreenAgentState {
  const base = previous ?? DEFAULT_SCREEN_AGENT_STATE;
  return {
    captureStatus: update.captureStatus ?? base.captureStatus,
    currentSlide: update.currentSlide ?? base.currentSlide,
    slideTimeRemaining: update.slideTimeRemaining ?? base.slideTimeRemaining,
    screenPrompt: update.screenPrompt !== undefined ? update.screenPrompt : base.screenPrompt,
    screenDetails: update.screenDetails !== undefined ? update.screenDetails : base.screenDetails,
    screenPriority: update.screenPriority ?? base.screenPriority,
    sourceLabel: update.sourceLabel !== undefined ? update.sourceLabel : base.sourceLabel,
  };
}

export function composeLegacyIndicators(
  delivery: DeliveryAgentState | null,
  screen: ScreenAgentState | null,
): IndicatorData {
  const deliveryState = delivery ?? DEFAULT_DELIVERY_AGENT_STATE;
  const screenState = screen ?? DEFAULT_SCREEN_AGENT_STATE;
  const activeScreen = screenState.captureStatus === 'active' || screenState.captureStatus === 'lost';

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
    currentSlide: activeScreen ? screenState.currentSlide : deliveryState.fallbackCurrentSlide,
    microPrompt: deliveryState.microPrompt,
    rescueText: deliveryState.rescueText,
    agentMode: deliveryState.agentMode,
    slideTimeRemaining: activeScreen ? screenState.slideTimeRemaining : deliveryState.fallbackSlideTimeRemaining,
  };
}

export function composeDualAgentOverlayState(
  delivery: DeliveryAgentState | null,
  screen: ScreenAgentState | null,
): DualAgentOverlayState {
  const deliveryState = delivery ?? DEFAULT_DELIVERY_AGENT_STATE;
  const screenState = screen ?? DEFAULT_SCREEN_AGENT_STATE;
  const effectiveCurrentSlide =
    screenState.captureStatus === 'active' || screenState.captureStatus === 'lost'
      ? screenState.currentSlide
      : deliveryState.fallbackCurrentSlide;
  const effectiveSlideTimeRemaining =
    screenState.captureStatus === 'active' || screenState.captureStatus === 'lost'
      ? screenState.slideTimeRemaining
      : deliveryState.fallbackSlideTimeRemaining;
  const deliveryVisible = Boolean(deliveryState.microPrompt || deliveryState.rescueText || deliveryState.feedbackMessage);
  const screenVisible = Boolean(
    screenState.screenPrompt
      || screenState.screenDetails
      || screenState.captureStatus === 'lost'
      || screenState.captureStatus === 'requesting',
  );

  return {
    visible: deliveryVisible || screenVisible,
    currentSlide: effectiveCurrentSlide,
    slideTimeRemaining: effectiveSlideTimeRemaining,
    delivery: {
      visible: deliveryVisible,
      mode: deliveryState.agentMode,
      prompt: deliveryState.microPrompt,
      detail: deliveryState.rescueText || deliveryState.feedbackMessage,
    },
    screen: {
      visible: screenVisible,
      priority: screenState.screenPriority,
      captureStatus: screenState.captureStatus,
      prompt: screenState.screenPrompt,
      detail: screenState.screenDetails,
      currentSlide: screenState.currentSlide,
    },
  };
}

export function indicatorToPillState(indicators: IndicatorData | null, elapsed: string): PillState {
  return {
    visible: indicators !== null,
    elapsed,
    currentSlide: indicators?.currentSlide ?? null,
    screenCaptureStatus: 'inactive',
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
  screen: ScreenAgentState | null,
  elapsed: string,
  visible = true,
): PillState {
  const legacyIndicators = composeLegacyIndicators(delivery, screen);
  return {
    visible,
    elapsed,
    currentSlide: legacyIndicators.currentSlide,
    screenCaptureStatus: (screen ?? DEFAULT_SCREEN_AGENT_STATE).captureStatus,
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
    screen: {
      visible: false,
      priority: 'info',
      captureStatus: 'inactive',
      prompt: '',
      detail: '',
      currentSlide: indicators?.currentSlide ?? null,
    },
  };
}

export function dualAgentToSubtitleState(
  delivery: DeliveryAgentState | null,
  screen: ScreenAgentState | null,
): SubtitleState {
  const overlay = composeDualAgentOverlayState(delivery, screen);
  return {
    visible: overlay.visible,
    delivery: overlay.delivery,
    screen: overlay.screen,
  };
}
