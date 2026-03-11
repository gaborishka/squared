import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, ActivityHandling, TurnCoverage, Behavior, FunctionResponseScheduling } from '@google/genai';
import { FilesetResolver, FaceLandmarker, FaceLandmarkerResult, NormalizedLandmark, PoseLandmarker, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { IndicatorUpdate, SlideAnalysisToolPayload } from '../types';

const TRANSCRIPT_PACE_WINDOW_MS = 20000;
const DERIVED_INDICATOR_TICK_MS = 500;
const RECENT_SPEECH_MS = 3000;
const MIN_PACE_SAMPLE_MS = 5000;
const LOCAL_VISUAL_TICK_MS = 120;
const LOCAL_VISUAL_LOSS_TICKS = 6;
const MAJORITY_WINDOW_SIZE = 12;
const MAJORITY_THRESHOLD = 0.6;
const CALIBRATION_READINGS = 25;
const MEDIAPIPE_WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const FACE_LANDMARKER_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const POSE_LANDMARKER_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const WORD_PATTERN = /[A-Za-zА-Яа-яІіЇїЄєҐґ']+/g;
const FILLER_SINGLE_WORDS = new Set([
  'um',
  'uh',
  'erm',
  'hmm',
  'like',
  'basically',
  'actually',
  'literally',
  'ну',
  'ее',
  'ем',
  'типу',
  'короче',
  'значить',
  'якби',
]);
const FILLER_PHRASE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'you know', pattern: /\byou\s+know\b/g },
  { label: 'i mean', pattern: /\bi\s+mean\b/g },
];

const tokenizeWords = (text: string) => text.match(WORD_PATTERN)?.map(word => word.toLowerCase()) ?? [];

type MajorityVoter = {
  window: string[];
  current: string;
};

const createMajorityVoter = (initial = 'Analyzing...'): MajorityVoter => ({
  window: [],
  current: initial,
});

const advanceMajorityVote = (voter: MajorityVoter, next: string): boolean => {
  voter.window.push(next);
  if (voter.window.length > MAJORITY_WINDOW_SIZE) {
    voter.window.shift();
  }
  if (voter.window.length < 3) return false;

  const counts: Record<string, number> = {};
  for (const v of voter.window) {
    counts[v] = (counts[v] ?? 0) + 1;
  }

  const threshold = Math.ceil(voter.window.length * MAJORITY_THRESHOLD);
  for (const [value, count] of Object.entries(counts)) {
    if (count >= threshold && value !== voter.current) {
      voter.current = value;
      return true;
    }
  }
  return false;
};

type CalibrationState = {
  done: boolean;
  samples: number[];
  baseline: number;
  mad: number;
};

const createCalibrationState = (): CalibrationState => ({
  done: false, samples: [], baseline: 0, mad: 0,
});

const median = (arr: number[]) => {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const finalizeCalibration = (state: CalibrationState) => {
  state.baseline = median(state.samples);
  const deviations = state.samples.map(v => Math.abs(v - state.baseline));
  state.mad = Math.max(median(deviations), 0.02);
  state.done = true;
};

const getLandmark = (landmarks: NormalizedLandmark[], index: number) => landmarks[index] ?? null;

const averageLandmarks = (points: Array<NormalizedLandmark | null>): NormalizedLandmark | null => {
  const filtered = points.filter((point): point is NormalizedLandmark => Boolean(point));
  if (filtered.length === 0) return null;
  let sumX = 0;
  let sumY = 0;
  let sumVisibility = 0;
  for (const point of filtered) {
    sumX += point.x;
    sumY += point.y;
    sumVisibility += point.visibility;
  }
  return {
    x: sumX / filtered.length,
    y: sumY / filtered.length,
    z: 0,
    visibility: sumVisibility / filtered.length,
  };
};

const distance2d = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y);

type EyeContactResult = { level: string; faceRatio: number };

