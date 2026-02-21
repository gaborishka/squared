import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Activity } from 'lucide-react';
import { useLiveAPI } from '../hooks/useLiveAPI';
import { SessionInsights } from './SessionInsights';
import { CameraOverlay } from './CameraOverlay';
import { AnalyzingPulse } from './AnalyzingPulse';
import { FeedbackItem } from './FeedbackTimeline';
import { IndicatorData } from '../types';

const AGENT_BIN_INDICES = [1, 2, 4, 6];
const AGENT_IDLE_SCALE = 0.22;
const AGENT_MAX_SCALE = 1;
const AGENT_TARGET_FPS = 40;
const AGENT_FRAME_INTERVAL_MS = 1000 / AGENT_TARGET_FPS;
const AGENT_ATTACK = 0.48;
const AGENT_RELEASE = 0.22;
const AGENT_NOISE_FLOOR_ADAPT = 0.03;
const AGENT_GATE_OFFSET = 0.018;
const AGENT_SILENCE_MARGIN = 0.006;
const AGENT_SILENCE_HOLD_FRAMES = 4;
const SECTION_GLOW_TARGET_FPS = 30;
const SECTION_GLOW_FRAME_INTERVAL_MS = 1000 / SECTION_GLOW_TARGET_FPS;
const AGENT_GLOW_BINS = [1, 2, 4, 6];

type AudioLevelTracker = {
  data: Uint8Array | null;
  level: number;
  noiseFloor: number;
  silenceFrames: number;
};

const createLevelTracker = (initialFloor = 0.012): AudioLevelTracker => ({
  data: null,
  level: 0,
  noiseFloor: initialFloor,
  silenceFrames: 0,
});

function sampleAudioLevel(
  analyser: AnalyserNode | null,
  bins: number[],
  tracker: AudioLevelTracker,
  options: {
    attack: number;
    release: number;
    floorAdapt: number;
    gateOffset: number;
    silenceMargin: number;
    silenceHoldFrames: number;
  },
) {
  if (!analyser) {
    tracker.level *= 0.75;
    tracker.silenceFrames = options.silenceHoldFrames + 1;
    return tracker.level;
  }

  const length = analyser.frequencyBinCount;
  if (!tracker.data || tracker.data.length !== length) {
    tracker.data = new Uint8Array(length);
  }

  analyser.getByteFrequencyData(tracker.data);
  let frameEnergy = 0;
  for (let i = 0; i < bins.length; i++) {
    const bin = Math.min(bins[i], tracker.data.length - 1);
    frameEnergy += (tracker.data[bin] ?? 0) / 255;
  }
  frameEnergy /= bins.length;

  const floorTarget = Math.min(frameEnergy, 0.09);
  tracker.noiseFloor = (tracker.noiseFloor * (1 - options.floorAdapt)) + (floorTarget * options.floorAdapt);
  const gate = Math.min(0.28, tracker.noiseFloor + options.gateOffset);

  if (frameEnergy < gate + options.silenceMargin) {
    tracker.silenceFrames += 1;
  } else {
    tracker.silenceFrames = 0;
  }

  const lockToIdle = tracker.silenceFrames > options.silenceHoldFrames;
  const cleaned = lockToIdle ? 0 : Math.max(0, (frameEnergy - gate) / Math.max(0.001, 1 - gate));
  const curved = Math.pow(cleaned, 0.72);
  const smoothing = curved > tracker.level ? options.attack : options.release;
  tracker.level += (curved - tracker.level) * smoothing;

  return tracker.level;
}

