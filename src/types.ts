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
