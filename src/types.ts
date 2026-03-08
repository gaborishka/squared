export * from '../shared/types';
import type { IndicatorData, IndicatorUpdate, OverlayState } from '../shared/types';

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
    feedbackMessage: update.feedbackMessage ?? base.feedbackMessage,
    confidenceScore: update.confidenceScore ?? base.confidenceScore,
    volumeLevel: update.volumeLevel ?? base.volumeLevel,
    overallScore: update.overallScore ?? base.overallScore,
    currentSlide: update.currentSlide ?? base.currentSlide,
    microPrompt: update.microPrompt ?? base.microPrompt,
    rescueText: update.rescueText ?? base.rescueText,
    agentMode: update.agentMode ?? base.agentMode,
    slideTimeRemaining: update.slideTimeRemaining ?? base.slideTimeRemaining,
  };
}

export function indicatorToOverlayState(indicators: IndicatorData | null): OverlayState {
  return {
    visible: Boolean(indicators?.microPrompt || indicators?.rescueText),
    mode: indicators?.agentMode ?? 'monitor',
    microPrompt: indicators?.microPrompt ?? '',
    rescueText: indicators?.rescueText ?? '',
    slideTimeRemaining: indicators?.slideTimeRemaining ?? null,
    currentSlide: indicators?.currentSlide ?? null,
  };
}
