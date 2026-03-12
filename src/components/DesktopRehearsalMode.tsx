import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, History, Mic, Phone, Presentation, Sparkles, Video } from 'lucide-react';
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
  resolveLiveMemoryCue,
  summarizeSessionMetrics,
} from '../lib/session';
import { buildTranscriptSegmentDraft, pickSupportedRecordingMimeType } from '../lib/runCapture';
import { DualAgentOverlay } from './DualAgentOverlay';
import { SessionInsights } from './SessionInsights';
import { AnalyzingPulse } from './AnalyzingPulse';
import {
  LiveMemoryCue,
  ProjectAnalysis,
  ProjectDetails,
  RunArtifact,
  RunTranscriptSegment,
  dualAgentToPillState,
  dualAgentToSubtitleState,
} from '../types';
import type { FeedbackItem } from './FeedbackTimeline';

interface DesktopRehearsalModeProps {
  project: ProjectDetails;
  analysis: ProjectAnalysis | null;
  analysisLoading: boolean;
  onBack: () => void;
  onSessionEnd: () => void;
}

export function DesktopRehearsalMode({
  project,
  analysis,
  analysisLoading,
  onBack,
  onSessionEnd,
}: DesktopRehearsalModeProps) {
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
  const transcriptSegmentsRef = useRef<Array<Omit<RunTranscriptSegment, 'runId'>>>([]);
  const transcriptSequenceRef = useRef(0);
  const currentSlideRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingMimeTypeRef = useRef('video/webm');
  const activeRecordingStreamRef = useRef<MediaStream | null>(null);

  const [feedbackHistory, setFeedbackHistory] = useState<FeedbackItem[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState('0:00');
  const [mainWindowHidden, setMainWindowHidden] = useState(false);
  const [memoryBySlide, setMemoryBySlide] = useState<Record<number, LiveMemoryCue[]> | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(true);
  const riskCount = analysisLoading ? '-' : (analysis?.riskSegments.length ?? 0);
  const runCount = analysisLoading ? '-' : (analysis?.rehearsalRuns ?? 0);
  const hasRisks = !analysisLoading && (analysis?.riskSegments.length ?? 0) > 0;

  const releaseRecordingCapture = useCallback(() => {
    mediaRecorderRef.current = null;
    activeRecordingStreamRef.current = null;
  }, []);

  const stopRecordingCapture = useCallback((options?: { preserveRecorder?: boolean }) => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    if (!options?.preserveRecorder) {
      releaseRecordingCapture();
    } else {
      activeRecordingStreamRef.current = null;
    }
  }, [releaseRecordingCapture]);

  const startRecordingCapture = useCallback((stream: MediaStream | null) => {
    if (!stream || activeRecordingStreamRef.current === stream || typeof MediaRecorder === 'undefined') return;
    stopRecordingCapture();
    recordingChunksRef.current = [];
    activeRecordingStreamRef.current = stream;
    const mimeType = pickSupportedRecordingMimeType(stream);
    recordingMimeTypeRef.current = mimeType;

    try {
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
    } catch (error) {
      console.warn('Failed to start desktop run recording capture', error);
      releaseRecordingCapture();
    }
  }, [releaseRecordingCapture, stopRecordingCapture]);

  const {
    isConnected,
    isConnecting,
    error,
    connect,
    disconnect,
    analyserRef,
    isSpeaking,
    deliveryState,
    audienceState,
    legacyIndicators,
  } = useDesktopDualLiveSession({
    mode: 'rehearsal',
    project,
    analysis,
    gamePlan: analysis?.latestGamePlan ?? null,
    memoryBySlide,
    onSlideAnalysis: (payload) => {
      slideAnalysisMapRef.current = mergeSlideAnalysis(slideAnalysisMapRef.current, payload);
    },
    onTranscriptSegment: ({ text, capturedAt }) => {
      const segment = buildTranscriptSegmentDraft({
        text,
        capturedAt,
        sessionStartTime: sessionStartTimeRef.current,
        slideNumber: currentSlideRef.current,
        sequence: transcriptSequenceRef.current,
      });
      transcriptSequenceRef.current += 1;
      transcriptSegmentsRef.current.push(segment);
    },
    onMediaStream: (stream) => {
      if (stream) startRecordingCapture(stream);
      else stopRecordingCapture({ preserveRecorder: true });
    },
  });
  const activeMemoryCue = resolveLiveMemoryCue(memoryBySlide, legacyIndicators.currentSlide);

  useEffect(() => {
    let isActive = true;
    setMemoryLoading(true);
    api.getProjectMemory(project.id)
      .then((memory) => {
        if (isActive) setMemoryBySlide(memory);
      })
      .catch((error) => {
        console.warn('Failed to load rehearsal memory', error);
        if (isActive) setMemoryBySlide(null);
      })
      .finally(() => {
        if (isActive) setMemoryLoading(false);
      });
    return () => {
      isActive = false;
    };
  }, [project.id]);

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

  useEffect(() => () => {
    stopPreview();
    stopRecordingCapture();
  }, [stopPreview, stopRecordingCapture]);

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
      transcriptSegmentsRef.current = [];
      transcriptSequenceRef.current = 0;
      currentSlideRef.current = null;
      lastFeedbackMessageRef.current = '';
      lastMetricsSignatureRef.current = '';
      setFeedbackHistory([]);
      setSessionStartTime(now);
      sessionStartTimeRef.current = now;
    } else if (!isConnecting) {
      setSessionStartTime(null);
      sessionStartTimeRef.current = null;
    }
  }, [isConnected, isConnecting]);

  useEffect(() => {
    currentSlideRef.current = legacyIndicators.currentSlide;
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
      const timestamp = formatTimestampFromStart(sessionStartTimeRef.current);
      const feedbackEntry: FeedbackItem = {
        id: crypto.randomUUID(),
        timestamp,
        message: feedbackMessage,
      };

      feedbackPayloadRef.current.unshift({
        ...feedbackEntry,
        slideNumber: currentSlideForFeedback(deliveryState),
        severity: feedbackSeverityFromAgentMode(deliveryState.agentMode),
        category: feedbackCategoryFromMessage(feedbackMessage),
      });
      setFeedbackHistory((current) => [feedbackEntry, ...current]);
    }
  }, [deliveryState, legacyIndicators]);

  useEffect(() => {
    if (!isConnected || !sessionStartTimeRef.current) return;
    const tick = () => setElapsed(formatTimestampFromStart(sessionStartTimeRef.current));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isConnected]);

  useEffect(() => {
    if (window.squaredElectron?.setAppStatus) {
      if (isConnected) window.squaredElectron.setAppStatus({ mode: 'rehearsal', connected: true });
      else if (isConnecting) window.squaredElectron.setAppStatus({ mode: 'rehearsal', connected: false });
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

  const uploadRecordingArtifact = useCallback(async (runId: string): Promise<Omit<RunArtifact, 'createdAt' | 'runId'> | null> => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return null;

    const artifact = await new Promise<Omit<RunArtifact, 'createdAt' | 'runId'> | null>((resolve) => {
      const finalize = async () => {
        const blob = new Blob(recordingChunksRef.current, { type: recordingMimeTypeRef.current || 'video/webm' });
        recordingChunksRef.current = [];
        if (blob.size === 0) {
          resolve(null);
          return;
        }

        try {
          const uploaded = await api.uploadRunArtifact(runId, blob, {
            kind: 'full_recording',
            startMs: 0,
            endMs: sessionStartTimeRef.current ? Date.now() - sessionStartTimeRef.current : null,
            fileName: blob.type.startsWith('audio/') ? `${runId}.audio.webm` : `${runId}.video.webm`,
          });
          resolve({
            id: uploaded.id,
            kind: uploaded.kind,
            mimeType: uploaded.mimeType,
            filePath: uploaded.filePath,
            startMs: uploaded.startMs,
            endMs: uploaded.endMs,
          });
        } catch (error) {
          console.error('Failed to upload desktop rehearsal recording artifact:', error);
          resolve(null);
        }
      };

      recorder.addEventListener('stop', () => {
        void finalize();
      }, { once: true });

      if (recorder.state === 'inactive') {
        void finalize();
      } else {
        recorder.stop();
      }
    });

    releaseRecordingCapture();
    return artifact;
  }, [releaseRecordingCapture]);

  const handleToggleConnect = async () => {
    if (isConnected || isConnecting) {
      window.squaredElectron?.clearOverlay?.();
      if (mainWindowHiddenRef.current) {
        window.squaredElectron?.showMainWindow?.();
        mainWindowHiddenRef.current = false;
        setMainWindowHidden(false);
      }
      if (sessionStartTimeRef.current) {
        const duration = Date.now() - sessionStartTimeRef.current;
        const runId = crypto.randomUUID();
        try {
          await api.saveRun({
            run: {
              id: runId,
              projectId: project.id,
              mode: 'rehearsal',
              duration,
              ...summarizeSessionMetrics(metricsTrackerRef.current),
            },
            feedbacks: feedbackPayloadRef.current,
            slideAnalyses: Array.from(slideAnalysisMapRef.current.values()),
            artifacts: [],
            transcriptSegments: transcriptSegmentsRef.current,
          });
          await uploadRecordingArtifact(runId);
          void api.getProjectMemory(project.id)
            .then((memory) => setMemoryBySlide(memory))
            .catch((error) => console.warn('Failed to refresh rehearsal memory', error));
        } catch (saveError) {
          console.error('Failed to save rehearsal session:', saveError);
        }
        onSessionEnd();
      }
      disconnect();
      return;
    }

    if (videoRef.current) {
      stopPreview();
      await connect(videoRef.current);
    }
  };

  handleToggleConnectRef.current = handleToggleConnect;

  return (
    <div className="h-screen flex flex-col bg-zinc-950 overflow-hidden">
      <header className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-zinc-800/60">
        <button onClick={onBack} className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-200 transition-colors text-sm">
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-300 font-medium">{project.name}</span>
          <span className="text-zinc-700">·</span>
          <span className="text-xs uppercase tracking-wider text-zinc-600">Rehearsal</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : isConnecting ? 'bg-amber-400 animate-pulse' : 'bg-zinc-700'}`} />
          <span className="text-xs text-zinc-500">
            {isConnecting ? 'Connecting' : isConnected ? (isSpeaking ? 'Coach speaking' : 'Live') : 'Ready'}
          </span>
        </div>
      </header>

      <main className="flex-1 flex gap-0 min-h-0">
        <section className="flex-1 relative m-3 mr-0 rounded-2xl overflow-hidden bg-zinc-900">
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          {isConnected && <DualAgentOverlay delivery={deliveryState} audience={audienceState} variant="rehearsal" />}

          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-zinc-950/80 backdrop-blur-xl p-1.5 rounded-2xl z-10 shadow-2xl">
            <button className="w-10 h-10 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors">
              <Video className="w-[18px] h-[18px]" />
            </button>
            <button className="w-10 h-10 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors">
              <Mic className="w-[18px] h-[18px]" />
            </button>
            <button
              onClick={handleToggleConnect}
              className={`h-10 px-5 rounded-xl font-medium text-sm flex items-center gap-2 transition-all ${
                isConnected || isConnecting
                  ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                  : 'bg-indigo-500 text-white hover:bg-indigo-400'
              }`}
            >
              {isConnected || isConnecting ? (
                <>
                  <Phone className="w-3.5 h-3.5 rotate-[135deg]" />
                  End
                </>
              ) : (
                'Start'
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
                Hide & Coach
              </button>
            )}
          </div>

          {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-4 py-2 rounded-xl text-sm backdrop-blur-md z-10">
              {error}
            </div>
          )}
        </section>

        <aside className="w-[340px] shrink-0 flex flex-col m-3 ml-3 rounded-2xl bg-zinc-900/50 border border-zinc-800/40 overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between text-xs text-zinc-500 border-b border-zinc-800/40">
            <span className="uppercase tracking-wider font-medium">Project</span>
            <div className="flex items-center gap-2 text-zinc-400">
              <span><span className="text-zinc-200 font-semibold">{project.slideCount}</span> slides</span>
              <span className="text-zinc-700">·</span>
              <span><span className="text-zinc-200 font-semibold">{riskCount}</span> risks</span>
              <span className="text-zinc-700">·</span>
              <span><span className="text-zinc-200 font-semibold">{runCount}</span> runs</span>
            </div>
          </div>

          {hasRisks && (
            <div className="px-4 py-3 border-b border-zinc-800/40">
              <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">Prior weak spots</p>
              <div className="space-y-1.5">
                {analysis!.riskSegments.slice(0, 3).map((segment) => (
                  <div key={segment.id} className="flex items-baseline gap-2 text-xs">
                    <span className="shrink-0 text-zinc-600 font-mono">S{segment.slideNumber ?? '?'}</span>
                    <span className="text-zinc-400 line-clamp-1 flex-1">{segment.notes}</span>
                    <span className="shrink-0 text-[10px] text-zinc-600">{segment.riskType}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="px-4 py-3 border-b border-zinc-800/40">
            <div className="flex items-center gap-2 mb-2">
              <History className="w-3.5 h-3.5 text-emerald-400" />
              <p className="text-[10px] uppercase tracking-wider text-zinc-600">Memory</p>
            </div>
            {activeMemoryCue ? (
              <div className="rounded-xl bg-zinc-950/50 border border-zinc-800/60 px-3 py-2.5">
                <p className="text-[11px] text-emerald-300 font-medium">
                  {activeMemoryCue.slideNumber != null ? `Slide ${activeMemoryCue.slideNumber}` : 'General memory'}
                </p>
                <p className="mt-1 text-xs text-zinc-200 leading-relaxed">{activeMemoryCue.cueText}</p>
                <p className="mt-2 text-[11px] text-zinc-500 line-clamp-2">{activeMemoryCue.supportingText}</p>
              </div>
            ) : memoryLoading ? (
              <p className="text-xs text-zinc-500">Loading rehearsal memory…</p>
            ) : (
              <p className="text-xs text-zinc-500">
                {legacyIndicators.currentSlide != null
                  ? 'No historical cue for this slide yet.'
                  : 'Memory cues will appear when you reach a slide with prior history.'}
              </p>
            )}
          </div>

          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="px-4 py-3 flex items-center gap-2 border-b border-zinc-800/40">
              <Mic className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-xs font-medium text-zinc-300">Session insights</span>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
              {isConnected ? (
                <SessionInsights
                  data={legacyIndicators}
                  feedbackHistory={feedbackHistory}
                  analyserRef={analyserRef}
                />
              ) : isConnecting ? (
                <div className="flex h-full items-center justify-center">
                  <AnalyzingPulse />
                </div>
              ) : (
                <div className="flex flex-col h-full justify-between">
                  <div className="flex items-start gap-2.5 rounded-xl bg-zinc-950/40 px-3.5 py-3">
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-zinc-300 font-medium">Coach ready</p>
                      <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                        Start will activate DeliveryAgent for real-time voice coaching during your rehearsal.
                      </p>
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-600 text-center py-4">
                    {sessionStartTime
                      ? `Last session: ${new Date(sessionStartTime).toLocaleTimeString()}`
                      : 'Press Start when ready'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </aside>
      </main>

      {!analysisLoading && !analysis && (
        <div className="fixed bottom-4 right-4 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3.5 py-2.5 text-xs text-amber-200/80 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5" />
          First session — rehearsal memory will be created.
        </div>
      )}
    </div>
  );
}
