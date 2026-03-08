import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, AlertCircle, Mic, Sparkles } from 'lucide-react';
import { api } from '../api/client';
import { useLiveAPI } from '../hooks/useLiveAPI';
import {
  buildRehearsalContext,
  createSessionMetricsTracker,
  feedbackCategoryFromMessage,
  feedbackSeverityFromAgentMode,
  formatTimestampFromStart,
  ingestIndicatorSample,
  mergeSlideAnalysis,
  summarizeSessionMetrics,
} from '../lib/session';
import { CameraOverlay } from './CameraOverlay';
import { SessionInsights } from './SessionInsights';
import { AnalyzingPulse } from './AnalyzingPulse';
import { DEFAULT_INDICATORS, IndicatorData, IndicatorUpdate, ProjectAnalysis, ProjectDetails, mergeIndicatorData } from '../types';
import type { FeedbackItem } from './FeedbackTimeline';

interface RehearsalModeProps {
  project: ProjectDetails;
  onBack: () => void;
  onSessionEnd: () => void;
}

export function RehearsalMode({ project, onBack, onSessionEnd }: RehearsalModeProps) {
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
  const [feedbackHistory, setFeedbackHistory] = useState<FeedbackItem[]>([]);
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);

  useEffect(() => {
    let isActive = true;
    setAnalysisLoading(true);
    api.getProjectAnalysis(project.id)
      .then((result) => {
        if (isActive) setAnalysis(result);
      })
      .catch((error) => {
        console.warn('Failed to load project analysis for rehearsal context', error);
        if (isActive) setAnalysis(null);
      })
      .finally(() => {
        if (isActive) setAnalysisLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [project.id]);

  const contextText = useMemo(() => buildRehearsalContext(project, analysis), [project, analysis]);

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
        const timestamp = formatTimestampFromStart(sessionStartTimeRef.current);
        const feedbackEntry: FeedbackItem = {
          id: crypto.randomUUID(),
          timestamp,
          message: feedbackMessage,
        };

        feedbackPayloadRef.current.unshift({
          ...feedbackEntry,
          slideNumber: next.currentSlide,
          severity: feedbackSeverityFromAgentMode(next.agentMode),
          category: feedbackCategoryFromMessage(feedbackMessage),
        });
        setFeedbackHistory((current) => [feedbackEntry, ...current]);
      }

      return next;
    });
  }, []);

  const {
    isConnected,
    isConnecting,
    error,
    connect,
    disconnect,
    analyserRef,
    playbackAnalyserRef,
    isSpeaking,
  } = useLiveAPI({
    mode: 'rehearsal',
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

  const resetSessionState = useCallback(() => {
    const now = Date.now();
    metricsTrackerRef.current = createSessionMetricsTracker();
    feedbackPayloadRef.current = [];
    slideAnalysisMapRef.current = new Map();
    lastFeedbackMessageRef.current = '';
    setIndicators(null);
    setFeedbackHistory([]);
    setSessionStartTime(now);
    sessionStartTimeRef.current = now;
  }, []);

  useEffect(() => {
    if (isConnected) {
      resetSessionState();
    } else if (!isConnecting) {
      setSessionStartTime(null);
      sessionStartTimeRef.current = null;
    }
  }, [isConnected, isConnecting, resetSessionState]);

  const handleToggleConnect = async () => {
    if (isConnected || isConnecting) {
      disconnect();
      if (sessionStartTimeRef.current) {
        const duration = Date.now() - sessionStartTimeRef.current;
        try {
          await api.saveRun({
            run: {
              id: crypto.randomUUID(),
              projectId: project.id,
              mode: 'rehearsal',
              duration,
              ...summarizeSessionMetrics(metricsTrackerRef.current),
            },
            feedbacks: feedbackPayloadRef.current,
            slideAnalyses: Array.from(slideAnalysisMapRef.current.values()),
          });
        } catch (saveError) {
          console.error('Failed to save rehearsal session:', saveError);
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

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/70 backdrop-blur-md">
        <button onClick={onBack} className="flex items-center text-zinc-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5 mr-2" /> Back
        </button>
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Rehearsal</p>
          <h1 className="text-lg font-semibold text-zinc-100">{project.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
          <span className="text-sm font-medium text-zinc-300">
            {isConnecting ? 'Connecting...' : isConnected ? (isSpeaking ? 'Coach speaking' : 'Live coach active') : 'Ready'}
          </span>
        </div>
      </header>

      <main className="flex-1 flex p-6 gap-6 min-h-0">
        <section className="flex-1 relative rounded-[32px] overflow-hidden border border-zinc-800 bg-zinc-900 flex flex-col">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          {indicators && <CameraOverlay data={indicators} variant="rehearsal" />}

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center space-x-4 bg-zinc-950/80 backdrop-blur-md px-6 py-3 rounded-full border border-zinc-800 z-10">
            <button
              onClick={handleToggleConnect}
              className={`flex items-center px-4 py-2 rounded-full font-medium transition-colors ${
                isConnected || isConnecting
                  ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                  : 'bg-indigo-500 text-white hover:bg-indigo-400'
              }`}
            >
              {isConnected || isConnecting ? 'End Rehearsal' : 'Start Rehearsal'}
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
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Project context</p>
            <h2 className="text-2xl font-semibold text-zinc-50 mt-2">{project.slideCount} slides in play</h2>
            <p className="text-sm text-zinc-400 mt-3">
              {project.description || 'No project description yet. The rehearsal prompt still includes the extracted slide structure.'}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-[22px] border border-zinc-800 bg-zinc-950/60 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Risk segments</div>
                <div className="text-2xl font-semibold text-zinc-100 mt-2">
                  {analysisLoading ? '--' : analysis?.riskSegments.length ?? 0}
                </div>
              </div>
              <div className="rounded-[22px] border border-zinc-800 bg-zinc-950/60 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Rehearsals</div>
                <div className="text-2xl font-semibold text-zinc-100 mt-2">
                  {analysisLoading ? '--' : analysis?.rehearsalRuns ?? 0}
                </div>
              </div>
            </div>
            <div className="mt-5 space-y-3 max-h-44 overflow-y-auto pr-1">
              {analysisLoading ? (
                <div className="rounded-[24px] border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400">
                  Loading prior weak spots…
                </div>
              ) : analysis?.riskSegments.length ? (
                analysis.riskSegments.slice(0, 4).map((segment) => (
                  <div key={segment.id} className="rounded-[24px] border border-zinc-800 bg-zinc-950/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-zinc-100">
                        Slide {segment.slideNumber ?? '?'}
                      </span>
                      <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">{segment.riskType}</span>
                    </div>
                    <p className="text-sm text-zinc-400 mt-2 line-clamp-2">{segment.notes}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-[24px] border border-dashed border-zinc-700 bg-zinc-950/60 p-4 text-sm text-zinc-400">
                  No rehearsal history yet. This session will create the first slide-level memory.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[32px] border border-zinc-800 bg-zinc-900/70 p-6 flex-1 min-h-0">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <Mic className="w-5 h-5 mr-2 text-indigo-400" />
              Session insights
            </h3>
            {isConnected ? (
              <SessionInsights
                data={indicators ?? DEFAULT_INDICATORS}
                feedbackHistory={feedbackHistory}
                analyserRef={analyserRef}
              />
            ) : isConnecting ? (
              <div className="flex h-full items-center justify-center">
                <AnalyzingPulse />
              </div>
            ) : (
              <div className="h-full flex flex-col justify-between">
                <div>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    The rehearsal prompt already includes deck structure, prior risk segments, and instructions to write slide-level analysis as you practice.
                  </p>
                  <div className="mt-5 rounded-[24px] border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">
                    <div className="flex items-center gap-2 text-zinc-100 font-medium">
                      <Sparkles className="w-4 h-4 text-emerald-400" />
                      Context loaded
                    </div>
                    <p className="mt-2 text-zinc-400">
                      {project.slides.length > 0
                        ? `Slides, speaker notes, and prior weak spots are ready for Gemini.`
                        : `Project description is loaded; upload a deck later to get slide-aware coaching.`}
                    </p>
                  </div>
                </div>
                <div className="rounded-[24px] border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400">
                  {sessionStartTime ? `Last session started at ${new Date(sessionStartTime).toLocaleTimeString()}` : 'Start rehearsal when ready.'}
                </div>
              </div>
            )}
          </div>
        </aside>
      </main>

      {!analysisLoading && !analysis && (
        <div className="fixed bottom-6 right-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 flex items-center gap-3">
          <AlertCircle className="w-4 h-4" />
          Rehearsal memory is empty for this project. This session will bootstrap it.
        </div>
      )}
    </div>
  );
}
