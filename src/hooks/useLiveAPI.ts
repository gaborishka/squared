import { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';

export function useLiveAPI({ mode, onIndicatorsUpdate }: { mode: 'rehearsal' | 'presentation', onIndicatorsUpdate?: (data: any) => void }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const sourceNodesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);

  const connect = useCallback(async (videoElement: HTMLVideoElement) => {
    setIsConnecting(true);
    setError(null);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("API Key is missing");
      const ai = new GoogleGenAI({ apiKey });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      streamRef.current = stream;
      videoElement.srcObject = stream;

      // Setup Audio Capture
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      
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
      await audioContext.audioWorklet.addModule(url);
      const workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
      source.connect(workletNode);

      // Setup Audio Playback
      const playbackContext = new AudioContext({ sampleRate: 24000 });
      playbackContextRef.current = playbackContext;
      nextPlayTimeRef.current = playbackContext.currentTime;

      const systemInstruction = mode === 'rehearsal' 
        ? "You are DebateCoach, an AI speech coaching agent. The user is practicing a speech. You will receive audio and video of the user. Analyze their delivery: tone, pace, filler words, volume, confidence, eye contact, posture. Interrupt the user with short, constructive voice feedback if they are speaking too fast, using too many filler words, looking away, or slouching. Keep feedback brief (1-2 sentences). If the user interrupts you, stop and listen. Also use the updateIndicators tool to update the UI."
        : "You are DebateCoach, a silent real-time coach. The user is giving a live presentation. You will receive audio and video. DO NOT SPEAK. Instead, use the updateIndicators tool frequently to provide real-time visual feedback on their pace, eye contact, posture, and filler words.";

      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
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
                  fillerWordsCount: { type: Type.INTEGER, description: "Total count of filler words used so far" },
                  feedbackMessage: { type: Type.STRING, description: "A short feedback message to display to the user" }
                },
                required: ["pace", "eyeContact", "posture", "fillerWordsCount", "feedbackMessage"]
              }
            }]
          }]
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            
            workletNode.port.onmessage = (e) => {
              const pcm16 = new Int16Array(e.data);
              const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' } });
              });
            };

            // Video frames
            videoIntervalRef.current = window.setInterval(() => {
              const canvas = document.createElement('canvas');
              canvas.width = videoElement.videoWidth || 640;
              canvas.height = videoElement.videoHeight || 480;
              const ctx = canvas.getContext('2d');
              if (ctx && videoElement.readyState >= 2) {
                ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                const base64Image = canvas.toDataURL('image/jpeg', 0.5).split(',')[1];
                sessionPromise.then(session => {
                  session.sendRealtimeInput({ media: { data: base64Image, mimeType: 'image/jpeg' } });
                });
              }
            }, 2000); // 0.5 fps to save bandwidth
          },
          onmessage: async (message: LiveServerMessage) => {
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
                  sourceNode.connect(playbackContext.destination);
                  
                  const startTime = Math.max(playbackContext.currentTime, nextPlayTimeRef.current);
                  sourceNode.start(startTime);
                  nextPlayTimeRef.current = startTime + audioBuffer.duration;
                  sourceNodesRef.current.push(sourceNode);
                  
                  sourceNode.onended = () => {
                    sourceNodesRef.current = sourceNodesRef.current.filter(n => n !== sourceNode);
                  };
                }
              }
            }
            
            if (message.serverContent?.interrupted) {
              sourceNodesRef.current.forEach(node => {
                try { node.stop(); } catch (e) {}
              });
              sourceNodesRef.current = [];
              nextPlayTimeRef.current = playbackContext.currentTime;
            }

            if (message.toolCall) {
              const call = message.toolCall.functionCalls.find(fc => fc.name === 'updateIndicators');
              if (call && onIndicatorsUpdate) {
                onIndicatorsUpdate(call.args);
                // Send tool response
                sessionPromise.then(session => {
                  session.sendToolResponse({
                    functionResponses: [{
                      id: call.id,
                      name: call.name,
                      response: { result: "ok" }
                    }]
                  });
                });
              }
            }
          },
          onclose: () => {
            setIsConnected(false);
          },
          onerror: (err: any) => {
            console.error("Live API Error:", err);
            setError(err.message || "An error occurred");
          }
        }
      });
      
      sessionRef.current = sessionPromise;

    } catch (err: any) {
      console.error(err);
      setError(err.message);
      setIsConnecting(false);
    }
  }, [mode, onIndicatorsUpdate]);

  const disconnect = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.then((session: any) => session.close());
      sessionRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (playbackContextRef.current) {
      playbackContextRef.current.close();
      playbackContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoIntervalRef.current) {
      clearInterval(videoIntervalRef.current);
      videoIntervalRef.current = null;
    }
    setIsConnected(false);
  }, []);

  return { isConnected, isConnecting, error, connect, disconnect };
}
