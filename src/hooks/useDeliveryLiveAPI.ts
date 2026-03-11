import { useCallback, useRef, useState } from 'react';
import {
  ActivityHandling,
  Behavior,
  FunctionResponseScheduling,
  GoogleGenAI,
  LiveServerMessage,
  Modality,
  TurnCoverage,
  Type,
} from '@google/genai';
import {
  FaceLandmarker,
  FaceLandmarkerResult,
  FilesetResolver,
  NormalizedLandmark,
  PoseLandmarker,
  PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';
import type { DeliveryAgentUpdate, SlideAnalysisToolPayload } from '../types';

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

const tokenizeWords = (text: string) => text.match(WORD_PATTERN)?.map((word) => word.toLowerCase()) ?? [];

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
  for (const value of voter.window) {
    counts[value] = (counts[value] ?? 0) + 1;
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
  done: false,
  samples: [],
  baseline: 0,
  mad: 0,
});

const median = (arr: number[]) => {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const finalizeCalibration = (state: CalibrationState) => {
  state.baseline = median(state.samples);
  const deviations = state.samples.map((value) => Math.abs(value - state.baseline));
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

  const score = Math.max(headDrop, shoulderTilt, lateralOffset);

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

function getDeliveryBaseInstruction(mode: 'rehearsal' | 'presentation'): string {
  if (mode === 'rehearsal') {
    return 'You are DebateCoach, an AI rehearsal coach. The user is practicing a structured presentation. You receive live audio and video. Track delivery quality, risky transitions, filler words, volume, confidence, eye contact, and posture. In rehearsal mode you may interrupt briefly with spoken coaching when needed. Always use updateIndicators to keep the UI current, and use saveSlideAnalysis whenever you identify per-slide issues or strong recovery phrases.';
  }

  return 'You are DebateCoach, a silent live presentation coach focused on delivery. The user is presenting for real. You receive live audio and video. DO NOT SPEAK. Only use updateIndicators to send concise delivery cues, agentMode, and rescue text when absolutely necessary. You may receive trusted [AudienceAgent] messages with audience engagement observations, but your own output should stay focused on delivery.';
}

export function useDeliveryLiveAPI({
  mode,
  contextText,
  onUpdate,
  onSlideAnalysis,
}: {
  mode: 'rehearsal' | 'presentation';
  contextText?: string;
  onUpdate?: (data: DeliveryAgentUpdate) => void;
  onSlideAnalysis?: (payload: SlideAnalysisToolPayload) => void;
}) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isSpeakingRef = useRef(false);

  const sessionRef = useRef<Promise<any> | null>(null);
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
  const pendingContextNotesRef = useRef<string[]>([]);

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
    speechStartTimeoutsRef.current.forEach((id) => clearTimeout(id));
    speechStartTimeoutsRef.current = [];
    if (speechStopTimeoutRef.current !== null) {
      clearTimeout(speechStopTimeoutRef.current);
      speechStopTimeoutRef.current = null;
    }
  }, []);

  const disconnect = useCallback((options?: { skipSessionClose?: boolean }) => {
    const shouldCloseSession = !options?.skipSessionClose;
    const currentSessionPromise = sessionRef.current;
    sessionRef.current = null;
    isSocketOpenRef.current = false;
    isSessionReadyRef.current = false;
    pendingContextNotesRef.current = [];
    clearSpeakingTimers();

    if (shouldCloseSession && currentSessionPromise) {
      currentSessionPromise.then((session) => {
        try {
          session.close();
        } catch {
          // ignore
        }
      });
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    playbackAnalyserRef.current = null;
    if (playbackContextRef.current) {
      playbackContextRef.current.close().catch(() => {});
      playbackContextRef.current = null;
    }
    sourceNodesRef.current.forEach((node) => {
      try {
        node.stop();
      } catch {
        // ignore
      }
    });
    sourceNodesRef.current = [];
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
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

  const pushContextNote = useCallback((note: string) => {
    const trimmed = note.trim();
    if (!trimmed) return;
    const currentSession = sessionRef.current;
    if (!currentSession || !isSocketOpenRef.current || !isSessionReadyRef.current) {
      pendingContextNotesRef.current.push(trimmed);
      return;
    }

    currentSession.then((session) => {
      if (sessionRef.current !== currentSession || !isSocketOpenRef.current || !isSessionReadyRef.current) return;
      try {
        session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: trimmed }] }],
          turnComplete: true,
        });
      } catch {
        pendingContextNotesRef.current.push(trimmed);
      }
    });
  }, []);

  const connect = useCallback(async (videoElement: HTMLVideoElement): Promise<boolean> => {
    setIsConnecting(true);
    setError(null);
    clearSpeakingTimers();
    setSpeakingState(false);
    resetDerivedIndicatorsState();
    resetLocalVisualState();

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('API Key is missing');
      const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch (err: any) {
        console.warn('Failed to get audio+video stream, trying audio only', err);
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (audioErr: any) {
          if (audioErr.name === 'NotAllowedError' || audioErr.message === 'Permission denied') {
            throw new Error('Camera/Microphone access denied. Please allow permissions in your browser or system settings.');
          }
          throw new Error(`Media access error: ${audioErr.message}`);
        }
      }

      streamRef.current = stream;
      if (stream.getVideoTracks().length > 0) {
        videoElement.srcObject = stream;
      }

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      analyserRef.current = analyser;

      const workletCode = `
        class PCMProcessor extends AudioWorkletProcessor {
          process(inputs) {
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

      let playbackContext: AudioContext | null = null;
      if (mode === 'rehearsal') {
        playbackContext = new AudioContext({ sampleRate: 24000 });
        playbackContextRef.current = playbackContext;
        nextPlayTimeRef.current = playbackContext.currentTime;

        const playbackAnalyser = playbackContext.createAnalyser();
        playbackAnalyser.fftSize = 64;
        playbackAnalyser.smoothingTimeConstant = 0.5;
        playbackAnalyser.connect(playbackContext.destination);
        playbackAnalyserRef.current = playbackAnalyser;
      }

      const MAX_CONTEXT_CHARS = 12000;
      const trimmedContext = contextText && contextText.length > MAX_CONTEXT_CHARS
        ? `${contextText.slice(0, MAX_CONTEXT_CHARS)}\n\n(Context truncated for session stability.)`
        : contextText;
      const systemInstruction = trimmedContext
        ? `${getDeliveryBaseInstruction(mode)}\n\nUse the following project and strategy context while coaching:\n${trimmedContext}`
        : getDeliveryBaseInstruction(mode);

      const isSessionTransportOpen = (session: any) => {
        const readyState = session?.conn?.ws?.readyState;
        if (typeof readyState === 'number') {
          return readyState === 1;
        }
        return isSocketOpenRef.current;
      };

      let sessionPromise: Promise<any>;
      const withOpenSession = (handler: (session: any) => void) => {
        sessionPromise.then((session) => {
          if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;
          if (!isSessionReadyRef.current) return;
          if (!isSessionTransportOpen(session)) return;
          handler(session);
        });
      };

      const flushPendingNotes = () => {
        if (pendingContextNotesRef.current.length === 0) return;
        const notes = [...pendingContextNotesRef.current];
        pendingContextNotesRef.current = [];
        for (const note of notes) {
          pushContextNote(note);
        }
      };

      const ingestInputTranscript = (rawText: string) => {
        const normalized = rawText.trim().toLowerCase();
        if (!normalized) return;

        const now = Date.now();
        let delta = normalized;
        const previousChunk = lastTranscriptChunkRef.current;

        if (previousChunk) {
          if (normalized === previousChunk) {
            lastSpeechTimestampRef.current = now;
            return;
          }
          if (normalized.startsWith(previousChunk)) {
            delta = normalized.slice(previousChunk.length);
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

      const startLocalVisualAnalysis = async () => {
        if (!onUpdate) return;
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
            console.warn('[DeliveryAgent] FaceLandmarker init failed', err);
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
            console.warn('[DeliveryAgent] PoseLandmarker init failed', err);
            return null;
          });

          if (!faceLandmarker && !poseLandmarker) {
            console.warn('[DeliveryAgent] Local visual analysis disabled: no landmarker initialized');
            return;
          }

          if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) {
            faceLandmarker?.close();
            poseLandmarker?.close();
            return;
          }

          faceLandmarkerRef.current = faceLandmarker;
          poseLandmarkerRef.current = poseLandmarker;
          localVisualActiveRef.current = true;

          const analysisCanvas = document.createElement('canvas');
          const analysisCtx = analysisCanvas.getContext('2d');

          localVisualIntervalRef.current = window.setInterval(() => {
            if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;
            if (videoElement.readyState < 2 || !analysisCtx) return;

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

            if (faceModel) {
              missingFaceTicksRef.current = eyeResult ? 0 : missingFaceTicksRef.current + 1;
            }
            if (poseModel) {
              missingPoseTicksRef.current = postureResult ? 0 : missingPoseTicksRef.current + 1;
            }

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
              const calibratingSignature = 'Calibrating...|Calibrating...';
              if (calibratingSignature !== lastLocalVisualSignatureRef.current) {
                lastLocalVisualSignatureRef.current = calibratingSignature;
                onUpdate({ eyeContact: 'Calibrating...', posture: 'Calibrating...' });
              }
              return;
            }

            let eyeLevel: string;
            if (!eyeResult) {
              eyeLevel = missingFaceTicksRef.current > LOCAL_VISUAL_LOSS_TICKS ? 'Face not visible' : eyeStatusRef.current.current;
            } else {
              const faceRatioDev = Math.abs(eyeResult.faceRatio - eyeCal.baseline) / eyeCal.mad;
              if (eyeResult.level === 'Looking away' || faceRatioDev > 5) eyeLevel = 'Looking away';
              else if (eyeResult.level === 'Glancing away' || faceRatioDev > 3) eyeLevel = 'Glancing away';
              else eyeLevel = 'Looking at camera';
            }

            let postureLevel: string;
            if (!postureResult) {
              postureLevel = missingPoseTicksRef.current > LOCAL_VISUAL_LOSS_TICKS ? 'Posture not visible' : postureStatusRef.current.current;
            } else {
              const scoreDev = Math.abs(postureResult.score - postureCal.baseline) / postureCal.mad;
              if (scoreDev > 5) postureLevel = 'Slouching';
              else if (scoreDev > 3) postureLevel = 'Watch posture';
              else postureLevel = 'Upright';
            }

            const eyeChanged = Boolean(faceModel) && advanceMajorityVote(eyeStatusRef.current, eyeLevel);
            const postureChanged = Boolean(poseModel) && advanceMajorityVote(postureStatusRef.current, postureLevel);
            if (!eyeChanged && !postureChanged) return;

            const update: DeliveryAgentUpdate = {};
            if (eyeChanged) update.eyeContact = eyeStatusRef.current.current;
            if (postureChanged) update.posture = postureStatusRef.current.current;

            const signature = `${update.eyeContact ?? ''}|${update.posture ?? ''}`;
            if (signature === lastLocalVisualSignatureRef.current) return;
            lastLocalVisualSignatureRef.current = signature;
            onUpdate(update);
          }, LOCAL_VISUAL_TICK_MS);
        } catch (err) {
          console.warn('[DeliveryAgent] Local visual analysis unavailable', err);
        }
      };

      sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-latest',
        config: {
          // Native-audio Live models require AUDIO setup, even when the UI should stay silent.
          // Presentation mode never plays model audio because playback is only wired in rehearsal.
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          ...(mode === 'rehearsal' ? { outputAudioTranscription: {} } : {}),
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
          proactivity: { proactiveAudio: mode === 'rehearsal' },
          enableAffectiveDialog: true,
          ...(mode === 'rehearsal'
            ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } } }
            : {}),
          systemInstruction,
          tools: [{
            functionDeclarations: [{
              name: 'updateIndicators',
              description: 'Update the delivery indicators on the user screen based on speech, confidence, and speaking performance.',
              behavior: Behavior.NON_BLOCKING,
              parameters: {
                type: Type.OBJECT,
                properties: {
                  pace: { type: Type.STRING, description: 'Current speaking pace.' },
                  eyeContact: { type: Type.STRING, description: 'Eye contact status.' },
                  posture: { type: Type.STRING, description: 'Posture status.' },
                  fillerWords: {
                    type: Type.OBJECT,
                    properties: {
                      total: { type: Type.INTEGER },
                      breakdown: { type: Type.OBJECT },
                    },
                  },
                  feedbackMessage: { type: Type.STRING, description: 'A short delivery feedback message.' },
                  confidenceScore: { type: Type.INTEGER, description: '1-100 confidence scale.' },
                  volumeLevel: { type: Type.STRING, description: 'Volume level.' },
                  overallScore: { type: Type.INTEGER, description: '1-100 overall performance score.' },
                  currentSlide: { type: Type.INTEGER, description: 'Fallback slide estimate when no screen agent is active.' },
                  microPrompt: { type: Type.STRING, description: 'A concise delivery cue for the HUD.' },
                  rescueText: { type: Type.STRING, description: 'Short rescue text when the speaker is stuck.' },
                  agentMode: {
                    type: Type.STRING,
                    enum: ['monitor', 'soft_cue', 'directive', 'rescue'],
                  },
                  slideTimeRemaining: { type: Type.INTEGER, description: 'Fallback slide time estimate when no screen agent is active.' },
                },
              },
            }, {
              name: 'saveSlideAnalysis',
              description: 'Persist a slide-level coaching insight discovered during the live session.',
              behavior: Behavior.NON_BLOCKING,
              parameters: {
                type: Type.OBJECT,
                properties: {
                  slideNumber: { type: Type.INTEGER },
                  issues: { type: Type.ARRAY, items: { type: Type.STRING } },
                  bestPhrase: { type: Type.STRING },
                  riskLevel: { type: Type.STRING, enum: ['safe', 'watch', 'fragile'] },
                },
                required: ['slideNumber', 'issues', 'riskLevel'],
              },
            }],
          }],
        },
        callbacks: {
          onopen: () => {
            if (sessionRef.current !== sessionPromise) return;
            isSocketOpenRef.current = true;
            isSessionReadyRef.current = false;
            setIsConnected(true);
            setIsConnecting(false);
            if (onUpdate) {
              onUpdate({
                eyeContact: eyeStatusRef.current.current,
                posture: postureStatusRef.current.current,
              });
            }

            workletNode.port.onmessage = (event) => {
              if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;
              const pcm16 = new Int16Array(event.data);
              const bytes = new Uint8Array(pcm16.buffer);
              let binaryString = '';
              for (let i = 0; i < bytes.length; i++) {
                binaryString += String.fromCharCode(bytes[i]);
              }
              const base64Data = btoa(binaryString);
              withOpenSession((session) => {
                try {
                  session.sendRealtimeInput({ media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' } });
                } catch {
                  // ignore
                }
              });
            };

            if (stream.getVideoTracks().length > 0) {
              videoIntervalRef.current = window.setInterval(() => {
                const canvas = document.createElement('canvas');
                canvas.width = videoElement.videoWidth || 640;
                canvas.height = videoElement.videoHeight || 480;
                const ctx = canvas.getContext('2d');
                if (ctx && videoElement.readyState >= 2) {
                  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                  const base64Image = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
                  withOpenSession((session) => {
                    try {
                      session.sendRealtimeInput({ media: { data: base64Image, mimeType: 'image/jpeg' } });
                    } catch {
                      // ignore
                    }
                  });
                }
              }, 1000);
            }

            if (onUpdate) {
              indicatorIntervalRef.current = window.setInterval(() => {
                if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;

                const now = Date.now();
                const cutoff = now - TRANSCRIPT_PACE_WINDOW_MS;
                recentWordTimestampsRef.current = recentWordTimestampsRef.current.filter((timestamp) => timestamp >= cutoff);

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
                  const currentAnalyser = analyserRef.current;
                  const neededLength = currentAnalyser.fftSize;
                  if (!volumeTimeDomainRef.current || volumeTimeDomainRef.current.length !== neededLength) {
                    volumeTimeDomainRef.current = new Uint8Array(neededLength);
                  }

                  const volumeData = volumeTimeDomainRef.current;
                  currentAnalyser.getByteTimeDomainData(volumeData);
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

                const update: DeliveryAgentUpdate = {
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
                onUpdate(update);
              }, DERIVED_INDICATOR_TICK_MS);
            }

            void startLocalVisualAnalysis();
          },
          onmessage: async (message: LiveServerMessage) => {
            if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;

            if (message.setupComplete) {
              isSessionReadyRef.current = true;
              flushPendingNotes();
            }

            const serverContent = message.serverContent as any;
            if (serverContent?.inputTranscription?.text) {
              ingestInputTranscript(serverContent.inputTranscription.text);
            }

            if (message.serverContent?.modelTurn && mode === 'rehearsal' && playbackContext) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (!part.inlineData?.data) continue;
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
                if (playbackAnalyserRef.current) sourceNode.connect(playbackAnalyserRef.current);
                else sourceNode.connect(playbackContext.destination);

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
                    speechStartTimeoutsRef.current = speechStartTimeoutsRef.current.filter((id) => id !== timeoutId);
                    if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;
                    setSpeakingState(true);
                  }, startDelayMs);
                  speechStartTimeoutsRef.current.push(timeoutId);
                }

                sourceNode.onended = () => {
                  sourceNodesRef.current = sourceNodesRef.current.filter((node) => node !== sourceNode);
                  if (sourceNodesRef.current.length === 0) {
                    if (speechStopTimeoutRef.current !== null) {
                      clearTimeout(speechStopTimeoutRef.current);
                    }
                    speechStopTimeoutRef.current = window.setTimeout(() => {
                      speechStopTimeoutRef.current = null;
                      if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;
                      setSpeakingState(false);
                    }, 90);
                  }
                };
              }
            }

            if (message.serverContent?.interrupted) {
              clearSpeakingTimers();
              sourceNodesRef.current.forEach((node) => {
                try {
                  node.stop();
                } catch {
                  // ignore
                }
              });
              sourceNodesRef.current = [];
              setSpeakingState(false);
              if (playbackContext) {
                nextPlayTimeRef.current = playbackContext.currentTime;
              }
            }

            if (message.toolCall) {
              for (const call of message.toolCall.functionCalls) {
                if (call.name === 'updateIndicators' && onUpdate && call.args && typeof call.args === 'object') {
                  const args = call.args as Record<string, unknown>;
                  const update: DeliveryAgentUpdate = {
                    pace: typeof args.pace === 'string' ? args.pace : undefined,
                    eyeContact: typeof args.eyeContact === 'string' ? args.eyeContact : undefined,
                    posture: typeof args.posture === 'string' ? args.posture : undefined,
                    fillerWords: typeof args.fillerWords === 'object' && args.fillerWords
                      ? {
                        total: typeof (args.fillerWords as Record<string, unknown>).total === 'number'
                          ? (args.fillerWords as Record<string, number>).total
                          : undefined,
                        breakdown: typeof (args.fillerWords as Record<string, unknown>).breakdown === 'object'
                          ? (args.fillerWords as Record<string, Record<string, number>>).breakdown
                          : undefined,
                      }
                      : undefined,
                    feedbackMessage: typeof args.feedbackMessage === 'string' ? args.feedbackMessage : undefined,
                    confidenceScore: typeof args.confidenceScore === 'number' ? args.confidenceScore : undefined,
                    volumeLevel: typeof args.volumeLevel === 'string' ? args.volumeLevel : undefined,
                    overallScore: typeof args.overallScore === 'number' ? args.overallScore : undefined,
                    fallbackCurrentSlide: typeof args.currentSlide === 'number' ? args.currentSlide : undefined,
                    microPrompt: typeof args.microPrompt === 'string' ? args.microPrompt : undefined,
                    rescueText: typeof args.rescueText === 'string' ? args.rescueText : undefined,
                    agentMode: typeof args.agentMode === 'string' ? args.agentMode as DeliveryAgentUpdate['agentMode'] : undefined,
                    fallbackSlideTimeRemaining: typeof args.slideTimeRemaining === 'number' ? args.slideTimeRemaining : undefined,
                  };
                  if (localVisualActiveRef.current) {
                    delete update.eyeContact;
                    delete update.posture;
                  }
                  onUpdate(update);
                }

                if (call.name === 'saveSlideAnalysis' && onSlideAnalysis && call.args && typeof call.args === 'object') {
                  const payload = call.args as unknown as SlideAnalysisToolPayload;
                  if (typeof payload.slideNumber === 'number' && Array.isArray(payload.issues) && typeof payload.riskLevel === 'string') {
                    onSlideAnalysis({
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
                        response: { result: 'ok' },
                        scheduling: FunctionResponseScheduling.SILENT,
                      }],
                    });
                  } catch {
                    // ignore
                  }
                });
              }
            }
          },
          onclose: (event: CloseEvent) => {
            if (sessionRef.current !== sessionPromise) return;
            if (!isSessionReadyRef.current && event.code !== 1000) {
              const reason = event.reason?.trim();
              setError(reason ? `Session closed before setup: ${reason}` : `Session closed before setup (code ${event.code})`);
            }
            isSocketOpenRef.current = false;
            isSessionReadyRef.current = false;
            disconnect({ skipSessionClose: true });
          },
          onerror: (err: any) => {
            if (sessionRef.current !== sessionPromise) return;
            console.error('Delivery Live API Error:', err);
            setError(err.message || 'An error occurred');
            isSocketOpenRef.current = false;
            isSessionReadyRef.current = false;
            disconnect({ skipSessionClose: true });
          },
        },
      });

      sessionRef.current = sessionPromise;
      return true;
    } catch (err: any) {
      console.error(err);
      setError(err.message);
      disconnect({ skipSessionClose: true });
      return false;
    }
  }, [
    clearSpeakingTimers,
    contextText,
    disconnect,
    mode,
    onSlideAnalysis,
    onUpdate,
    pushContextNote,
    resetDerivedIndicatorsState,
    resetLocalVisualState,
    setSpeakingState,
  ]);

  return {
    isConnected,
    isConnecting,
    error,
    connect,
    disconnect,
    analyserRef,
    playbackAnalyserRef,
    isSpeaking,
    pushContextNote,
  };
}
