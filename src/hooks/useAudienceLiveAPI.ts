import { useCallback, useRef, useState } from 'react';
import {
  ActivityHandling,
  Behavior,
  FunctionResponseScheduling,
  LiveServerMessage,
  Modality,
  TurnCoverage,
  Type,
} from '@google/genai';
import type { AudienceAgentUpdate } from '../types';
import { createBrowserLiveClient } from '../lib/liveClient';

const AUDIENCE_FRAME_INTERVAL_MS = 1200;
const AUDIENCE_LIVE_MODEL = 'gemini-2.5-flash-native-audio-latest';

function getAudienceBaseInstruction(mode: 'rehearsal' | 'presentation'): string {
  return [
    'You are AudienceAgent, a specialist that watches the video call gallery view showing audience participants.',
    `The session mode is ${mode}.`,
    'Your only valid outward action is updateAudienceState.',
    'Do not narrate, chat, coach, or provide direct user-facing responses.',
    'If the transport requires an audio response channel, treat it as an implementation detail and still communicate only through updateAudienceState.',
    'Watch for: engagement (are participants attentive, looking at camera, or distracted/multitasking), reactions (confused expressions, nodding, boredom, excitement, laughter), hands raised (Zoom/Meet hand-raise icons or physical hand raises).',
    'Call updateAudienceState FREQUENTLY — every time you receive a new frame, call the tool with your current assessment. The indicator fields (engagement, reactions, handsRaised, priority) feed a live dashboard and must stay fresh. Do not wait for big changes — even confirming the same state is valuable.',
    '',
    'IMPORTANT — two categories of fields:',
    '1. INDICATOR fields (update on EVERY call): engagement, reactions, handsRaised, priority. Always set these.',
    '2. SUBTITLE fields (audiencePrompt, audienceDetails): these create on-screen subtitles that overlay the speaker\'s view. Set audiencePrompt="" and audienceDetails="" on most calls. Only set them when something truly critical persists for several minutes (hands raised for a long time, engagement collapsed to "low" and stayed there). Think of subtitles as an emergency alarm.',
    '',
    'Set priority to "critical" when hands are raised or engagement drops sharply. Use "watch" for gradual declines. Use "info" for routine observations.',
  ].join(' ');
}

