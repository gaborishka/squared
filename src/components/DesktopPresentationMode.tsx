import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Clock3, Mic, Phone, Presentation, Users, Zap } from 'lucide-react';
import { api } from '../api/client';
import { useDesktopDualLiveSession } from '../hooks/useDesktopDualLiveSession';
import {
  createSessionMetricsTracker,
  currentSlideForFeedback,
  feedbackCategoryFromMessage,
  feedbackSeverityFromAgentMode,
  formatTimestampFromStart,
  ingestIndicatorSample,
  mergeSlideAnalysis,
  summarizeSessionMetrics,
} from '../lib/session';
import { DualAgentOverlay } from './DualAgentOverlay';
import { AnalyzingPulse } from './AnalyzingPulse';
import {
  dualAgentToPillState,
  dualAgentToSubtitleState,
  GamePlan,
  ProjectDetails,
} from '../types';

interface DesktopPresentationModeProps {
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

function audienceStatusLabel(status: 'inactive' | 'requesting' | 'active' | 'lost' | 'denied' | 'unsupported') {
  if (status === 'active') return 'Audience live';
  if (status === 'requesting') return 'Connecting';
  if (status === 'lost') return 'Audience lost';
  if (status === 'denied') return 'Audience skipped';
  if (status === 'unsupported') return 'Unavailable';
  return 'Off';
}

export function DesktopPresentationMode({ project, gamePlan, onBack, onSessionEnd }: DesktopPresentationModeProps) {
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
  const lastMetricsSignatureRef = useRef('');
  const sessionStartTimeRef = useRef<number | null>(null);
  const handleToggleConnectRef = useRef<() => void>(() => {});
  const disconnectRef = useRef<() => void>(() => {});
  const mainWindowHiddenRef = useRef(false);

  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState('0:00');
  const [mainWindowHidden, setMainWindowHidden] = useState(false);

  const {
    isConnected,
    isConnecting,
    error,
    connect,
    disconnect,
    connectAudience,
    disconnectAudience,
    isAudienceConnected,
    deliveryState,
    audienceState,
    legacyIndicators,
  } = useDesktopDualLiveSession({
    mode: 'presentation',
    project,
    gamePlan,
    onSlideAnalysis: (payload) => {
      slideAnalysisMapRef.current = mergeSlideAnalysis(slideAnalysisMapRef.current, payload);
    },
  });

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
    } catch (previewError) {
      console.warn('Could not get preview stream', previewError);
    }
  }, []);

  useEffect(() => {
    liveSessionActiveRef.current = isConnected || isConnecting;
  }, [isConnected, isConnecting]);

  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  useEffect(() => () => stopPreview(), [stopPreview]);

  useEffect(() => {
    if (isConnected || isConnecting) {
      stopPreview();
      return;
    }
    void startPreview();
  }, [isConnected, isConnecting, startPreview, stopPreview]);

  useEffect(() => () => disconnectRef.current(), []);

  useEffect(() => {
    if (isConnected) {
      const now = Date.now();
      metricsTrackerRef.current = createSessionMetricsTracker();
      feedbackPayloadRef.current = [];
      slideAnalysisMapRef.current = new Map();
      lastFeedbackMessageRef.current = '';
      lastMetricsSignatureRef.current = '';
      setSessionStartTime(now);
      sessionStartTimeRef.current = now;
    } else if (!isConnecting) {
      setSessionStartTime(null);
      sessionStartTimeRef.current = null;
    }
  }, [isConnected, isConnecting]);

  useEffect(() => {
    const metricsSignature = [
      legacyIndicators.paceWpm ?? '',
      legacyIndicators.confidenceScore,
      legacyIndicators.overallScore,
      legacyIndicators.fillerWords.total,
      legacyIndicators.eyeContact,
      legacyIndicators.posture,
    ].join('|');
    if (metricsSignature !== lastMetricsSignatureRef.current) {
      lastMetricsSignatureRef.current = metricsSignature;
      ingestIndicatorSample(metricsTrackerRef.current, legacyIndicators);
    }

    const feedbackMessage = deliveryState.feedbackMessage.trim();
    if (feedbackMessage && feedbackMessage !== lastFeedbackMessageRef.current) {
      lastFeedbackMessageRef.current = feedbackMessage;
      feedbackPayloadRef.current.unshift({
        id: crypto.randomUUID(),
        timestamp: formatTimestampFromStart(sessionStartTimeRef.current),
        message: feedbackMessage,
        slideNumber: currentSlideForFeedback(deliveryState),
        severity: feedbackSeverityFromAgentMode(deliveryState.agentMode),
        category: feedbackCategoryFromMessage(feedbackMessage),
      });
    }
  }, [deliveryState, legacyIndicators]);

  useEffect(() => {
    if (!isConnected || !sessionStartTimeRef.current) return;
    const tick = () => setElapsed(formatElapsed(sessionStartTimeRef.current));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isConnected]);

  useEffect(() => {
    if (window.squaredElectron?.setAppStatus) {
      if (isConnected) window.squaredElectron.setAppStatus({ mode: 'presentation', connected: true });
      else if (isConnecting) window.squaredElectron.setAppStatus({ mode: 'presentation', connected: false });
      else window.squaredElectron.setAppStatus({ mode: 'idle', connected: false });
    }
  }, [isConnected, isConnecting]);

  useEffect(() => {
    if (!window.squaredElectron) return;
    window.squaredElectron.updatePill(
      dualAgentToPillState(deliveryState, audienceState, elapsed, isConnected || isConnecting),
    );
    window.squaredElectron.updateSubtitles(dualAgentToSubtitleState(deliveryState, audienceState));
  }, [deliveryState, elapsed, isConnected, isConnecting, audienceState]);

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
        mainWindowHiddenRef.current = false;
        setMainWindowHidden(false);
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
      await connect(videoRef.current);
    }
  };

  handleToggleConnectRef.current = handleToggleConnect;

  const handleToggleAudience = () => {
    if (isAudienceConnected) {
      disconnectAudience();
    } else {
      void connectAudience();
    }
  };

  const currentSegment = legacyIndicators.currentSlide != null
    ? gamePlan.segments.find((segment) => segment.slideNumber === legacyIndicators.currentSlide)
    : null;
  const fillerCount = legacyIndicators.fillerWords.total ?? 0;
  const prioritySlides = gamePlan.attentionBudget.prioritySlides;

  return (
    <div className="h-screen flex flex-col bg-zinc-950 overflow-hidden">
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
          <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : isConnecting ? 'bg-amber-400 animate-pulse' : 'bg-zinc-700'}`} />
          <span className="text-xs text-zinc-500">
            {isConnecting ? 'Connecting' : isConnected ? 'Live' : 'Ready'}
          </span>
        </div>
      </header>

      <main className="flex-1 flex gap-0 min-h-0">
        <section className="flex-1 relative m-3 mr-0 rounded-2xl overflow-hidden bg-zinc-900">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          {isConnected && <DualAgentOverlay delivery={deliveryState} audience={audienceState} variant="presentation" />}

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-zinc-950/80 backdrop-blur-xl p-1.5 rounded-2xl z-10 shadow-2xl">
            {isConnected && (
              <div className="flex items-center gap-1.5 px-3 text-xs text-zinc-400 tabular-nums">
                <Clock3 className="w-3 h-3" />
                {elapsed}
              </div>
            )}
            {isConnected && (
              <button
                onClick={handleToggleAudience}
                title="Toggle audience monitoring"
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                  isAudienceConnected
                    ? 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30'
                    : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Users className="w-[18px] h-[18px]" />
              </button>
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
            {isConnected && !mainWindowHidden && (
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

        <aside className="w-[300px] shrink-0 flex flex-col m-3 ml-3 rounded-2xl bg-zinc-900/50 border border-zinc-800/40 overflow-hidden">
          {isConnected ? (
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
              <div className="px-4 py-3 border-b border-zinc-800/40">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600">Current slide</p>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded capitalize ${agentModeColor(deliveryState.agentMode)}`}>
                    {deliveryState.agentMode}
                  </span>
                </div>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-zinc-100 tabular-nums">{legacyIndicators.currentSlide ?? '—'}</span>
                  {currentSegment && (
                    <span className="text-sm text-zinc-400 truncate">{currentSegment.slideTitle}</span>
                  )}
                </div>
                {legacyIndicators.slideTimeRemaining != null && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-700 ${legacyIndicators.slideTimeRemaining < 15 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                        style={{ width: `${Math.max(5, Math.min(100, (legacyIndicators.slideTimeRemaining / 90) * 100))}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-zinc-500 tabular-nums">{Math.max(0, legacyIndicators.slideTimeRemaining)}s</span>
                  </div>
                )}
              </div>

              <div className="px-4 py-3 border-b border-zinc-800/40">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Delivery lane</p>
                <p className="text-sm font-semibold text-zinc-200">{deliveryState.microPrompt || 'Monitoring delivery'}</p>
                {(deliveryState.rescueText || deliveryState.feedbackMessage) && (
                  <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">{deliveryState.rescueText || deliveryState.feedbackMessage}</p>
                )}
              </div>

              <div className="px-4 py-3 border-b border-zinc-800/40">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600">Audience lane</p>
                  <span className="text-[10px] text-zinc-500">{audienceStatusLabel(audienceState.captureStatus)}</span>
                </div>
                {audienceState.captureStatus === 'active' ? (
                  <>
                    <div className="mt-1.5 flex items-center gap-2">
                      {audienceState.engagement && (
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                          audienceState.engagement === 'high' ? 'text-emerald-400 bg-emerald-500/10' :
                          audienceState.engagement === 'low' ? 'text-red-400 bg-red-500/10' :
                          'text-amber-400 bg-amber-500/10'
                        }`}>
                          {audienceState.engagement === 'high' ? 'Engaged' : audienceState.engagement === 'low' ? 'Low engagement' : 'Moderate'}
                        </span>
                      )}
                      {audienceState.handsRaised != null && audienceState.handsRaised > 0 && (
                        <span className="text-xs font-medium text-orange-400 bg-orange-500/10 px-1.5 py-0.5 rounded">
                          {audienceState.handsRaised} hand{audienceState.handsRaised > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {audienceState.reactions && (
                      <p className="text-xs text-zinc-400 mt-1">{audienceState.reactions}</p>
                    )}
                    <p className="text-sm font-semibold text-zinc-200 mt-1.5">
                      {audienceState.audiencePrompt || 'Watching audience'}
                    </p>
                    {audienceState.audienceDetails && (
                      <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{audienceState.audienceDetails}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-zinc-500 mt-1.5">
                    {audienceState.captureStatus === 'inactive' ? 'Enable with audience button' : audienceState.audiencePrompt || 'Not connected'}
                  </p>
                )}
              </div>

              <div className="px-4 py-3 border-b border-zinc-800/40 grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[10px] text-zinc-600">Score</p>
                  <p className="text-lg font-bold text-zinc-200 tabular-nums">{legacyIndicators.overallScore > 0 ? legacyIndicators.overallScore : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-600">Fillers</p>
                  <p className={`text-lg font-bold tabular-nums ${fillerCount > 3 ? 'text-amber-400' : 'text-zinc-200'}`}>{fillerCount}</p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-600">Confidence</p>
                  <p className="text-lg font-bold text-zinc-200 tabular-nums">{legacyIndicators.confidenceScore > 0 ? legacyIndicators.confidenceScore : '—'}</p>
                </div>
              </div>

              {currentSegment && currentSegment.knownIssues.length > 0 && (
                <div className="px-4 py-3 border-b border-zinc-800/40">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1.5">Watch for</p>
                  {currentSegment.knownIssues.map((issue) => (
                    <p key={issue} className="text-xs text-amber-300/80 leading-relaxed">{issue}</p>
                  ))}
                </div>
              )}

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
            <div className="flex-1 flex items-center justify-center">
              <AnalyzingPulse />
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
              <div className="px-4 py-3 border-b border-zinc-800/40">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600">Presentation session</p>
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
                  <p className="text-xs font-medium text-zinc-300">Delivery + audience</p>
                </div>
                <p className="text-xs text-zinc-500 leading-relaxed">
                  Start begins delivery coaching. Use the audience button during the session to monitor your Zoom/Meet gallery.
                </p>
              </div>

              <div className="flex-1 flex flex-col justify-end px-4 py-4">
                <div className="flex items-start gap-2.5 rounded-xl bg-zinc-950/40 px-3.5 py-3">
                  <Mic className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-zinc-300 font-medium">Silent coach ready</p>
                    <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                      DeliveryAgent coaches your delivery. AudienceAgent can optionally watch your call participants.
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
