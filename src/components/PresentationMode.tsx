import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clock3, Presentation, Sparkles } from 'lucide-react';
import { api } from '../api/client';
import { useLiveAPI } from '../hooks/useLiveAPI';
import {
  buildPresentationContext,
  createSessionMetricsTracker,
  feedbackCategoryFromMessage,
  feedbackSeverityFromAgentMode,
  formatTimestampFromStart,
  ingestIndicatorSample,
  mergeSlideAnalysis,
  summarizeSessionMetrics,
} from '../lib/session';
import { CameraOverlay } from './CameraOverlay';
import { Indicators } from './Indicators';
import { AnalyzingPulse } from './AnalyzingPulse';
import { DEFAULT_INDICATORS, GamePlan, IndicatorData, IndicatorUpdate, ProjectDetails, indicatorToOverlayState, mergeIndicatorData } from '../types';

interface PresentationModeProps {
  project: ProjectDetails;
  gamePlan: GamePlan;
  onBack: () => void;
  onSessionEnd: () => void;
}

export function PresentationMode({ project, gamePlan, onBack, onSessionEnd }: PresentationModeProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const liveSessionActiveRef = useRef(false);
  const metricsTrackerRef = useRef(createSessionMetricsTracker());
  const feedbackPayloadRef = useRef<Array<{
    id: string;
    timestamp: string;
    message: string;
    slideNumber: number | null;
    severity: 'info' | 'warning' | 'critical';
    category: ReturnType<typeof feedbackCategoryFromMessage>;
  }>>([]);
  const slideAnalysisMapRef = useRef(
    new Map<number, { slideNumber: number; issues: string[]; bestPhrase: string; riskLevel: 'safe' | 'watch' | 'fragile' }>(),
  );
  const lastFeedbackMessageRef = useRef('');
  const sessionStartTimeRef = useRef<number | null>(null);

  const [indicators, setIndicators] = useState<IndicatorData | null>(null);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);

  const contextText = useMemo(() => buildPresentationContext(project, gamePlan), [project, gamePlan]);

  const stopPreview = useCallback(() => {
    const previewStream = previewStreamRef.current;
    if (previewStream) {
      previewStream.getTracks().forEach((track) => track.stop());
      previewStreamRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject === previewStream) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startPreview = useCallback(async () => {
    if (previewStreamRef.current || liveSessionActiveRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (liveSessionActiveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      previewStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.warn('Could not get preview stream', error);
    }
  }, []);

  const handleIndicatorsUpdate = useCallback((update: IndicatorUpdate) => {
    setIndicators((previous) => {
      const next = mergeIndicatorData(previous, update);
      ingestIndicatorSample(metricsTrackerRef.current, next);

      const feedbackMessage = update.feedbackMessage?.trim();
      if (feedbackMessage && feedbackMessage !== lastFeedbackMessageRef.current) {
        lastFeedbackMessageRef.current = feedbackMessage;
        feedbackPayloadRef.current.unshift({
          id: crypto.randomUUID(),
          timestamp: formatTimestampFromStart(sessionStartTimeRef.current),
          message: feedbackMessage,
          slideNumber: next.currentSlide,
          severity: feedbackSeverityFromAgentMode(next.agentMode),
          category: feedbackCategoryFromMessage(feedbackMessage),
        });
      }

      return next;
    });
  }, []);

  const { isConnected, isConnecting, error, connect, disconnect } = useLiveAPI({
    mode: 'presentation',
    contextText,
    onIndicatorsUpdate: handleIndicatorsUpdate,
    onSlideAnalysis: (payload) => {
      slideAnalysisMapRef.current = mergeSlideAnalysis(slideAnalysisMapRef.current, payload);
    },
  });

  useEffect(() => {
    liveSessionActiveRef.current = isConnected || isConnecting;
  }, [isConnected, isConnecting]);

  useEffect(() => {
    return () => stopPreview();
  }, [stopPreview]);

  useEffect(() => {
    if (isConnected || isConnecting) {
      stopPreview();
      return;
    }
    void startPreview();
  }, [isConnected, isConnecting, startPreview, stopPreview]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  useEffect(() => {
    if (isConnected) {
      const now = Date.now();
      metricsTrackerRef.current = createSessionMetricsTracker();
      feedbackPayloadRef.current = [];
      slideAnalysisMapRef.current = new Map();
      lastFeedbackMessageRef.current = '';
      setSessionStartTime(now);
      sessionStartTimeRef.current = now;
    } else if (!isConnecting) {
      setSessionStartTime(null);
      sessionStartTimeRef.current = null;
    }
  }, [isConnected, isConnecting]);

  useEffect(() => {
    const overlayState = indicatorToOverlayState(indicators);
    if (window.squaredElectron?.updateOverlay) {
      window.squaredElectron.updateOverlay(overlayState);
    }
  }, [indicators]);

  useEffect(() => {
    return () => {
      window.squaredElectron?.clearOverlay?.();
    };
  }, []);

  const handleToggleConnect = async () => {
    if (isConnected || isConnecting) {
      disconnect();
      window.squaredElectron?.clearOverlay?.();
      if (sessionStartTimeRef.current) {
        const duration = Date.now() - sessionStartTimeRef.current;
        try {
          await api.saveRun({
            run: {
              id: crypto.randomUUID(),
              projectId: project.id,
              mode: 'presentation',
              duration,
              ...summarizeSessionMetrics(metricsTrackerRef.current),
            },
            feedbacks: feedbackPayloadRef.current,
            slideAnalyses: Array.from(slideAnalysisMapRef.current.values()),
          });
        } catch (saveError) {
          console.error('Failed to save presentation session:', saveError);
        }
        onSessionEnd();
      }
      return;
    }

    if (videoRef.current) {
      stopPreview();
      connect(videoRef.current);
    }
  };

  const currentSegment = indicators?.currentSlide != null
    ? gamePlan.segments.find((segment) => segment.slideNumber === indicators.currentSlide)
    : null;

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/70 backdrop-blur-md">
        <button onClick={onBack} className="flex items-center text-zinc-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5 mr-2" /> Back
        </button>
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Presentation</p>
          <h1 className="text-lg font-semibold text-zinc-100">{project.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
          <span className="text-sm font-medium text-zinc-300">
            {isConnecting ? 'Connecting...' : isConnected ? 'Silent coach active' : 'Ready'}
          </span>
        </div>
      </header>

      <main className="flex-1 flex p-6 gap-6 min-h-0">
        <section className="flex-1 relative rounded-[32px] overflow-hidden border border-zinc-800 bg-zinc-900 flex flex-col">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          {indicators && <CameraOverlay data={indicators} variant="presentation" />}

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center space-x-4 bg-zinc-950/80 backdrop-blur-md px-6 py-3 rounded-full border border-zinc-800 z-10">
            <button
              onClick={handleToggleConnect}
              className={`flex items-center px-4 py-2 rounded-full font-medium transition-colors ${
                isConnected || isConnecting
                  ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                  : 'bg-emerald-500 text-white hover:bg-emerald-400'
              }`}
            >
              {isConnected || isConnecting ? 'End Presentation' : 'Start Presentation'}
            </button>
          </div>

          {error && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-4 py-2 rounded-lg text-sm backdrop-blur-md z-10">
              {error}
            </div>
          )}
        </section>

        <aside className="w-[380px] shrink-0 flex flex-col gap-6">
          <div className="rounded-[32px] border border-zinc-800 bg-zinc-900/70 p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Live plan</p>
                <h2 className="text-2xl font-semibold text-zinc-50 mt-2">Execution guardrails</h2>
              </div>
              <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs text-zinc-300">
                {gamePlan.attentionBudget.maxInterventions} max cues
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-5">
              <div className="rounded-[22px] border border-zinc-800 bg-zinc-950/60 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Trend</div>
                <div className="text-2xl font-semibold text-zinc-100 mt-2 capitalize">{gamePlan.overview.trend}</div>
              </div>
              <div className="rounded-[22px] border border-zinc-800 bg-zinc-950/60 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Avg score</div>
                <div className="text-2xl font-semibold text-zinc-100 mt-2">{Math.round(gamePlan.overview.avgScore)}</div>
              </div>
            </div>

            <div className="mt-5 rounded-[24px] border border-zinc-800 bg-zinc-950/60 p-4">
              <div className="flex items-center gap-2 text-zinc-100 font-medium">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                Priority slides
              </div>
              <p className="mt-2 text-sm text-zinc-400">
                {gamePlan.attentionBudget.prioritySlides.length > 0
                  ? gamePlan.attentionBudget.prioritySlides.join(', ')
                  : 'No high-risk slides identified.'}
              </p>
            </div>

            {currentSegment && (
              <div className="mt-5 rounded-[24px] border border-emerald-500/20 bg-emerald-500/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-emerald-100/70">Current slide</p>
                    <h3 className="text-lg font-semibold text-emerald-50 mt-1">
                      {currentSegment.slideNumber}. {currentSegment.slideTitle}
                    </h3>
                  </div>
                  <span className="rounded-full bg-black/15 px-3 py-1 text-xs uppercase tracking-[0.18em] text-emerald-50/80">
                    {currentSegment.interventionPolicy}
                  </span>
                </div>
                <p className="text-sm text-emerald-50/90 mt-3">
                  {currentSegment.knownIssues[0] || 'No recurring issue logged for this slide.'}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-[32px] border border-zinc-800 bg-zinc-900/70 p-6 flex-1 min-h-0">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <Presentation className="w-5 h-5 mr-2 text-emerald-400" />
              Live HUD state
            </h3>
            {isConnected ? (
              <Indicators data={indicators ?? DEFAULT_INDICATORS} />
            ) : isConnecting ? (
              <div className="flex h-full items-center justify-center">
                <AnalyzingPulse />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-[24px] border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400">
                  The presentation prompt is preloaded with project structure, risk map, prepared cues, recovery phrases, and per-slide time targets.
                </div>
                <div className="rounded-[24px] border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">
                  <div className="flex items-center gap-2 font-medium text-zinc-100">
                    <Clock3 className="w-4 h-4 text-sky-400" />
                    Target runtime
                  </div>
                  <p className="mt-2 text-zinc-400">
                    Aim for {gamePlan.timingStrategy.totalTargetMinutes} minutes total.
                    {sessionStartTime ? ` Last presentation started at ${new Date(sessionStartTime).toLocaleTimeString()}.` : ''}
                  </p>
                </div>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