const evaluateEyeContact = (result: FaceLandmarkerResult): EyeContactResult | null => {
  const landmarks = result.faceLandmarks[0];
  if (!landmarks?.length) return null;

  const nose = getLandmark(landmarks, 1);
  const leftOuter = getLandmark(landmarks, 33);
  const leftInner = getLandmark(landmarks, 133);
  const rightInner = getLandmark(landmarks, 362);
  const rightOuter = getLandmark(landmarks, 263);
  const forehead = getLandmark(landmarks, 10);
  const chin = getLandmark(landmarks, 152);
  if (!nose || !leftOuter || !leftInner || !rightInner || !rightOuter || !forehead || !chin) return null;

  const interocularDistance = distance2d(leftInner, rightInner);
  if (interocularDistance < 0.0001) return null;

  const eyeCenter = averageLandmarks([leftOuter, leftInner, rightInner, rightOuter]);
  if (!eyeCenter) return null;
  const absYaw = Math.abs((nose.x - eyeCenter.x) / interocularDistance);

  const faceHeight = distance2d(forehead, chin);
  const faceRatio = faceHeight / interocularDistance;

  // Iris-based horizontal gaze
  const leftIris = averageLandmarks([
    getLandmark(landmarks, 468),
    getLandmark(landmarks, 469),
    getLandmark(landmarks, 470),
    getLandmark(landmarks, 471),
    getLandmark(landmarks, 472),
  ]);
  const rightIris = averageLandmarks([
    getLandmark(landmarks, 473),
    getLandmark(landmarks, 474),
    getLandmark(landmarks, 475),
    getLandmark(landmarks, 476),
    getLandmark(landmarks, 477),
  ]);

  const leftEyeCenter = averageLandmarks([leftOuter, leftInner]);
  const rightEyeCenter = averageLandmarks([rightOuter, rightInner]);
  const leftEyeWidth = distance2d(leftOuter, leftInner);
  const rightEyeWidth = distance2d(rightOuter, rightInner);
  const leftIrisOffset = leftIris && leftEyeCenter && leftEyeWidth > 0.0001
    ? (leftIris.x - leftEyeCenter.x) / leftEyeWidth
    : null;
  const rightIrisOffset = rightIris && rightEyeCenter && rightEyeWidth > 0.0001
    ? (rightIris.x - rightEyeCenter.x) / rightEyeWidth
    : null;

  const offsets = [leftIrisOffset, rightIrisOffset].filter((value): value is number => value !== null);
  const absIrisOffset = offsets.length > 0
    ? Math.abs(offsets.reduce((sum, value) => sum + value, 0) / offsets.length)
    : 0;

  // Iris vertical check
  const leftUpperLid = getLandmark(landmarks, 159);
  const leftLowerLid = getLandmark(landmarks, 145);
  const rightUpperLid = getLandmark(landmarks, 386);
  const rightLowerLid = getLandmark(landmarks, 374);

  let meanVertical = 0.5;
  if (leftIris && leftUpperLid && leftLowerLid && rightIris && rightUpperLid && rightLowerLid) {
    const leftEyeHeight = leftLowerLid.y - leftUpperLid.y;
    const rightEyeHeight = rightLowerLid.y - rightUpperLid.y;
    if (leftEyeHeight > 0.003 && rightEyeHeight > 0.003) {
      const leftV = (leftIris.y - leftUpperLid.y) / leftEyeHeight;
      const rightV = (rightIris.y - rightUpperLid.y) / rightEyeHeight;
      meanVertical = (leftV + rightV) / 2;
    }
  }

  // Compute severity: 0 = on camera, 1 = mild, 2 = severe
  // Wide "normal" zone: people look at screen, not camera — slight gaze offset is expected
  let severity = 0;
  if (absYaw > 0.6 || absIrisOffset > 0.35 || meanVertical > 0.82 || faceRatio < 1.5) {
    severity = 2;
  } else if (absYaw > 0.42 || absIrisOffset > 0.25 || meanVertical > 0.75 || faceRatio < 1.8) {
    severity = 1;
  }

  const level = severity === 2 ? 'Looking away' : severity === 1 ? 'Glancing away' : 'Looking at camera';
  return { level, faceRatio };
};

type PostureResult = { level: string; score: number };

const evaluatePosture = (result: PoseLandmarkerResult): PostureResult | null => {
  const landmarks = result.landmarks[0];
  if (!landmarks?.length) return null;

  const nose = getLandmark(landmarks, 0);
  const leftShoulder = getLandmark(landmarks, 11);
  const rightShoulder = getLandmark(landmarks, 12);
  if (!nose || !leftShoulder || !rightShoulder) return null;

  const shoulderWidth = distance2d(leftShoulder, rightShoulder);
  if (shoulderWidth < 0.0001) return null;

  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
  const headDrop = (nose.y - shoulderMidY) / shoulderWidth;
  const shoulderTilt = Math.abs(leftShoulder.y - rightShoulder.y) / shoulderWidth;
  const lateralOffset = Math.abs(nose.x - shoulderMidX) / shoulderWidth;

  // Aggregated score: max of the three normalized deviations
  const score = Math.max(headDrop, shoulderTilt, lateralOffset);

  // Default (uncalibrated) thresholds — wide normal zone for typical webcam setups
  let level: string;
  if (headDrop > -0.05 || shoulderTilt > 0.35 || lateralOffset > 0.55) {
    level = 'Slouching';
  } else if (headDrop > -0.18 || shoulderTilt > 0.25 || lateralOffset > 0.45) {
    level = 'Watch posture';
  } else {
    level = 'Upright';
  }

  return { level, score };
};

