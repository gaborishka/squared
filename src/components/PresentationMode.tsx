import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clock3, Mic, Phone, Presentation, Zap } from 'lucide-react';
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
import { AnalyzingPulse } from './AnalyzingPulse';
import { DesktopPresentationMode } from './DesktopPresentationMode';
import { DEFAULT_INDICATORS, GamePlan, IndicatorData, IndicatorUpdate, ProjectDetails, indicatorToPillState, indicatorToSubtitleState, mergeIndicatorData } from '../types';

interface PresentationModeProps {
  project: ProjectDetails;
  gamePlan: GamePlan;
  onBack: () => void;
  onSessionEnd: () => void;
}

function agentModeColor(mode: string) {
  if (mode === 'rescue') return 'text-red-400 bg-red-500/10';
  if (mode === 'directive') return 'text-amber-400 bg-amber-500/10';
  if (mode === 'soft_cue') return 'text-sky-400 bg-sky-500/10';
  return 'text-zinc-500 bg-zinc-800/50';
}

function formatElapsed(startTime: number | null): string {
  if (!startTime) return '0:00';
  const diff = Math.floor((Date.now() - startTime) / 1000);
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function PresentationMode({ project, gamePlan, onBack, onSessionEnd }: PresentationModeProps) {
  const isElectronApp = Boolean(window.squaredElectron?.isElectron);
  if (isElectronApp) {
    return (
      <DesktopPresentationMode
        project={project}
        gamePlan={gamePlan}
        onBack={onBack}
        onSessionEnd={onSessionEnd}
      />
    );
  }

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
  const [elapsed, setElapsed] = useState('0:00');
  const [mainWindowHidden, setMainWindowHidden] = useState(false);
  const mainWindowHiddenRef = useRef(false);
  const handleToggleConnectRef = useRef<() => void>(() => {});

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

  const { isConnected, isConnecting, isReconnecting, error, connect, disconnect } = useLiveAPI({
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

  // Elapsed timer
  useEffect(() => {
    if (!isConnected || !sessionStartTimeRef.current) return;
    const tick = () => setElapsed(formatElapsed(sessionStartTimeRef.current));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isConnected]);

  useEffect(() => {
    if (window.squaredElectron?.setAppStatus) {
      if (isConnected) {
        window.squaredElectron.setAppStatus({ mode: 'presentation', connected: true });
      } else if (isConnecting) {
        window.squaredElectron.setAppStatus({ mode: 'presentation', connected: false });
      } else {
        window.squaredElectron.setAppStatus({ mode: 'idle', connected: false });
      }
    }
  }, [isConnected, isConnecting]);

  useEffect(() => {
    if (!window.squaredElectron) return;
    if (window.squaredElectron.updatePill) {
      window.squaredElectron.updatePill(indicatorToPillState(indicators, elapsed));
    }
    if (window.squaredElectron.updateSubtitles) {
      window.squaredElectron.updateSubtitles(indicatorToSubtitleState(indicators));
    }
  }, [indicators, elapsed]);

  useEffect(() => {
    return () => {
      window.squaredElectron?.clearOverlay?.();
      window.squaredElectron?.setAppStatus?.({ mode: 'idle', connected: false });
      if (mainWindowHiddenRef.current) {
        window.squaredElectron?.showMainWindow?.();
      }
    };
  }, []);

  useEffect(() => {
    if (!window.squaredElectron?.onStopSession) return;
    const unsubscribe = window.squaredElectron.onStopSession(() => {
      handleToggleConnectRef.current();
    });
    return unsubscribe;
  }, []);

  const handleToggleConnect = async () => {
    if (isConnected || isConnecting) {
      disconnect();
      window.squaredElectron?.clearOverlay?.();
      if (mainWindowHiddenRef.current) {
        window.squaredElectron?.showMainWindow?.();
        setMainWindowHidden(false);
        mainWindowHiddenRef.current = false;
      }
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

  handleToggleConnectRef.current = handleToggleConnect;

  const currentSegment = indicators?.currentSlide != null
    ? gamePlan.segments.find((segment) => segment.slideNumber === indicators.currentSlide)
    : null;

  const fillerCount = indicators?.fillerWords?.total ?? 0;
  const prioritySlides = gamePlan.attentionBudget.prioritySlides;
  const data = indicators ?? DEFAULT_INDICATORS;

  return (
    <div className="h-screen flex flex-col bg-zinc-950 overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/60 shrink-0">
        <button onClick={onBack} className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-200 transition-colors text-sm">
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-300 font-medium">{project.name}</span>
          <span className="text-zinc-700">·</span>
          <span className="text-xs uppercase tracking-wider text-zinc-600">Presentation</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${isReconnecting ? 'bg-amber-400 animate-pulse' : isConnected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : isConnecting ? 'bg-amber-400 animate-pulse' : 'bg-zinc-700'}`} />
          <span className="text-xs text-zinc-500">
            {isReconnecting ? 'Reconnecting...' : isConnecting ? 'Connecting' : isConnected ? 'Live' : 'Ready'}
          </span>
        </div>
      </header>

      <main className="flex-1 flex gap-0 min-h-0">
        {/* Video area */}
        <section className="flex-1 relative m-3 mr-0 rounded-2xl overflow-hidden bg-zinc-900">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          {indicators && <CameraOverlay data={indicators} variant="presentation" />}

          {/* Control bar */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-zinc-950/80 backdrop-blur-xl p-1.5 rounded-2xl z-10 shadow-2xl">
            {isConnected && (
              <div className="flex items-center gap-1.5 px-3 text-xs text-zinc-400 tabular-nums">
                <Clock3 className="w-3 h-3" />
                {elapsed}
              </div>
            )}
            <button
              onClick={handleToggleConnect}
              className={`h-10 px-5 rounded-xl font-medium text-sm flex items-center gap-2 transition-all ${
                isConnected || isConnecting
                  ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
            >
              {isConnected || isConnecting ? (
                <>
                  <Phone className="w-3.5 h-3.5 rotate-[135deg]" />
                  End
                </>
              ) : (
                <>
                  <Presentation className="w-3.5 h-3.5" />
                  Start
                </>
              )}
            </button>
            {isConnected && isElectronApp && !mainWindowHidden && (
              <button
                onClick={() => {
                  window.squaredElectron?.hideMainWindow?.();
                  setMainWindowHidden(true);
                  mainWindowHiddenRef.current = true;
                }}
                className="h-10 px-4 rounded-xl font-medium text-sm flex items-center gap-2 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-all"
              >
                <Presentation className="w-3.5 h-3.5" />
                Hide & Present
              </button>
            )}
          </div>

          {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-4 py-2 rounded-xl text-sm backdrop-blur-md z-10">
              {error}
            </div>
          )}
        </section>

        {/* Right panel */}
        <aside className="w-[280px] shrink-0 flex flex-col m-3 ml-3 rounded-2xl bg-zinc-900/50 border border-zinc-800/40 overflow-hidden">
          {isConnected ? (
            /* ──── Live session panel ──── */
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
              {/* Current slide context */}
              <div className="px-4 py-3 border-b border-zinc-800/40">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600">Current slide</p>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded capitalize ${agentModeColor(data.agentMode)}`}>
                    {data.agentMode}
                  </span>
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-zinc-100 tabular-nums">{data.currentSlide ?? '—'}</span>
                  {currentSegment && (
                    <span className="text-sm text-zinc-400 truncate">{currentSegment.slideTitle}</span>
                  )}
                </div>
                {data.slideTimeRemaining != null && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-700 ${data.slideTimeRemaining < 15 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                        style={{ width: `${Math.max(5, Math.min(100, (data.slideTimeRemaining / 90) * 100))}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-zinc-500 tabular-nums">{Math.max(0, data.slideTimeRemaining)}s</span>
                  </div>
                )}
              </div>

              {/* Live cue */}
              {(data.microPrompt || data.rescueText) && (
                <div className="px-4 py-3 border-b border-zinc-800/40">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Live cue</p>
                  {data.microPrompt && (
                    <p className="text-sm font-semibold text-zinc-200">{data.microPrompt}</p>
                  )}
                  {data.rescueText && (
                    <p className="text-xs text-indigo-300 mt-1 leading-relaxed bg-indigo-500/10 rounded-lg px-2.5 py-2">{data.rescueText}</p>
                  )}
                </div>
              )}

              {/* Quick metrics */}
              <div className="px-4 py-3 border-b border-zinc-800/40 grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[10px] text-zinc-600">Score</p>
                  <p className="text-lg font-bold text-zinc-200 tabular-nums">{data.overallScore > 0 ? data.overallScore : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-600">Fillers</p>
                  <p className={`text-lg font-bold tabular-nums ${fillerCount > 3 ? 'text-amber-400' : 'text-zinc-200'}`}>{fillerCount}</p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-600">Confidence</p>
                  <p className="text-lg font-bold text-zinc-200 tabular-nums">{data.confidenceScore > 0 ? data.confidenceScore : '—'}</p>
                </div>
              </div>

              {/* Current segment details */}
              {currentSegment && currentSegment.knownIssues.length > 0 && (
                <div className="px-4 py-3 border-b border-zinc-800/40">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Watch for</p>
                  {currentSegment.knownIssues.map((issue) => (
                    <p key={issue} className="text-xs text-amber-300/80 leading-relaxed">{issue}</p>
                  ))}
                </div>
              )}

              {/* Latest feedback */}
              {data.feedbackMessage && (
                <div className="px-4 py-3 border-b border-zinc-800/40">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Feedback</p>
                  <p className="text-xs text-zinc-300 leading-relaxed">{data.feedbackMessage}</p>
                </div>
              )}

              {/* Plan summary — bottom */}
              <div className="mt-auto px-4 py-3 border-t border-zinc-800/40 bg-zinc-950/30">
                <div className="flex items-center justify-between text-[10px] text-zinc-600">
                  <span>{gamePlan.attentionBudget.maxInterventions} max cues</span>
                  <span>{gamePlan.timingStrategy.totalTargetMinutes}m target</span>
                </div>
                {prioritySlides.length > 0 && (
                  <p className="text-[10px] text-amber-400/60 mt-1">
                    Priority: slide{prioritySlides.length > 1 ? 's' : ''} {prioritySlides.join(', ')}
                  </p>
                )}
              </div>
            </div>
          ) : isConnecting ? (
            /* ──── Connecting state ──── */
            <div className="flex-1 flex items-center justify-center">
              <AnalyzingPulse />
            </div>
          ) : (
            /* ──── Pre-session state ──── */
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
              <div className="px-4 py-3 border-b border-zinc-800/40">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600">Game plan</p>
                <p className="text-sm font-medium text-zinc-300 mt-1">{project.name}</p>
              </div>

              <div className="px-4 py-3 border-b border-zinc-800/40 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-zinc-600">Rehearsals</p>
                  <p className="text-lg font-bold text-zinc-200 tabular-nums">{gamePlan.runCount}</p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-600">Avg score</p>
                  <p className="text-lg font-bold text-zinc-200 tabular-nums">{gamePlan.overview.avgScore > 0 ? Math.round(gamePlan.overview.avgScore) : '—'}</p>
                </div>
              </div>

              <div className="px-4 py-3 border-b border-zinc-800/40">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-3.5 h-3.5 text-indigo-400" />
                  <p className="text-xs font-medium text-zinc-300">
                    {gamePlan.attentionBudget.maxInterventions} intervention{gamePlan.attentionBudget.maxInterventions !== 1 ? 's' : ''} allowed
                  </p>
                </div>
                <p className="text-xs text-zinc-500">
                  {prioritySlides.length > 0
                    ? `Focus slides: ${prioritySlides.join(', ')}`
                    : 'No priority hotspots'}
                </p>
              </div>

              <div className="px-4 py-3 border-b border-zinc-800/40">
                <div className="flex items-center gap-2 mb-2">
                  <Clock3 className="w-3.5 h-3.5 text-sky-400" />
                  <p className="text-xs font-medium text-zinc-300">
                    Target: {gamePlan.timingStrategy.totalTargetMinutes}m total
                  </p>
                </div>
                <p className="text-xs text-zinc-500">{project.slideCount} slides</p>
              </div>

              <div className="flex-1 flex flex-col justify-end px-4 py-4">
                <div className="flex items-start gap-2.5 rounded-xl bg-zinc-950/40 px-3.5 py-3">
                  <Mic className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-zinc-300 font-medium">Silent coach ready</p>
                    <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                      AI will monitor silently and show cues on the HUD overlay. No audio interruptions.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