export function useAudienceLiveAPI({
  mode,
  contextText,
  onUpdate,
}: {
  mode: 'rehearsal' | 'presentation';
  contextText?: string;
  onUpdate?: (data: AudienceAgentUpdate) => void;
}) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<Promise<any> | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const nudgeIntervalRef = useRef<number | null>(null);
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
    if (nudgeIntervalRef.current) {
      clearInterval(nudgeIntervalRef.current);
      nudgeIntervalRef.current = null;
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
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((track) => {
        const handler = trackEndedHandlersRef.current.get(track);
        if (handler) {
          track.removeEventListener('ended', handler);
          trackEndedHandlersRef.current.delete(track);
        }
        track.stop();
      });
      displayStreamRef.current = null;
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
        audiencePrompt: '',
        audienceDetails: '',
        sourceLabel: '',
      });
    }
  }, [onUpdate]);

  const connect = useCallback(async ({
    displayStream,
    audioStream,
  }: {
    displayStream: MediaStream;
    audioStream?: MediaStream | null;
  }): Promise<boolean> => {
    setIsConnecting(true);
    setError(null);
    suppressTrackEndedRef.current = false;
    onUpdate?.({
      captureStatus: 'requesting',
      audiencePrompt: '',
      audienceDetails: '',
      sourceLabel: displayStream.getVideoTracks()[0]?.label ?? '',
    });

    try {
      const ai = await createBrowserLiveClient('audience');

      const sourceLabel = displayStream.getVideoTracks()[0]?.label ?? '';
      displayStreamRef.current = displayStream;
      audioStreamRef.current = audioStream ?? null;
      const videoElement = document.createElement('video');
      videoElement.autoplay = true;
      videoElement.muted = true;
      videoElement.playsInline = true;
      videoElement.srcObject = displayStream;
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
          registerProcessor('audience-pcm-processor', PCMProcessor);
        `;
        const blob = new Blob([workletCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        try {
          await audioContext.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        audioWorkletNode = new AudioWorkletNode(audioContext, 'audience-pcm-processor');
        source.connect(audioWorkletNode);
      }

      const MAX_CONTEXT_CHARS = 12000;
      const trimmedContext = contextText && contextText.length > MAX_CONTEXT_CHARS
        ? `${contextText.slice(0, MAX_CONTEXT_CHARS)}\n\n(Context truncated for session stability.)`
        : contextText;
      const systemInstruction = trimmedContext
        ? `${getAudienceBaseInstruction(mode)}\n\nUse the following project context while reasoning about the audience:\n${trimmedContext}`
        : getAudienceBaseInstruction(mode);

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
          priority: 'critical',
          audiencePrompt: 'Audience view lost',
          audienceDetails: 'Gallery capture stopped. Delivery coaching continues.',
          sourceLabel,
        });
        disconnect({ preserveLostState: true });
      };

      displayStream.getVideoTracks().forEach((track) => {
        const wrapped = () => {
          trackEndedHandlersRef.current.delete(track);
          if (suppressTrackEndedRef.current) return;
          handleTrackEnded();
        };
        trackEndedHandlersRef.current.set(track, wrapped);
        track.addEventListener('ended', wrapped, { once: true });
      });

      sessionPromise = ai.live.connect({
        model: AUDIENCE_LIVE_MODEL,
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
              name: 'updateAudienceState',
              description: 'Update audience engagement observations from the video call gallery view.',
              behavior: Behavior.NON_BLOCKING,
              parameters: {
                type: Type.OBJECT,
                properties: {
                  captureStatus: {
                    type: Type.STRING,
                    enum: ['inactive', 'requesting', 'active', 'lost', 'denied', 'unsupported'],
                    description: 'Health of the current audience gallery capture.',
                  },
                  engagement: {
                    type: Type.STRING,
                    enum: ['high', 'moderate', 'low'],
                    description: 'Overall audience engagement level.',
                  },
                  reactions: {
                    type: Type.STRING,
                    description: 'Observed audience reactions: confused, nodding, bored, attentive, laughing.',
                  },
                  handsRaised: {
                    type: Type.INTEGER,
                    description: 'Number of participants with raised hands.',
                  },
                  audiencePrompt: {
                    type: Type.STRING,
                    description: 'Short actionable cue for the speaker.',
                  },
                  audienceDetails: {
                    type: Type.STRING,
                    description: 'Longer context about audience state.',
                  },
                  priority: {
                    type: Type.STRING,
                    enum: ['info', 'watch', 'critical'],
                    description: 'Urgency of the audience cue.',
                  },
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
              priority: 'info',
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
            }, AUDIENCE_FRAME_INTERVAL_MS);
          },
          onmessage: (message: LiveServerMessage) => {
            if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;

            if (message.setupComplete) {
              isSessionReadyRef.current = true;

              // Kick-start observation — without this the model may not proactively call the tool.
              withOpenSession((s) => {
                try {
                  s.sendClientContent({
                    turns: [{ role: 'user', parts: [{ text: 'Audience gallery view is now visible. Begin observing. Call updateAudienceState with your initial assessment of engagement, reactions, and hands raised.' }] }],
                    turnComplete: true,
                  });
                } catch { /* ignore */ }
              });

              // Periodic nudge every 15s to keep the model calling tools frequently.
              nudgeIntervalRef.current = window.setInterval(() => {
                withOpenSession((s) => {
                  try {
                    s.sendClientContent({
                      turns: [{ role: 'user', parts: [{ text: 'Call updateAudienceState now with your current assessment of engagement, reactions, and handsRaised. Always set these indicator fields.' }] }],
                      turnComplete: true,
                    });
                  } catch { /* ignore */ }
                });
              }, 15_000);
            }

            if (message.serverContent?.modelTurn) {
              // AudienceAgent is tool-only; ignore generated content payloads.
            }

            if (message.toolCall) {
              for (const call of message.toolCall.functionCalls) {
                if (call.name === 'updateAudienceState' && onUpdate && call.args && typeof call.args === 'object') {
                  const args = call.args as Record<string, unknown>;
                  onUpdate({
                    captureStatus: typeof args.captureStatus === 'string' ? args.captureStatus as AudienceAgentUpdate['captureStatus'] : undefined,
                    engagement: typeof args.engagement === 'string' ? args.engagement as AudienceAgentUpdate['engagement'] : undefined,
                    reactions: typeof args.reactions === 'string' ? args.reactions : undefined,
                    handsRaised: typeof args.handsRaised === 'number' ? args.handsRaised : undefined,
                    audiencePrompt: typeof args.audiencePrompt === 'string' ? args.audiencePrompt : undefined,
                    audienceDetails: typeof args.audienceDetails === 'string' ? args.audienceDetails : undefined,
                    priority: typeof args.priority === 'string' ? args.priority as AudienceAgentUpdate['priority'] : undefined,
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
              setError(reason ? `Audience session closed before setup: ${reason}` : `Audience session closed before setup (code ${event.code})`);
            }
            isSocketOpenRef.current = false;
            isSessionReadyRef.current = false;
            disconnect({ skipSessionClose: true });
          },
          onerror: (err: any) => {
            if (sessionRef.current !== sessionPromise) return;
            console.error('Audience Live API Error:', err);
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