const AgentWaveform = ({ analyser, isSpeaking }: { analyser: AnalyserNode | null, isSpeaking: boolean }) => {
  const barsContainerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const levelsRef = useRef<number[]>(Array(AGENT_BIN_INDICES.length).fill(0));
  const noiseFloorRef = useRef(0.01);
  const silenceFramesRef = useRef(0);

  useEffect(() => {
    const container = barsContainerRef.current;
    if (!container) return;

    const barEls = Array.from(container.children) as HTMLElement[];
    let lastFrameTime = 0;

    const tick = (timestamp: number) => {
      if (timestamp - lastFrameTime < AGENT_FRAME_INTERVAL_MS) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastFrameTime = timestamp;

      if (!analyser || !isSpeaking) {
        silenceFramesRef.current = AGENT_SILENCE_HOLD_FRAMES + 1;
        for (let i = 0; i < AGENT_BIN_INDICES.length; i++) {
          levelsRef.current[i] *= 0.65;
          const scale = AGENT_IDLE_SCALE + levelsRef.current[i] * (AGENT_MAX_SCALE - AGENT_IDLE_SCALE);
          barEls[i].style.transform = `scaleY(${scale.toFixed(3)})`;
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const requiredLength = analyser.frequencyBinCount;
      if (!dataArrayRef.current || dataArrayRef.current.length !== requiredLength) {
        dataArrayRef.current = new Uint8Array(requiredLength);
      }

      analyser.smoothingTimeConstant = 0.6;
      const dataArray = dataArrayRef.current;
      analyser.getByteFrequencyData(dataArray);

      let frameEnergy = 0;
      for (let i = 0; i < AGENT_BIN_INDICES.length; i++) {
        const binIndex = Math.min(AGENT_BIN_INDICES[i], dataArray.length - 1);
        frameEnergy += (dataArray[binIndex] ?? 0) / 255;
      }
      frameEnergy /= AGENT_BIN_INDICES.length;

      const floorTarget = Math.min(frameEnergy, 0.06);
      noiseFloorRef.current = (noiseFloorRef.current * (1 - AGENT_NOISE_FLOOR_ADAPT)) + (floorTarget * AGENT_NOISE_FLOOR_ADAPT);
      const gate = Math.min(0.2, noiseFloorRef.current + AGENT_GATE_OFFSET);

      if (frameEnergy < gate + AGENT_SILENCE_MARGIN) {
        silenceFramesRef.current += 1;
      } else {
        silenceFramesRef.current = 0;
      }

      const lockToIdle = silenceFramesRef.current > AGENT_SILENCE_HOLD_FRAMES;

      for (let i = 0; i < AGENT_BIN_INDICES.length; i++) {
        const binIndex = Math.min(AGENT_BIN_INDICES[i], dataArray.length - 1);
        const raw = (dataArray[binIndex] ?? 0) / 255;
        const cleaned = lockToIdle ? 0 : Math.max(0, (raw - gate) / Math.max(0.001, 1 - gate));
        const curved = Math.pow(cleaned, 0.68);
        const prev = levelsRef.current[i];
        const smoothing = curved > prev ? AGENT_ATTACK : AGENT_RELEASE;
        const next = prev + (curved - prev) * smoothing;

        levelsRef.current[i] = next;
        const scale = AGENT_IDLE_SCALE + next * (AGENT_MAX_SCALE - AGENT_IDLE_SCALE);
        barEls[i].style.transform = `scaleY(${Math.max(AGENT_IDLE_SCALE, scale).toFixed(3)})`;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser, isSpeaking]);

  return (
    <div ref={barsContainerRef} className="flex items-center space-x-[2px] h-3">
      <div className="w-[3px] h-full bg-emerald-500 rounded-full origin-bottom will-change-transform" style={{ transform: `scaleY(${AGENT_IDLE_SCALE})` }} />
      <div className="w-[3px] h-full bg-emerald-500 rounded-full origin-bottom will-change-transform" style={{ transform: `scaleY(${AGENT_IDLE_SCALE})` }} />
      <div className="w-[3px] h-full bg-emerald-500 rounded-full origin-bottom will-change-transform" style={{ transform: `scaleY(${AGENT_IDLE_SCALE})` }} />
      <div className="w-[3px] h-full bg-emerald-500 rounded-full origin-bottom will-change-transform" style={{ transform: `scaleY(${AGENT_IDLE_SCALE})` }} />
    </div>
  );
};

export function RehearsalMode({ onBack }: { onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const insightsPanelRef = useRef<HTMLDivElement>(null);
  const [indicators, setIndicators] = useState<IndicatorData | null>(null);
  const [feedbackHistory, setFeedbackHistory] = useState<FeedbackItem[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const sessionStartTimeRef = useRef<number | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  // Initialize preview stream on mount
  useEffect(() => {
    async function startPreview() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        previewStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.warn("Could not get preview stream", err);
      }
    }
    startPreview();

    return () => {
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);
  const handleIndicatorsUpdate = (data: IndicatorData) => {
    setIndicators(data);

    if (data.feedbackMessage) {
      setFeedbackHistory(prev => {
        let timeStr = "00:00";
        if (sessionStartTimeRef.current) {
          const diffMs = Date.now() - sessionStartTimeRef.current;
          const mins = Math.floor(diffMs / 60000);
          const secs = Math.floor((diffMs % 60000) / 1000);
          timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
        }

        const newItem: FeedbackItem = {
          id: Math.random().toString(36).substring(7),
          timestamp: timeStr,
          message: data.feedbackMessage
        };

        return [newItem, ...prev]; // Prepend new items
      });
    }
  };

  const { isConnected, isConnecting, error, connect, disconnect, analyserRef, playbackAnalyserRef, isSpeaking } = useLiveAPI({
    mode: 'rehearsal',
    onIndicatorsUpdate: handleIndicatorsUpdate
  });

  useEffect(() => {
    if (isConnected) {
      const now = Date.now();
      setSessionStartTime(now);
      sessionStartTimeRef.current = now;
      setFeedbackHistory([{
        id: 'start',
        timestamp: '00:00',
        message: 'Session started'
      }]);
    } else {
      setSessionStartTime(null);
      sessionStartTimeRef.current = null;
      setIndicators(null);
      setFeedbackHistory([]);

      // Restore preview stream if we just disconnected
      if (videoRef.current && previewStreamRef.current) {
        videoRef.current.srcObject = previewStreamRef.current;
      }
    }
  }, [isConnected]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  useEffect(() => {
    const insightsPanel = insightsPanelRef.current;

    const resetGlow = () => {
      if (insightsPanel) {
        insightsPanel.style.boxShadow = '';
        insightsPanel.style.borderColor = '';
      }
    };

    if (!insightsPanel || !isConnected) {
      resetGlow();
      return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      resetGlow();
      return;
    }

    const agentTracker = createLevelTracker(0.01);
    let rafId = 0;
    let lastFrameTime = 0;

    const tick = (timestamp: number) => {
      if (timestamp - lastFrameTime < SECTION_GLOW_FRAME_INTERVAL_MS) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      lastFrameTime = timestamp;

      const agentLevel = isSpeaking
        ? sampleAudioLevel(playbackAnalyserRef.current, AGENT_GLOW_BINS, agentTracker, {
          attack: 0.46,
          release: 0.24,
          floorAdapt: 0.03,
          gateOffset: 0.018,
          silenceMargin: 0.007,
          silenceHoldFrames: 4,
        })
        : sampleAudioLevel(null, AGENT_GLOW_BINS, agentTracker, {
          attack: 0.46,
          release: 0.24,
          floorAdapt: 0.03,
          gateOffset: 0.018,
          silenceMargin: 0.007,
          silenceHoldFrames: 4,
        });

      const agentGlow = Math.min(1, agentLevel * 1.45);

      insightsPanel.style.boxShadow = agentGlow > 0.02
        ? `0 0 ${10 + agentGlow * 20}px rgba(16, 185, 129, ${0.1 + agentGlow * 0.2}), inset 0 0 ${6 + agentGlow * 10}px rgba(16, 185, 129, ${0.06 + agentGlow * 0.12})`
        : '';
      insightsPanel.style.borderColor = agentGlow > 0.03
        ? `rgba(52, 211, 153, ${0.34 + agentGlow * 0.36})`
        : '';

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      resetGlow();
    };
  }, [isConnected, isSpeaking, analyserRef, playbackAnalyserRef]);

  const handleToggleConnect = () => {
    if (isConnected || isConnecting) {
      disconnect();
    } else if (videoRef.current) {
      connect(videoRef.current);
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/50 backdrop-blur-md">
        <button onClick={onBack} className="flex items-center text-zinc-400 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5 mr-2" /> Back
        </button>
        <div className="flex items-center space-x-2">
          {isConnected && isSpeaking ? (
            <AgentWaveform analyser={playbackAnalyserRef.current} isSpeaking={isSpeaking} />
          ) : (
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
          )}
          <span className="text-sm font-medium text-zinc-300">
            {isConnecting ? 'Connecting...' : isConnected ? (isSpeaking ? 'Coach is speaking...' : 'Live Coach Active') : 'Ready to Rehearse'}
          </span>
        </div>
      </header>

      <main className="flex-1 flex p-6 gap-6 min-h-0">
        <div className="flex-1 relative bg-zinc-900 rounded-3xl overflow-hidden border border-zinc-800 flex flex-col">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />

          {/* HUD Overlay for Camera */}
          {indicators && <CameraOverlay data={indicators} />}

          {/* Overlay Controls */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center space-x-4 bg-zinc-950/80 backdrop-blur-md px-6 py-3 rounded-full border border-zinc-800 z-10">
            <button
              onClick={handleToggleConnect}
              className={`flex items-center px-4 py-2 rounded-full font-medium transition-colors ${isConnected || isConnecting
                ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                : 'bg-indigo-500 text-white hover:bg-indigo-600'
                }`}
            >
              {isConnected || isConnecting ? 'End Session' : 'Start Rehearsal'}
            </button>
          </div>

          {error && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-4 py-2 rounded-lg text-sm backdrop-blur-md z-10">
              {error}
            </div>
          )}
        </div>

        <div className="w-[360px] flex flex-col gap-6">
          <div ref={insightsPanelRef} className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex-1 overflow-y-auto flex flex-col min-h-[500px] transition-[border-color,box-shadow] duration-150">
            <h3 className="text-lg font-semibold mb-4 flex items-center shrink-0">
              <Activity className="w-5 h-5 mr-2 text-indigo-400" />
              Session Insights
            </h3>
            {isConnected ? (
              <SessionInsights
                data={indicators ?? {
                  pace: 'Analyzing...',
                  eyeContact: 'Analyzing...',
                  posture: 'Analyzing...',
                  fillerWords: { total: 0, breakdown: {} },
                  feedbackMessage: '',
                  confidenceScore: 0,
                  volumeLevel: 'Good',
                  overallScore: 0,
                }}
                feedbackHistory={feedbackHistory}
                analyserRef={analyserRef}
              />
            ) : isConnecting ? (
              <div className="flex-1 flex items-center justify-center min-h-[300px]">
                <AnalyzingPulse />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center min-h-[300px] text-center px-6">
                <div className="w-16 h-16 rounded-full bg-zinc-800/50 flex items-center justify-center mb-4 ring-1 ring-zinc-700/50">
                  <Activity className="w-8 h-8 text-zinc-500" />
                </div>
                <h4 className="text-zinc-300 font-medium mb-2">Ready to Start</h4>
                <p className="text-zinc-500 text-sm max-w-[250px]">
                  Click <strong>Start Rehearsal</strong> when you're ready. The AI coach will analyze your performance in real-time.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
