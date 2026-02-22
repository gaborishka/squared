export interface FillerWords {
  total: number;
  breakdown: Record<string, number>;
}

export interface IndicatorData {
  pace: string;
  eyeContact: string;
  posture: string;
  fillerWords: FillerWords;
  feedbackMessage: string;
  confidenceScore: number;
  volumeLevel: string;
  overallScore: number;
}

export type IndicatorUpdate = Partial<Omit<IndicatorData, 'fillerWords'>> & {
  fillerWords?: Partial<FillerWords>;
};

export const DEFAULT_INDICATORS: IndicatorData = {
  pace: 'Analyzing...',
  eyeContact: 'Analyzing...',
  posture: 'Analyzing...',
  fillerWords: { total: 0, breakdown: {} },
  feedbackMessage: '',
  confidenceScore: 0,
  volumeLevel: 'Good',
  overallScore: 0,
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
    eyeContact: update.eyeContact ?? base.eyeContact,
    posture: update.posture ?? base.posture,
    fillerWords: nextFillerWords,
    feedbackMessage: update.feedbackMessage ?? base.feedbackMessage,
    confidenceScore: update.confidenceScore ?? base.confidenceScore,
    volumeLevel: update.volumeLevel ?? base.volumeLevel,
    overallScore: update.overallScore ?? base.overallScore,
  };
}
