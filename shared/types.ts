export type SessionMode = 'rehearsal' | 'presentation';
export type ProjectFileType = 'pptx' | 'pdf' | 'text' | 'md';
export type RiskLevel = 'safe' | 'watch' | 'fragile';
export type InterventionPolicy = 'silent' | 'soft_cue' | 'directive' | 'teleprompter';
export type AgentMode = 'monitor' | 'soft_cue' | 'directive' | 'rescue';
export type AudienceCaptureStatus = 'inactive' | 'requesting' | 'active' | 'lost' | 'denied' | 'unsupported';
export type AudiencePriority = 'info' | 'watch' | 'critical';
export type FeedbackSeverity = 'info' | 'warning' | 'critical';
export type FeedbackCategory = 'pace' | 'eye_contact' | 'posture' | 'content' | 'structure' | 'filler';
export type RiskType =
  | 'pace_spike'
  | 'freeze'
  | 'filler_cluster'
  | 'eye_contact_loss'
  | 'confidence_drop'
  | 'structure_drift';

export interface FillerWords {
  total: number;
  breakdown: Record<string, number>;
}

export interface IndicatorData {
  pace: string;
  paceWpm: number | null;
  eyeContact: string;
  posture: string;
  fillerWords: FillerWords;
  feedbackMessage: string;
  confidenceScore: number;
  volumeLevel: string;
  overallScore: number;
  currentSlide: number | null;
  microPrompt: string;
  rescueText: string;
  agentMode: AgentMode;
  slideTimeRemaining: number | null;
}

export type IndicatorUpdate = Partial<Omit<IndicatorData, 'fillerWords'>> & {
  fillerWords?: Partial<FillerWords>;
};

export interface DeliveryAgentState {
  pace: string;
  paceWpm: number | null;
  eyeContact: string;
  posture: string;
  fillerWords: FillerWords;
  feedbackMessage: string;
  confidenceScore: number;
  volumeLevel: string;
  overallScore: number;
  microPrompt: string;
  rescueText: string;
  agentMode: AgentMode;
  fallbackCurrentSlide: number | null;
  fallbackSlideTimeRemaining: number | null;
}

export type DeliveryAgentUpdate = Partial<Omit<DeliveryAgentState, 'fillerWords'>> & {
  fillerWords?: Partial<FillerWords>;
};

export interface AudienceAgentState {
  captureStatus: AudienceCaptureStatus;
  engagement: 'high' | 'moderate' | 'low' | null;
  reactions: string;
  handsRaised: number | null;
  audiencePrompt: string;
  audienceDetails: string;
  priority: AudiencePriority;
  sourceLabel: string;
}

export type AudienceAgentUpdate = Partial<AudienceAgentState>;

export interface ProjectSlide {
  id: string;
  projectId: string;
  slideNumber: number;
  title: string;
  content: string;
  speakerNotes: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  content: string;
  filePath: string | null;
  fileType: ProjectFileType | null;
  slideCount: number;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  rehearsalRunCount: number;
  presentationRunCount: number;
  lastOverallScore: number | null;
}

export interface ProjectDetails extends ProjectSummary {
  slides: ProjectSlide[];
}

export interface ProjectInput {
  name: string;
  description?: string;
  slides?: Array<Pick<ProjectSlide, 'id' | 'speakerNotes'>>;
}

export interface RunFeedback {
  id: string;
  runId: string;
  timestamp: string;
  message: string;
  slideNumber: number | null;
  severity: FeedbackSeverity;
  category: FeedbackCategory | null;
}

export interface RunSlideAnalysis {
  id: string;
  runId: string;
  slideNumber: number;
  issues: string[];
  bestPhrase: string;
  riskLevel: RiskLevel;
}

export interface RunSummary {
  id: string;
  projectId: string | null;
  mode: SessionMode;
  duration: number;
  avgPaceWpm: number | null;
  avgConfidence: number | null;
  fillerWordCount: number;
  eyeContactPct: number | null;
  postureGoodPct: number | null;
  overallScore: number | null;
  createdAt: string;
}

export interface RunReportComparison {
  overallScoreDelta: number | null;
  avgPaceWpmDelta: number | null;
  avgConfidenceDelta: number | null;
  fillerWordCountDelta: number | null;
  eyeContactPctDelta: number | null;
  postureGoodPctDelta: number | null;
}

export interface RunReportHighlight {
  timestamp: string;
  slideNumber: number | null;
  type: 'win' | 'risk' | 'recovery';
  severity: FeedbackSeverity;
  message: string;
}

