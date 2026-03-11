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
import type { ScreenAgentUpdate } from '../types';

const SCREEN_FRAME_INTERVAL_MS = 1200;
const SCREEN_LIVE_MODEL = 'gemini-2.5-flash-native-audio-latest';

function getScreenBaseInstruction(mode: 'rehearsal' | 'presentation'): string {
  return [
    'You are ScreenAgent, a specialist that watches the shared presentation screen.',
    `The session mode is ${mode}.`,
    'Your only valid outward action is updateScreenState.',
    'Do not narrate, chat, coach, or provide direct user-facing responses.',
    'Use updateScreenState for every meaningful change: slide change, timing risk, wrong window, capture issue, or when a concise navigation hint is useful.',
    'Keep screenPrompt short. Put richer context in screenDetails.',
    'If you are uncertain about the current slide, leave currentSlide empty.',
  ].join(' ');
}

export function useScreenLiveAPI({
  mode,
  contextText,
  onUpdate,
}: {
  mode: 'rehearsal' | 'presentation';
  contextText?: string;
  onUpdate?: (data: ScreenAgentUpdate) => void;
}) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<Promise<any> | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const isSocketOpenRef = useRef(false);
  const isSessionReadyRef = useRef(false);
  const suppressTrackEndedRef = useRef(false);
  const trackEndedHandlersRef = useRef(new Map<MediaStreamTrack, () => void>());

  const disconnect = useCallback((options?: { skipSessionClose?: boolean; preserveLostState?: boolean }) => {
    const shouldCloseSession = !options?.skipSessionClose;
    const currentSessionPromise = sessionRef.current;
    sessionRef.current = null;
    isSocketOpenRef.current = false;
    isSessionReadyRef.current = false;
    suppressTrackEndedRef.current = true;

    if (shouldCloseSession && currentSessionPromise) {
      currentSessionPromise.then((session) => {
        try {
          session.close();
        } catch {
          // ignore
        }
      });
    }
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        const handler = trackEndedHandlersRef.current.get(track);
        if (handler) {
          track.removeEventListener('ended', handler);
          trackEndedHandlersRef.current.delete(track);
        }
        track.stop();
      });
      screenStreamRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    suppressTrackEndedRef.current = false;
    if (!options?.preserveLostState) {
      onUpdate?.({
        captureStatus: 'inactive',
        currentSlide: null,
        slideTimeRemaining: null,
        screenPrompt: '',
        screenDetails: '',
        sourceLabel: '',
      });
    }
  }, [onUpdate]);

  const connect = useCallback(async ({
    screenStream,
    audioStream,
  }: {
    screenStream: MediaStream;
    audioStream?: MediaStream | null;
  }): Promise<boolean> => {
    setIsConnecting(true);
    setError(null);
    suppressTrackEndedRef.current = false;
    onUpdate?.({
      captureStatus: 'requesting',
      screenPrompt: '',
      screenDetails: '',
      sourceLabel: screenStream.getVideoTracks()[0]?.label ?? '',
    });

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('API Key is missing');
      const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });

      const sourceLabel = screenStream.getVideoTracks()[0]?.label ?? '';
      screenStreamRef.current = screenStream;
      audioStreamRef.current = audioStream ?? null;
      const videoElement = document.createElement('video');
      videoElement.autoplay = true;
      videoElement.muted = true;
      videoElement.playsInline = true;
      videoElement.srcObject = screenStream;
      videoRef.current = videoElement;
      await videoElement.play().catch(() => {});

      let audioWorkletNode: AudioWorkletNode | null = null;
      if (audioStream && audioStream.getAudioTracks().length > 0) {
        const audioContext = new AudioContext({ sampleRate: 16000 });
        audioContextRef.current = audioContext;
        const source = audioContext.createMediaStreamSource(audioStream);
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
          registerProcessor('screen-pcm-processor', PCMProcessor);
        `;
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        try {
          await audioContext.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        audioWorkletNode = new AudioWorkletNode(audioContext, 'screen-pcm-processor');
        source.connect(audioWorkletNode);
      }

      const MAX_CONTEXT_CHARS = 12000;
      const trimmedContext = contextText && contextText.length > MAX_CONTEXT_CHARS
        ? `${contextText.slice(0, MAX_CONTEXT_CHARS)}\n\n(Context truncated for session stability.)`
        : contextText;
      const systemInstruction = trimmedContext
        ? `${getScreenBaseInstruction(mode)}\n\nUse the following project and strategy context while reasoning about the screen:\n${trimmedContext}`
        : getScreenBaseInstruction(mode);

      let sessionPromise: Promise<any>;
      const withOpenSession = (handler: (session: any) => void) => {
        sessionPromise.then((session) => {
          if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current || !isSessionReadyRef.current) return;
          handler(session);
        });
      };

      const handleTrackEnded = () => {
        onUpdate?.({
          captureStatus: 'lost',
          screenPriority: 'critical',
          screenPrompt: 'Screen lost',
          screenDetails: 'Screen capture stopped. Delivery coaching continues.',
          sourceLabel,
        });
        disconnect({ preserveLostState: true });
      };

      screenStream.getVideoTracks().forEach((track) => {
        const wrapped = () => {
          trackEndedHandlersRef.current.delete(track);
          if (suppressTrackEndedRef.current) return;
          handleTrackEnded();
        };
        trackEndedHandlersRef.current.set(track, wrapped);
        track.addEventListener('ended', wrapped, { once: true });
      });

      sessionPromise = ai.live.connect({
        model: SCREEN_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          realtimeInputConfig: {
            activityHandling: ActivityHandling.NO_INTERRUPTION,
            turnCoverage: TurnCoverage.TURN_INCLUDES_ONLY_ACTIVITY,
            automaticActivityDetection: {
              disabled: false,
              silenceDurationMs: 400,
              prefixPaddingMs: 20,
            },
          },
          systemInstruction,
          tools: [{
            functionDeclarations: [{
              name: 'updateScreenState',
              description: 'Update the screen/navigation lane for the shared screen.',
              behavior: Behavior.NON_BLOCKING,
              parameters: {
                type: Type.OBJECT,
                properties: {
                  captureStatus: {
                    type: Type.STRING,
                    enum: ['inactive', 'requesting', 'active', 'lost', 'denied', 'unsupported'],
                    description: 'Health of the current screen capture.',
                  },
                  currentSlide: { type: Type.INTEGER, description: 'Current slide number when confident.' },
                  slideTimeRemaining: { type: Type.INTEGER, description: 'Estimated seconds remaining on the current slide.' },
                  screenPrompt: { type: Type.STRING, description: 'Short navigation or screen cue.' },
                  screenDetails: { type: Type.STRING, description: 'Longer detail for the screen lane.' },
                  screenPriority: {
                    type: Type.STRING,
                    enum: ['info', 'watch', 'critical'],
                    description: 'Urgency of the screen cue.',
                  },
                  sourceLabel: { type: Type.STRING, description: 'Friendly description of the captured surface.' },
                },
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
            onUpdate?.({
              captureStatus: 'active',
              screenPriority: 'info',
              sourceLabel,
            });

            if (audioWorkletNode) {
              audioWorkletNode.port.onmessage = (event) => {
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
            }

            frameIntervalRef.current = window.setInterval(() => {
              if (!videoRef.current || videoRef.current.readyState < 2) return;
              const canvas = document.createElement('canvas');
              canvas.width = videoRef.current.videoWidth || 1280;
              canvas.height = videoRef.current.videoHeight || 720;
              const ctx = canvas.getContext('2d');
              if (!ctx) return;
              ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
              const base64Image = canvas.toDataURL('image/jpeg', 0.55).split(',')[1];
              withOpenSession((session) => {
                try {
                  session.sendRealtimeInput({ media: { data: base64Image, mimeType: 'image/jpeg' } });
                } catch {
                  // ignore
                }
              });
            }, SCREEN_FRAME_INTERVAL_MS);
          },
          onmessage: (message: LiveServerMessage) => {
            if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;

            if (message.setupComplete) {
              isSessionReadyRef.current = true;
            }

            if (message.serverContent?.modelTurn) {
              // ScreenAgent is tool-only for the app; ignore any generated content payloads.
            }

            if (message.toolCall) {
              for (const call of message.toolCall.functionCalls) {
                if (call.name === 'updateScreenState' && onUpdate && call.args && typeof call.args === 'object') {
                  const args = call.args as Record<string, unknown>;
                  onUpdate({
                    captureStatus: typeof args.captureStatus === 'string' ? args.captureStatus as ScreenAgentUpdate['captureStatus'] : undefined,
                    currentSlide: typeof args.currentSlide === 'number' ? args.currentSlide : undefined,
                    slideTimeRemaining: typeof args.slideTimeRemaining === 'number' ? args.slideTimeRemaining : undefined,
                    screenPrompt: typeof args.screenPrompt === 'string' ? args.screenPrompt : undefined,
                    screenDetails: typeof args.screenDetails === 'string' ? args.screenDetails : undefined,
                    screenPriority: typeof args.screenPriority === 'string' ? args.screenPriority as ScreenAgentUpdate['screenPriority'] : undefined,
                    sourceLabel: typeof args.sourceLabel === 'string' ? args.sourceLabel : sourceLabel,
                  });
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
              setError(reason ? `Screen session closed before setup: ${reason}` : `Screen session closed before setup (code ${event.code})`);
            }
            isSocketOpenRef.current = false;
            isSessionReadyRef.current = false;
            disconnect({ skipSessionClose: true });
          },
          onerror: (err: any) => {
            if (sessionRef.current !== sessionPromise) return;
            console.error('Screen Live API Error:', err);
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
  }, [contextText, disconnect, mode, onUpdate]);

  return {
    isConnected,
    isConnecting,
    error,
    connect,
    disconnect,
  };
}