export function useLiveAPI({
  mode,
  contextText,
  onIndicatorsUpdate,
  onSlideAnalysis,
  onTranscriptSegment,
  onMediaStream,
}: {
  mode: 'rehearsal' | 'presentation';
  contextText?: string;
  onIndicatorsUpdate?: (data: IndicatorUpdate) => void;
  onSlideAnalysis?: (payload: SlideAnalysisToolPayload) => void;
  onTranscriptSegment?: (payload: { text: string; capturedAt: number }) => void;
  onMediaStream?: (stream: MediaStream | null) => void;
}) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const isSpeakingRef = useRef(false);

  const sessionRef = useRef<Promise<unknown> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const playbackAnalyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const sourceNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const speechStartTimeoutsRef = useRef<number[]>([]);
  const speechStopTimeoutRef = useRef<number | null>(null);
  const isSocketOpenRef = useRef(false);
  const isSessionReadyRef = useRef(false);
  const indicatorIntervalRef = useRef<number | null>(null);
  const recentWordTimestampsRef = useRef<number[]>([]);
  const fillerBreakdownRef = useRef<Record<string, number>>({});
  const lastTranscriptChunkRef = useRef('');
  const lastSpeechTimestampRef = useRef(0);
  const volumeTimeDomainRef = useRef<Uint8Array | null>(null);
  const smoothedVolumeRef = useRef(0);
  const lastDerivedSignatureRef = useRef('');
  const localVisualIntervalRef = useRef<number | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const localVisualActiveRef = useRef(false);
  const eyeStatusRef = useRef<MajorityVoter>(createMajorityVoter());
  const postureStatusRef = useRef<MajorityVoter>(createMajorityVoter());
  const eyeCalibrationRef = useRef<CalibrationState>(createCalibrationState());
  const postureCalibrationRef = useRef<CalibrationState>(createCalibrationState());
  const missingFaceTicksRef = useRef(0);
  const missingPoseTicksRef = useRef(0);
  const lastLocalVisualSignatureRef = useRef('');

  // Session management refs
  const resumptionHandleRef = useRef<string | null>(null);
  const isReconnectingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const userInitiatedDisconnectRef = useRef(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const aiRef = useRef<GoogleGenAI | null>(null);
  const connectConfigRef = useRef<any>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  // Callback refs to avoid stale closures
  const onIndicatorsUpdateRef = useRef(onIndicatorsUpdate);
  onIndicatorsUpdateRef.current = onIndicatorsUpdate;
  const onSlideAnalysisRef = useRef(onSlideAnalysis);
  onSlideAnalysisRef.current = onSlideAnalysis;
  const ingestInputTranscriptRef = useRef<(text: string) => void>(() => {});

  const reconnectRef = useRef<() => void>(() => {});

  const resetDerivedIndicatorsState = useCallback(() => {
    recentWordTimestampsRef.current = [];
    fillerBreakdownRef.current = {};
    lastTranscriptChunkRef.current = '';
    lastSpeechTimestampRef.current = 0;
    volumeTimeDomainRef.current = null;
    smoothedVolumeRef.current = 0;
    lastDerivedSignatureRef.current = '';
  }, []);

  const resetLocalVisualState = useCallback(() => {
    localVisualActiveRef.current = false;
    eyeStatusRef.current = createMajorityVoter();
    postureStatusRef.current = createMajorityVoter();
    eyeCalibrationRef.current = createCalibrationState();
    postureCalibrationRef.current = createCalibrationState();
    missingFaceTicksRef.current = 0;
    missingPoseTicksRef.current = 0;
    lastLocalVisualSignatureRef.current = '';
  }, []);

  const setSpeakingState = useCallback((value: boolean) => {
    if (isSpeakingRef.current === value) return;
    isSpeakingRef.current = value;
    setIsSpeaking(value);
  }, []);

  const clearSpeakingTimers = useCallback(() => {
    speechStartTimeoutsRef.current.forEach(id => clearTimeout(id));
    speechStartTimeoutsRef.current = [];
    if (speechStopTimeoutRef.current !== null) {
      clearTimeout(speechStopTimeoutRef.current);
      speechStopTimeoutRef.current = null;
    }
  }, []);

  const isSessionTransportOpen = useCallback((session: any) => {
    const readyState = session?.conn?.ws?.readyState;
    if (typeof readyState === 'number') {
      return readyState === 1;
    }
    return isSocketOpenRef.current;
  }, []);

  const withOpenSession = useCallback((handler: (session: any) => void) => {
    const currentPromise = sessionRef.current;
    if (!currentPromise || !isSocketOpenRef.current) return;
    if (!isSessionReadyRef.current) return;
    currentPromise.then((session: any) => {
      if (sessionRef.current !== currentPromise || !isSocketOpenRef.current) return;
      if (!isSessionReadyRef.current) return;
      if (!isSessionTransportOpen(session)) return;
      handler(session);
    });
  }, [isSessionTransportOpen]);

  const handleServerMessage = useCallback((
    message: LiveServerMessage,
    sessionPromise: Promise<any>,
    playbackContext: AudioContext,
    sessionMode: 'rehearsal' | 'presentation',
    ingestInputTranscript: (text: string) => void,
    reconnectFn: () => void,
  ) => {
    if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) {
      return;
    }

    if (message.setupComplete) {
      isSessionReadyRef.current = true;
      console.log(`[DebateCoach] Session setup complete at ${new Date().toISOString()}`);
    }

    // Save resumption handle for transparent reconnect
    const msgAny = message as any;
    if (msgAny.sessionResumptionUpdate) {
      const { newHandle, resumable } = msgAny.sessionResumptionUpdate;
      if (resumable !== false && newHandle) {
        resumptionHandleRef.current = newHandle;
        console.debug(`[DebateCoach] Resumption handle saved`);
      }
    }

    // Server signals imminent disconnect — attempt reconnect
    if (msgAny.goAway) {
      console.warn(`[DebateCoach] Received goAway from server`);
      if (!isReconnectingRef.current) {
        reconnectFn();
      }
    }

    // Log audio transcriptions (input & output)
    const sc = message.serverContent as any;
    if (sc?.inputTranscription?.text) {
      console.log(`[DebateCoach] User said: "${sc.inputTranscription.text}"`);
      ingestInputTranscript(sc.inputTranscription.text);
    }
    if (sc?.outputTranscription?.text) {
      console.debug(`[DebateCoach] Model said: "${sc.outputTranscription.text}"`);
    }

    if (message.serverContent?.modelTurn) {
      const parts = message.serverContent.modelTurn.parts;
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data && sessionMode === 'rehearsal') {
          const base64Audio = part.inlineData.data;
          const binaryString = atob(base64Audio);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const pcm16 = new Int16Array(bytes.buffer);
          const audioBuffer = playbackContext.createBuffer(1, pcm16.length, 24000);
          const channelData = audioBuffer.getChannelData(0);
          for (let i = 0; i < pcm16.length; i++) {
            channelData[i] = pcm16[i] / 32768;
          }
          const sourceNode = playbackContext.createBufferSource();
          sourceNode.buffer = audioBuffer;
          if (playbackAnalyserRef.current) {
            sourceNode.connect(playbackAnalyserRef.current);
          } else {
            sourceNode.connect(playbackContext.destination);
          }

          const startTime = Math.max(playbackContext.currentTime, nextPlayTimeRef.current);
          sourceNode.start(startTime);
          nextPlayTimeRef.current = startTime + audioBuffer.duration;
          sourceNodesRef.current.push(sourceNode);

          if (speechStopTimeoutRef.current !== null) {
            clearTimeout(speechStopTimeoutRef.current);
            speechStopTimeoutRef.current = null;
          }

          const startDelayMs = Math.max(0, (startTime - playbackContext.currentTime) * 1000);
          if (startDelayMs <= 20) {
            setSpeakingState(true);
          } else {
            const timeoutId = window.setTimeout(() => {
              speechStartTimeoutsRef.current = speechStartTimeoutsRef.current.filter(id => id !== timeoutId);
              if (!isSocketOpenRef.current) return;
              setSpeakingState(true);
            }, startDelayMs);
            speechStartTimeoutsRef.current.push(timeoutId);
          }

          sourceNode.onended = () => {
            sourceNodesRef.current = sourceNodesRef.current.filter(n => n !== sourceNode);
            if (sourceNodesRef.current.length === 0) {
              if (speechStopTimeoutRef.current !== null) {
                clearTimeout(speechStopTimeoutRef.current);
              }
              speechStopTimeoutRef.current = window.setTimeout(() => {
                speechStopTimeoutRef.current = null;
                if (!isSocketOpenRef.current) return;
                setSpeakingState(false);
              }, 90);
            }
          };
        }
      }
    }

    if (message.serverContent?.interrupted) {
      clearSpeakingTimers();
      sourceNodesRef.current.forEach(node => {
        try { node.stop(); } catch (e) { }
      });
      sourceNodesRef.current = [];
      setSpeakingState(false);
      nextPlayTimeRef.current = playbackContext.currentTime;
    }

    if (message.toolCall) {
      for (const call of message.toolCall.functionCalls) {
        if (call.name === 'updateIndicators' && onIndicatorsUpdateRef.current) {
          console.log(`[DebateCoach] Tool call received at ${new Date().toISOString()}`, {
            pace: call.args?.pace,
            eyeContact: call.args?.eyeContact,
            overallScore: call.args?.overallScore,
            currentSlide: call.args?.currentSlide,
            agentMode: call.args?.agentMode,
            microPrompt: call.args?.microPrompt,
            rescueText: call.args?.rescueText,
          });
          if (call.args && typeof call.args === 'object') {
            const update = { ...(call.args as IndicatorUpdate) };
            if (localVisualActiveRef.current) {
              delete update.eyeContact;
              delete update.posture;
            }
            onIndicatorsUpdateRef.current(update);
          }
        }

        if (call.name === 'saveSlideAnalysis' && onSlideAnalysisRef.current && call.args && typeof call.args === 'object') {
          const payload = call.args as unknown as SlideAnalysisToolPayload;
          if (typeof payload.slideNumber === 'number' && Array.isArray(payload.issues) && typeof payload.riskLevel === 'string') {
            onSlideAnalysisRef.current({
              slideNumber: payload.slideNumber,
              issues: payload.issues,
              bestPhrase: payload.bestPhrase ?? '',
              riskLevel: payload.riskLevel,
            });
          }
        }

        withOpenSession((session) => {
          try {
            session.sendToolResponse({
              functionResponses: [{
                id: call.id,
                name: call.name,
                response: { result: "ok" },
                scheduling: FunctionResponseScheduling.SILENT,
              }]
            });
          } catch (err) {
            // Ignore send errors
          }
        });
      }
    }
  }, [withOpenSession, setSpeakingState, clearSpeakingTimers]);

  const disconnect = useCallback((options?: { skipSessionClose?: boolean }) => {
    const shouldCloseSession = !options?.skipSessionClose;
    const currentSessionPromise = sessionRef.current;
    sessionRef.current = null;
    isSocketOpenRef.current = false;
    isSessionReadyRef.current = false;
    clearSpeakingTimers();

    if (shouldCloseSession && currentSessionPromise) {
      currentSessionPromise.then((session: any) => {
        try {
          // If already closed, this might throw or do nothing, but safe to try.
          session.close();
        } catch (e) { }
      });
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => { });
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    playbackAnalyserRef.current = null;
    if (playbackContextRef.current) {
      playbackContextRef.current.close().catch(() => { });
      playbackContextRef.current = null;
    }
    sourceNodesRef.current.forEach(node => {
      try { node.stop(); } catch (e) { }
    });
    sourceNodesRef.current = [];
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      onMediaStream?.(null);
    }
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    if (indicatorIntervalRef.current) {
      clearInterval(indicatorIntervalRef.current);
      indicatorIntervalRef.current = null;
    }
    if (localVisualIntervalRef.current) {
      clearInterval(localVisualIntervalRef.current);
      localVisualIntervalRef.current = null;
    }
    if (faceLandmarkerRef.current) {
      faceLandmarkerRef.current.close();
      faceLandmarkerRef.current = null;
    }
    if (poseLandmarkerRef.current) {
      poseLandmarkerRef.current.close();
      poseLandmarkerRef.current = null;
    }
    resetDerivedIndicatorsState();
    resetLocalVisualState();
    setIsConnected(false);
    setIsConnecting(false);
    setSpeakingState(false);
  }, [clearSpeakingTimers, resetDerivedIndicatorsState, resetLocalVisualState, setSpeakingState]);

  const connect = useCallback(async (videoElement: HTMLVideoElement) => {
    setIsConnecting(true);
    setError(null);
    clearSpeakingTimers();
    setSpeakingState(false);
    resetDerivedIndicatorsState();
    resetLocalVisualState();
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("API Key is missing");
      const ai = new GoogleGenAI({ apiKey, httpOptions: { "apiVersion": "v1alpha" } });

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch (err: any) {
        console.warn("Failed to get audio+video stream, trying audio only", err);
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (audioErr: any) {
          if (audioErr.name === 'NotAllowedError' || audioErr.message === 'Permission denied') {
            throw new Error("Camera/Microphone access denied. Please allow permissions in your browser's URL bar or settings.");
          }
          throw new Error(`Media access error: ${audioErr.message}`);
        }
      }

      streamRef.current = stream;
      onMediaStream?.(stream);
      if (videoElement && stream.getVideoTracks().length > 0) {
        videoElement.srcObject = stream;
      }

      // Setup Audio Capture
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);

      // AnalyserNode for real-time audio visualization
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64; // Small FFT for 32 frequency bins — enough for 5-7 bars
      analyser.smoothingTimeConstant = 0.4; // Smooth but responsive
      source.connect(analyser);
      analyserRef.current = analyser;

      const workletCode = `
        class PCMProcessor extends AudioWorkletProcessor {
          process(inputs, outputs, parameters) {
            const input = inputs[0];
            if (input && input.length > 0) {
              const channelData = input[0];
              const pcm16 = new Int16Array(channelData.length);
              for (let i = 0; i < channelData.length; i++) {
                pcm16[i] = Math.max(-32768, Math.min(32767, channelData[i] * 32768));
              }
              this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
            }
            return true;
          }
        }
        registerProcessor('pcm-processor', PCMProcessor);
      `;
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      try {
        await audioContext.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
      source.connect(workletNode);

      // Setup Audio Playback
      const playbackContext = new AudioContext({ sampleRate: 24000 });
      playbackContextRef.current = playbackContext;
      nextPlayTimeRef.current = playbackContext.currentTime;

      const playbackAnalyser = playbackContext.createAnalyser();
      playbackAnalyser.fftSize = 64;
      playbackAnalyser.smoothingTimeConstant = 0.5;
      playbackAnalyser.connect(playbackContext.destination);
      playbackAnalyserRef.current = playbackAnalyser;

      const baseInstruction = mode === 'rehearsal'
        ? "You are DebateCoach, an AI rehearsal coach. The user is practicing a structured presentation. You receive live audio and video. Track delivery quality, slide progress, risky transitions, filler words, volume, confidence, eye contact, and posture. In rehearsal mode you may interrupt briefly with spoken coaching when needed. Always use updateIndicators to keep the UI current, and use saveSlideAnalysis whenever you identify per-slide issues or strong recovery phrases."
        : "You are DebateCoach, a silent live presentation HUD. The user is presenting for real. You receive live audio and video. DO NOT SPEAK. Only use updateIndicators to send extremely short contextual cues, slide progress, timing status, and rescue teleprompter text when absolutely necessary. Keep interventions sparse and respect the attention budget in the provided game plan.";

      const MAX_CONTEXT_CHARS = 12000;
      const trimmedContext = contextText && contextText.length > MAX_CONTEXT_CHARS
        ? contextText.slice(0, MAX_CONTEXT_CHARS) + '\n\n(Context truncated for session stability.)'
        : contextText;

      const systemInstruction = trimmedContext
        ? `${baseInstruction}\n\nUse the following project and strategy context while coaching:\n${trimmedContext}`
        : baseInstruction;

      let sessionPromise: Promise<any>;

      const ingestInputTranscript = (rawText: string) => {
        const trimmed = rawText.trim();
        const normalized = trimmed.toLowerCase();
        if (!normalized) return;

        const now = Date.now();
        let delta = normalized;
        let deltaText = trimmed;
        const previousChunk = lastTranscriptChunkRef.current;

        if (previousChunk) {
          if (normalized === previousChunk) {
            lastSpeechTimestampRef.current = now;
            return;
          }
          if (normalized.startsWith(previousChunk)) {
            delta = normalized.slice(previousChunk.length);
            deltaText = trimmed.slice(previousChunk.length).trim();
          } else if (previousChunk.startsWith(normalized)) {
            lastSpeechTimestampRef.current = now;
            return;
          }
        }

        lastTranscriptChunkRef.current = normalized;
        lastSpeechTimestampRef.current = now;

        const words = tokenizeWords(delta);
        for (let i = 0; i < words.length; i++) {
          recentWordTimestampsRef.current.push(now);
        }

        if (deltaText) {
          onTranscriptSegment?.({ text: deltaText, capturedAt: now });
        }
        if (words.length === 0) return;

        const breakdown = fillerBreakdownRef.current;
        for (const word of words) {
          if (!FILLER_SINGLE_WORDS.has(word)) continue;
          breakdown[word] = (breakdown[word] ?? 0) + 1;
        }

        for (const { label, pattern } of FILLER_PHRASE_PATTERNS) {
          const matches = delta.match(pattern);
          if (!matches?.length) continue;
          breakdown[label] = (breakdown[label] ?? 0) + matches.length;
        }
      };
      ingestInputTranscriptRef.current = ingestInputTranscript;

      const startLocalVisualAnalysis = async () => {
        if (!onIndicatorsUpdate) return;
        if (stream.getVideoTracks().length === 0) return;
        if (localVisualIntervalRef.current) {
          clearInterval(localVisualIntervalRef.current);
          localVisualIntervalRef.current = null;
        }
        resetLocalVisualState();

        try {
          const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE_URL);
          if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;

          const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_URL },
            runningMode: 'VIDEO',
            numFaces: 1,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }).catch((err) => {
            console.warn('[DebateCoach] FaceLandmarker init failed', err);
            return null;
          });

          const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: POSE_LANDMARKER_MODEL_URL },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          }).catch((err) => {
            console.warn('[DebateCoach] PoseLandmarker init failed', err);
            return null;
          });

          if (!faceLandmarker && !poseLandmarker) {
            console.warn('[DebateCoach] Local visual analysis disabled: no landmarker initialized');
            return;
          }

          if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) {
            faceLandmarker?.close();
            poseLandmarker?.close();
            return;
          }

          if (faceLandmarker) {
            faceLandmarkerRef.current = faceLandmarker;
          }
          if (poseLandmarker) {
            poseLandmarkerRef.current = poseLandmarker;
          }
          localVisualActiveRef.current = true;

          const analysisCanvas = document.createElement('canvas');
          const analysisCtx = analysisCanvas.getContext('2d');

          localVisualIntervalRef.current = window.setInterval(() => {
            if (!isSocketOpenRef.current) return;
            if (videoElement.readyState < 2) return;
            if (!analysisCtx) return;

            const frameWidth = videoElement.videoWidth || 0;
            const frameHeight = videoElement.videoHeight || 0;
            if (frameWidth < 16 || frameHeight < 16) return;

            if (analysisCanvas.width !== frameWidth || analysisCanvas.height !== frameHeight) {
              analysisCanvas.width = frameWidth;
              analysisCanvas.height = frameHeight;
            }
            analysisCtx.drawImage(videoElement, 0, 0, frameWidth, frameHeight);

            const faceModel = faceLandmarkerRef.current;
            const poseModel = poseLandmarkerRef.current;
            if (!faceModel && !poseModel) return;

            const timestampMs = performance.now();
            let eyeResult: EyeContactResult | null = null;
            let postureResult: PostureResult | null = null;

            if (faceModel) {
              try {
                eyeResult = evaluateEyeContact(faceModel.detectForVideo(analysisCanvas, timestampMs));
              } catch {
                eyeResult = null;
              }
            }
            if (poseModel) {
              try {
                postureResult = evaluatePosture(poseModel.detectForVideo(analysisCanvas, timestampMs));
              } catch {
                postureResult = null;
              }
            }

            const hasFaceModel = Boolean(faceModel);
            const hasPoseModel = Boolean(poseModel);
            if (hasFaceModel) {
              missingFaceTicksRef.current = eyeResult ? 0 : missingFaceTicksRef.current + 1;
            }
            if (hasPoseModel) {
              missingPoseTicksRef.current = postureResult ? 0 : missingPoseTicksRef.current + 1;
            }

            // --- Calibration phase ---
            const eyeCal = eyeCalibrationRef.current;
            const postureCal = postureCalibrationRef.current;

            if (!eyeCal.done || !postureCal.done) {
              if (eyeResult && !eyeCal.done) {
                eyeCal.samples.push(eyeResult.faceRatio);
                if (eyeCal.samples.length >= CALIBRATION_READINGS) finalizeCalibration(eyeCal);
              }
              if (postureResult && !postureCal.done) {
                postureCal.samples.push(postureResult.score);
                if (postureCal.samples.length >= CALIBRATION_READINGS) finalizeCalibration(postureCal);
              }
              // Show calibrating status during calibration
              const calSig = 'Calibrating...|Calibrating...';
              if (calSig !== lastLocalVisualSignatureRef.current) {
                lastLocalVisualSignatureRef.current = calSig;
                onIndicatorsUpdate({ eyeContact: 'Calibrating...', posture: 'Calibrating...' });
              }
              return;
            }

            // --- Post-calibration: apply calibrated thresholds ---
            let eyeLevel: string;
            if (!eyeResult) {
              eyeLevel = missingFaceTicksRef.current > LOCAL_VISUAL_LOSS_TICKS ? 'Face not visible' : eyeStatusRef.current.current;
            } else {
              // Combine calibrated faceRatio deviation with the raw severity level
              const faceRatioDev = Math.abs(eyeResult.faceRatio - eyeCal.baseline) / eyeCal.mad;
              if (eyeResult.level === 'Looking away' || faceRatioDev > 5) {
                eyeLevel = 'Looking away';
              } else if (eyeResult.level === 'Glancing away' || faceRatioDev > 3) {
                eyeLevel = 'Glancing away';
              } else {
                eyeLevel = 'Looking at camera';
              }
            }

            let postureLevel: string;
            if (!postureResult) {
              postureLevel = missingPoseTicksRef.current > LOCAL_VISUAL_LOSS_TICKS ? 'Posture not visible' : postureStatusRef.current.current;
            } else {
              const scoreDev = Math.abs(postureResult.score - postureCal.baseline) / postureCal.mad;
              if (scoreDev > 5) {
                postureLevel = 'Slouching';
              } else if (scoreDev > 3) {
                postureLevel = 'Watch posture';
              } else {
                postureLevel = 'Upright';
              }
            }

            // --- Majority voting ---
            const eyeChanged = hasFaceModel && advanceMajorityVote(eyeStatusRef.current, eyeLevel);
            const postureChanged = hasPoseModel && advanceMajorityVote(postureStatusRef.current, postureLevel);
            if (!eyeChanged && !postureChanged) return;

            const update: IndicatorUpdate = {};
            if (eyeChanged) update.eyeContact = eyeStatusRef.current.current;
            if (postureChanged) update.posture = postureStatusRef.current.current;

            const signature = `${update.eyeContact ?? ''}|${update.posture ?? ''}`;
            if (signature === lastLocalVisualSignatureRef.current) return;
            lastLocalVisualSignatureRef.current = signature;
            console.log('[DebateCoach] Local visual update', update);
            onIndicatorsUpdate(update);
          }, LOCAL_VISUAL_TICK_MS);
        } catch (err) {
          console.warn('[DebateCoach] Local visual analysis unavailable', err);
        }
      };

      sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-latest",
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          realtimeInputConfig: {
            activityHandling: mode === 'presentation'
              ? ActivityHandling.NO_INTERRUPTION
              : ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
            turnCoverage: TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
            automaticActivityDetection: {
              disabled: false,
              silenceDurationMs: mode === 'presentation' ? 500 : 200,
              prefixPaddingMs: 20,
            },
          },
          proactivity: { proactiveAudio: true },
          enableAffectiveDialog: true,
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction,
          tools: [{
            functionDeclarations: [{
              name: "updateIndicators",
              description: "Update the visual indicators on the user's screen based on their current performance. Call this tool frequently, even during the user's speech, to keep the UI updated in real-time.",
              behavior: Behavior.NON_BLOCKING,
              parameters: {
                type: Type.OBJECT,
                properties: {
                  pace: { type: Type.STRING, description: "Current speaking pace (e.g., 'Good', 'Too Fast', 'Too Slow')" },
                  eyeContact: { type: Type.STRING, description: "Eye contact status (e.g., 'Looking at camera', 'Looking away')" },
                  posture: { type: Type.STRING, description: "Posture status (e.g., 'Good', 'Slouching')" },
                  fillerWords: {
                    type: Type.OBJECT,
                    description: "Object containing total count and breakdown of filler words. Example: { total: 2, breakdown: { 'um': 1, 'like': 1 } }",
                    properties: {
                      total: { type: Type.INTEGER, description: "Total number of filler words" },
                      breakdown: { type: Type.OBJECT, description: "Key-value pairs of word to its frequency" }
                    }
                  },
                  feedbackMessage: { type: Type.STRING, description: "A short feedback message to display to the user" },
                  confidenceScore: { type: Type.INTEGER, description: "1-100 confidence scale" },
                  volumeLevel: { type: Type.STRING, description: "'Too Quiet', 'Good', 'Too Loud'" },
                  overallScore: { type: Type.INTEGER, description: "1-100 overall performance score" },
                  currentSlide: { type: Type.INTEGER, description: "The slide number the user appears to be on right now." },
                  microPrompt: { type: Type.STRING, description: "A concise 1-3 word cue for the HUD." },
                  rescueText: { type: Type.STRING, description: "Short rescue teleprompter text for when the user is stuck." },
                  agentMode: {
                    type: Type.STRING,
                    description: "How forceful the current intervention should be.",
                    enum: ['monitor', 'soft_cue', 'directive', 'rescue'],
                  },
                  slideTimeRemaining: {
                    type: Type.INTEGER,
                    description: "Approximate seconds left before the speaker should transition off the current slide.",
                  }
                },
              }
            }, {
              name: "saveSlideAnalysis",
              description: "Persist a slide-level coaching insight discovered during the live session.",
              behavior: Behavior.NON_BLOCKING,
              parameters: {
                type: Type.OBJECT,
                properties: {
                  slideNumber: { type: Type.INTEGER, description: "The slide where the issue happened." },
                  issues: {
                    type: Type.ARRAY,
                    description: "Short descriptions of the issues observed on this slide.",
                    items: { type: Type.STRING },
                  },
                  bestPhrase: { type: Type.STRING, description: "A strong phrase the speaker used to recover or land the point." },
                  riskLevel: {
                    type: Type.STRING,
                    description: "Overall risk on this slide.",
                    enum: ['safe', 'watch', 'fragile'],
                  },
                },
                required: ['slideNumber', 'issues', 'riskLevel'],
              }
            }]
          }]
        },
        callbacks: {
          onopen: () => {
            if (sessionRef.current !== sessionPromise) return;
            console.log(`[DebateCoach] Session opened at ${new Date().toISOString()} | mode: ${mode}`);
            isSocketOpenRef.current = true;
            isSessionReadyRef.current = false;
            setIsConnected(true);
            setIsConnecting(false);
            if (onIndicatorsUpdate) {
              onIndicatorsUpdate({
                eyeContact: eyeStatusRef.current.current,
                posture: postureStatusRef.current.current,
              });
            }

            workletNode.port.onmessage = (e) => {
              if (!isSocketOpenRef.current) return;
              const pcm16 = new Int16Array(e.data);
              const bytes = new Uint8Array(pcm16.buffer);
              let binaryString = '';
              for (let i = 0; i < bytes.length; i++) {
                binaryString += String.fromCharCode(bytes[i]);
              }
              const base64Data = btoa(binaryString);
              withOpenSession((session) => {
                try {
                  session.sendRealtimeInput({ media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' } });
                } catch (err) {
                  // Ignore send errors when disconnecting
                }
              });
            };

            // Send video frames to Live session.
            if (stream.getVideoTracks().length > 0) {
              let frameCount = 0;
              videoIntervalRef.current = window.setInterval(() => {
                const canvas = document.createElement('canvas');
                canvas.width = videoElement.videoWidth || 640;
                canvas.height = videoElement.videoHeight || 480;
                const ctx = canvas.getContext('2d');
                if (ctx && videoElement.readyState >= 2) {
                  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                  const base64Image = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
                  frameCount++;
                  console.log(`[DebateCoach] Video frame #${frameCount} sent at ${new Date().toISOString()}`);
                  withOpenSession((session) => {
                    try {
                      session.sendRealtimeInput({ media: { data: base64Image, mimeType: 'image/jpeg' } });
                    } catch (err) {
                      // Ignore send errors
                    }
                  });
                }
              }, 1000); // 1 fps — balance between latency and bandwidth
            }

            // Derived indicator updates come from live transcription + local audio level.
            if (onIndicatorsUpdate) {
              indicatorIntervalRef.current = window.setInterval(() => {
                if (!isSocketOpenRef.current) return;

                const now = Date.now();
                const cutoff = now - TRANSCRIPT_PACE_WINDOW_MS;
                recentWordTimestampsRef.current = recentWordTimestampsRef.current.filter(ts => ts >= cutoff);

                const breakdownEntries = Object.entries(fillerBreakdownRef.current)
                  .filter(([, count]) => count > 0)
                  .sort(([a], [b]) => a.localeCompare(b));
                const fillerBreakdown = Object.fromEntries(breakdownEntries);
                const fillerTotal = breakdownEntries.reduce((sum, [, count]) => sum + count, 0);

                const hasRecentSpeech = now - lastSpeechTimestampRef.current <= RECENT_SPEECH_MS;
                let pace: string | undefined;
                if (hasRecentSpeech && recentWordTimestampsRef.current.length > 0) {
                  const oldestWordTimestamp = recentWordTimestampsRef.current[0] ?? now;
                  const sampleMs = Math.max(
                    MIN_PACE_SAMPLE_MS,
                    Math.min(TRANSCRIPT_PACE_WINDOW_MS, now - oldestWordTimestamp),
                  );
                  const wordsPerMinute = (recentWordTimestampsRef.current.length * 60000) / sampleMs;
                  if (wordsPerMinute > 170) pace = 'Too Fast';
                  else if (wordsPerMinute < 105) pace = 'Too Slow';
                  else pace = 'Good';
                }

                let volumeLevel: string | undefined;
                if (hasRecentSpeech && analyserRef.current) {
                  const analyser = analyserRef.current;
                  const neededLength = analyser.fftSize;
                  if (!volumeTimeDomainRef.current || volumeTimeDomainRef.current.length !== neededLength) {
                    volumeTimeDomainRef.current = new Uint8Array(neededLength);
                  }

                  const volumeData = volumeTimeDomainRef.current;
                  analyser.getByteTimeDomainData(volumeData);
                  let sumSquares = 0;
                  for (let i = 0; i < volumeData.length; i++) {
                    const centered = (volumeData[i] - 128) / 128;
                    sumSquares += centered * centered;
                  }
                  const rms = Math.sqrt(sumSquares / volumeData.length);
                  smoothedVolumeRef.current = (smoothedVolumeRef.current * 0.82) + (rms * 0.18);

                  if (smoothedVolumeRef.current < 0.015) volumeLevel = 'Too Quiet';
                  else if (smoothedVolumeRef.current > 0.11) volumeLevel = 'Too Loud';
                  else volumeLevel = 'Good';
                }

                const update: IndicatorUpdate = {
                  fillerWords: {
                    total: fillerTotal,
                    breakdown: fillerBreakdown,
                  },
                };
                if (pace) {
                  const oldestWordTimestamp = recentWordTimestampsRef.current[0] ?? now;
                  const sampleMs = Math.max(
                    MIN_PACE_SAMPLE_MS,
                    Math.min(TRANSCRIPT_PACE_WINDOW_MS, now - oldestWordTimestamp),
                  );
                  update.pace = pace;
                  update.paceWpm = Number(((recentWordTimestampsRef.current.length * 60000) / sampleMs).toFixed(1));
                }
                if (volumeLevel) update.volumeLevel = volumeLevel;

                const signature = `${update.pace ?? ''}|${update.paceWpm ?? ''}|${update.volumeLevel ?? ''}|${fillerTotal}|${JSON.stringify(fillerBreakdown)}`;
                if (signature === lastDerivedSignatureRef.current) return;
                lastDerivedSignatureRef.current = signature;
                onIndicatorsUpdate(update);
              }, DERIVED_INDICATOR_TICK_MS);
            }

            void startLocalVisualAnalysis();

          },
          onmessage: async (message: LiveServerMessage) => {
            handleServerMessage(message, sessionPromise, playbackContext, mode, ingestInputTranscript, reconnectRef.current);
          },
          onclose: (event: CloseEvent) => {
            if (sessionRef.current !== sessionPromise) return;
            const wasReady = isSessionReadyRef.current;
            console.debug(`[DebateCoach] Session closed natively at ${new Date().toISOString()}`, {
              code: event.code,
              reason: event.reason,
              wasClean: event.wasClean,
              wasReady,
            });
            if (!wasReady && event.code !== 1000) {
              const closeReason = event.reason?.trim();
              setError(closeReason ? `Session closed before setup: ${closeReason}` : `Session closed before setup (code ${event.code})`);
            }
            isSocketOpenRef.current = false;
            isSessionReadyRef.current = false;
            disconnect({ skipSessionClose: true });
          },
          onerror: (err: any) => {
            if (sessionRef.current !== sessionPromise) return;
            console.error("Live API Error:", err);
            setError(err.message || "An error occurred");
            isSocketOpenRef.current = false;
            isSessionReadyRef.current = false;
            disconnect({ skipSessionClose: true });
          }
        }
      });

      sessionRef.current = sessionPromise;

    } catch (err: any) {
      console.error(err);
      setError(err.message);
      disconnect({ skipSessionClose: true });
    }
  }, [mode, onIndicatorsUpdate, onMediaStream, onTranscriptSegment, disconnect, clearSpeakingTimers, setSpeakingState, resetDerivedIndicatorsState, resetLocalVisualState, withOpenSession, handleServerMessage]);

  return { isConnected, isConnecting, error, connect, disconnect, analyserRef, playbackAnalyserRef, isSpeaking };
}
