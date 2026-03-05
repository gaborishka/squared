import { useState, useRef, useEffect, useCallback } from 'react';
import { ArrowLeft, Activity, Upload, Type, FileText } from 'lucide-react';
import { useLiveAPI } from '../hooks/useLiveAPI';
import { Indicators } from './Indicators';
import { CameraOverlay } from './CameraOverlay';
import { IndicatorData, IndicatorUpdate, mergeIndicatorData } from '../types';
import { ContextModal } from './ContextModal';

export function PresentationMode({ onBack, onSessionEnd }: { onBack: () => void, onSessionEnd: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [indicators, setIndicators] = useState<IndicatorData | null>(null);
  const [feedbackHistory, setFeedbackHistory] = useState<{ id: string, timestamp: string, message: string }[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number | null>(null);
  const sessionStartTimeRef = useRef<number | null>(null);
  const [contextText, setContextText] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const liveSessionActiveRef = useRef(false);

  const stopPreview = useCallback(() => {
    const previewStream = previewStreamRef.current;
    if (previewStream) {
      previewStream.getTracks().forEach(track => track.stop());
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
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      previewStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.warn("Could not get preview stream", err);
    }
  }, []);

  const handleIndicatorsUpdate = useCallback((update: IndicatorUpdate) => {
    setIndicators(prev => mergeIndicatorData(prev, update));

    if (update.feedbackMessage?.trim()) {
      setFeedbackHistory(prev => {
        let timeStr = "00:00";
        if (sessionStartTimeRef.current) {
          const diffMs = Date.now() - sessionStartTimeRef.current;
          const mins = Math.floor(diffMs / 60000);
          const secs = Math.floor((diffMs % 60000) / 1000);
          timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
        }

        const newItem = {
          id: Math.random().toString(36).substring(7),
          timestamp: timeStr,
          message: update.feedbackMessage
        };

        return [newItem, ...prev];
      });
    }
  }, []);

  const { isConnected, isConnecting, error, connect, disconnect } = useLiveAPI({
    mode: 'presentation',
    contextText,
    onIndicatorsUpdate: handleIndicatorsUpdate
  });

  useEffect(() => {
    return () => stopPreview();
  }, [stopPreview]);

  useEffect(() => {
    liveSessionActiveRef.current = isConnected || isConnecting;
    if (isConnected) {
      const now = Date.now();
      setSessionStartTime(now);
      sessionStartTimeRef.current = now;
      setFeedbackHistory([{
        id: 'start',
        timestamp: '00:00',
        message: 'Presentation started'
      }]);
    } else {
      setSessionStartTime(null);
      sessionStartTimeRef.current = null;
      setIndicators(null);
      setFeedbackHistory([]);
    }
  }, [isConnected, isConnecting]);

  useEffect(() => {
    if (isConnected || isConnecting) {
      stopPreview();
      return;
    }
    startPreview();
  }, [isConnected, isConnecting, startPreview, stopPreview]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result;
      if (typeof text === 'string') {
        setContextText(prev => prev ? prev + '\n\n' + text : text);
        setIsModalOpen(true);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, []);

  const handleToggleConnect = async () => {
    if (isConnected || isConnecting) {
      disconnect();
      if (sessionStartTimeRef.current) {
        const duration = Date.now() - sessionStartTimeRef.current;
        try {
          await fetch('/api/runs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              run: {
                id: crypto.randomUUID(),
                mode: 'presentation',
                duration
              },
              feedbacks: feedbackHistory
            })
          });
        } catch (e) {
          console.error('Failed to save session:', e);
        }
        onSessionEnd();
      }
    } else if (videoRef.current) {
      stopPreview();
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
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600'}`} />
          <span className="text-sm font-medium text-zinc-300">
            {isConnecting ? 'Connecting...' : isConnected ? 'Silent Coach Active' : 'Ready to Present'}
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

          {/* Overlay Indicators - HUD style */}
          {indicators && (
            <div className="absolute top-20 right-6 flex flex-col gap-3 z-10">
              {indicators.feedbackMessage && (
                <div className="bg-zinc-950/80 backdrop-blur-md border border-zinc-800 text-white px-4 py-3 rounded-xl shadow-lg max-w-xs animate-in fade-in slide-in-from-top-4">
                  <p className="text-sm font-medium">{indicators.feedbackMessage}</p>
                </div>
              )}
            </div>
          )}

          {/* Overlay Controls */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center space-x-4 bg-zinc-950/80 backdrop-blur-md px-6 py-3 rounded-full border border-zinc-800 z-10">
            <button
              onClick={handleToggleConnect}
              className={`flex items-center px-4 py-2 rounded-full font-medium transition-colors ${isConnected || isConnecting
                ? 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                : 'bg-emerald-500 text-white hover:bg-emerald-600'
                }`}
            >
              {isConnected || isConnecting ? 'End Session' : 'Start Presentation'}
            </button>
          </div>

          {error && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-4 py-2 rounded-lg text-sm backdrop-blur-md z-10">
              {error}
            </div>
          )}
        </div>

        <div className="w-80 flex flex-col gap-6">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex-1 overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              <Activity className="w-5 h-5 mr-2 text-emerald-400" />
              Live Metrics
            </h3>
            {indicators ? (
              <Indicators data={indicators} />
            ) : (
              <div className="flex flex-col flex-1">
                <div className="flex-1 text-zinc-500 text-sm text-center mt-10">
                  Start the session to see real-time metrics here.
                </div>
                <div className="w-full text-left space-y-3 mt-auto pt-6">
                  <span className="block text-sm font-medium text-zinc-300">
                    Speech Plan (Optional)
                  </span>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setIsModalOpen(true)}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium rounded-xl transition-colors ring-1 ring-zinc-700/50"
                    >
                      <Type className="w-4 h-4 text-indigo-400" />
                      Add Text
                    </button>
                    <label className="flex-1 cursor-pointer flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium rounded-xl transition-colors ring-1 ring-zinc-700/50">
                      <Upload className="w-4 h-4 text-emerald-400" />
                      Upload File
                      <input
                        type="file"
                        accept=".txt,.md,.csv,.json"
                        className="hidden"
                        onChange={handleFileUpload}
                      />
                    </label>
                  </div>
                  {contextText && (
                    <div className="mt-4 p-3 bg-zinc-950/50 border border-zinc-800 rounded-xl flex items-start gap-3 relative group">
                      <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="flex-1 min-w-0 pr-12">
                        <p className="text-sm text-zinc-300 font-medium truncate">Plan attached</p>
                        <p className="text-xs text-zinc-500 truncate">{contextText.length} characters</p>
                      </div>
                      <button
                        onClick={() => setIsModalOpen(true)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-emerald-400 hover:text-emerald-300 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <ContextModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        contextText={contextText}
        setContextText={setContextText}
        title="Presentation Plan"
      />
    </div>
  );
}