export interface RunReportSlideCard {
  slideNumber: number;
  slideTitle: string;
  riskLevel: RiskLevel;
  issues: string[];
  bestPhrase: string;
  repeatedFromHistory: boolean;
}

export interface RunReport {
  verdict: 'strong' | 'mixed' | 'needs_work';
  summary: string;
  wins: string[];
  risks: string[];
  nextSteps: string[];
  highlights: RunReportHighlight[];
  slideCards: RunReportSlideCard[];
  comparison: RunReportComparison | null;
}

export interface RunDetails extends RunSummary {
  feedbacks: RunFeedback[];
  slideAnalyses: RunSlideAnalysis[];
  runReport: RunReport | null;
}

export interface SaveRunPayload {
  run: Omit<RunSummary, 'createdAt'>;
  feedbacks: Array<Omit<RunFeedback, 'runId'>>;
  slideAnalyses: Array<Omit<RunSlideAnalysis, 'id' | 'runId'>>;
}

export interface RiskSegment {
  id: string;
  projectId: string;
  slideNumber: number | null;
  riskType: RiskType;
  frequency: number;
  avgSeverity: number;
  lastOccurrence: string;
  bestRecovery: string;
  notes: string;
}

export interface GamePlanSegment {
  slideNumber: number;
  slideTitle: string;
  riskLevel: RiskLevel;
  knownIssues: string[];
  preparedCues: string[];
  recoveryPhrases: string[];
  interventionPolicy: InterventionPolicy;
}

export interface GamePlan {
  id: string;
  projectId: string;
  runCount: number;
  createdAt: string;
  overview: {
    totalRuns: number;
    avgScore: number;
    trend: 'improving' | 'stable' | 'declining';
  };
  segments: GamePlanSegment[];
  attentionBudget: {
    maxInterventions: number;
    prioritySlides: number[];
  };
  timingStrategy: {
    totalTargetMinutes: number;
    perSlideTargets: Record<number, number>;
  };
}

export interface ProjectAnalysisSlideSummary {
  slideNumber: number;
  title: string;
  riskLevel: RiskLevel;
  issueCount: number;
  sampleIssues: string[];
}

export interface ProjectAnalysis {
  projectId: string;
  totalRuns: number;
  rehearsalRuns: number;
  presentationRuns: number;
  avgScore: number;
  latestScore: number | null;
  trend: 'improving' | 'stable' | 'declining';
  riskSegments: RiskSegment[];
  slideSummary: ProjectAnalysisSlideSummary[];
  latestGamePlan: GamePlan | null;
}

export interface SlideAnalysisToolPayload {
  slideNumber: number;
  issues: string[];
  bestPhrase: string;
  riskLevel: RiskLevel;
}

export interface OverlayState {
  visible: boolean;
  mode: AgentMode;
  microPrompt: string;
  rescueText: string;
  slideTimeRemaining: number | null;
  currentSlide: number | null;
}

export interface DeliveryCueLaneState {
  visible: boolean;
  mode: AgentMode;
  prompt: string;
  detail: string;
}

export interface AudienceCueLaneState {
  visible: boolean;
  priority: AudiencePriority;
  captureStatus: AudienceCaptureStatus;
  prompt: string;
  detail: string;
  engagement: 'high' | 'moderate' | 'low' | null;
  reactions: string;
  handsRaised: number | null;
}

export interface DualAgentOverlayState {
  visible: boolean;
  delivery: DeliveryCueLaneState;
  audience: AudienceCueLaneState;
}

export interface PillState {
  visible: boolean;
  elapsed: string;
  currentSlide: number | null;
  audienceCaptureStatus: AudienceCaptureStatus;
  pace: string;
  eyeContact: string;
  posture: string;
  fillerCount: number;
  confidenceScore: number;
  overallScore: number;
  agentMode: AgentMode;
  slideTimeRemaining: number | null;
}

export interface SubtitleState {
  visible: boolean;
  delivery: DeliveryCueLaneState;
  audience: AudienceCueLaneState;
}

export interface DesktopAppStatus {
  mode: 'idle' | 'rehearsal' | 'presentation';
  connected: boolean;
}

export interface ParsedUpload {
  fileType: ProjectFileType;
  content: string;
  slideCount: number;
  slides: Array<Pick<ProjectSlide, 'slideNumber' | 'title' | 'content' | 'speakerNotes'>>;
  filePath: string;
}
