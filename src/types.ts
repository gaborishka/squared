export * from '../shared/types';
import type { IndicatorData, IndicatorUpdate, PillState, SubtitleState } from '../shared/types';

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

export function indicatorToPillState(indicators: IndicatorData | null, elapsed: string): PillState {
  return {
    visible: indicators !== null,
    elapsed,
    currentSlide: indicators?.currentSlide ?? null,
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

export function indicatorToSubtitleState(indicators: IndicatorData | null): SubtitleState {
  const mode = indicators?.agentMode ?? 'monitor';
  const hasCue = Boolean(indicators?.microPrompt || indicators?.rescueText);
  // Only show subtitles when agent actively provides a cue AND is not in monitor mode
  const visible = hasCue && mode !== 'monitor';
  return {
    visible,
    mode,
    microPrompt: indicators?.microPrompt ?? '',
    rescueText: indicators?.rescueText ?? '',
  };
}
