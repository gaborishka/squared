import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { IndicatorData } from '../types';

export function useLiveAPI({ mode, onIndicatorsUpdate }: { mode: 'rehearsal' | 'presentation', onIndicatorsUpdate?: (data: IndicatorData) => void }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    }
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    setSpeakingState(false);
  }, [clearSpeakingTimers, setSpeakingState]);

  const connect = useCallback(async (videoElement: HTMLVideoElement) => {
    setIsConnecting(true);
    setError(null);
    clearSpeakingTimers();
    setSpeakingState(false);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("API Key is missing");
      const ai = new GoogleGenAI({ apiKey });

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

      const systemInstruction = mode === 'rehearsal'
        ? "You are DebateCoach, an AI speech coaching agent. The user is practicing a speech. You will receive audio and video of the user. Analyze their delivery: tone, pace, filler words, volume, confidence, eye contact, posture. Interrupt the user with short, constructive voice feedback if they are speaking too fast, using too many filler words, looking away, or slouching. Keep feedback brief (1-2 sentences). If the user interrupts you, stop and listen. Also use the updateIndicators tool to update the UI."
        : "You are DebateCoach, a silent real-time coach. The user is giving a live presentation. You will receive audio and video. DO NOT SPEAK. Instead, use the updateIndicators tool frequently to provide real-time visual feedback on their pace, eye contact, posture, and filler words.";

      const isSessionTransportOpen = (session: any) => {
        const readyState = session?.conn?.ws?.readyState;
        // 1 === WebSocket.OPEN
        if (typeof readyState === 'number') {
          return readyState === 1;
        }
        return isSocketOpenRef.current;
      };

      let sessionPromise: Promise<any>;
      const withOpenSession = (handler: (session: any) => void) => {
        sessionPromise.then((session: any) => {
          if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;
          if (!isSessionReadyRef.current) return;
          if (!isSessionTransportOpen(session)) return;
          handler(session);
        });
      };

      sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-latest",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction,
          tools: [{
            functionDeclarations: [{
              name: "updateIndicators",
              description: "Update the visual indicators on the user's screen based on their current performance.",
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
                  overallScore: { type: Type.INTEGER, description: "1-100 overall performance score" }
                },
                required: ["pace", "eyeContact", "posture", "fillerWords", "feedbackMessage", "confidenceScore", "volumeLevel", "overallScore"]
              }
            }]
          }]
        },
        callbacks: {
          onopen: () => {
            console.debug(`[DebateCoach] Session opened at ${new Date().toISOString()} | mode: ${mode}`);
            isSocketOpenRef.current = true;
            isSessionReadyRef.current = false;
            setIsConnected(true);
            setIsConnecting(false);

            workletNode.port.onmessage = (e) => {
              if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;
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

            // Video frames — 1fps for faster eye contact / posture detection
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
                  console.debug(`[DebateCoach] Video frame #${frameCount} sent at ${new Date().toISOString()}`);
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
          },
          onmessage: async (message: LiveServerMessage) => {
            if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) {
              return;
            }

            if (message.setupComplete) {
              isSessionReadyRef.current = true;
              console.debug(`[DebateCoach] Session setup complete at ${new Date().toISOString()}`);
            }

            if (message.serverContent?.modelTurn) {
              const parts = message.serverContent.modelTurn.parts;
              for (const part of parts) {
                if (part.inlineData && part.inlineData.data && mode === 'rehearsal') {
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
                      if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;
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
                        if (sessionRef.current !== sessionPromise || !isSocketOpenRef.current) return;
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
              const call = message.toolCall.functionCalls.find(fc => fc.name === 'updateIndicators');
              if (call && onIndicatorsUpdate) {
                const receiveTime = performance.now();
                console.debug(`[DebateCoach] Tool call received at ${new Date().toISOString()}`, {
                  pace: call.args?.pace,
                  eyeContact: call.args?.eyeContact,
                  overallScore: call.args?.overallScore,
                  latencyNote: 'Check gap between video frame sends and this timestamp'
                });
                onIndicatorsUpdate(call.args as unknown as IndicatorData);
                // Send tool response
                withOpenSession((session) => {
                  try {
                    session.sendToolResponse({
                      functionResponses: [{
                        id: call.id,
                        name: call.name,
                        response: { result: "ok" }
                      }]
                    });
                  } catch (err) {
                    // Ignore send errors
                  }
                });
              }
            }
          },
          onclose: (event: CloseEvent) => {
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
      setIsConnecting(false);
    }
  }, [mode, onIndicatorsUpdate, disconnect, clearSpeakingTimers, setSpeakingState]);

  return { isConnected, isConnecting, error, connect, disconnect, analyserRef, playbackAnalyserRef, isSpeaking };
}
