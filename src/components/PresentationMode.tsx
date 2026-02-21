import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Activity } from 'lucide-react';
import { useLiveAPI } from '../hooks/useLiveAPI';
import { Indicators } from './Indicators';
import { CameraOverlay } from './CameraOverlay';
import { IndicatorData } from '../types';

export function PresentationMode({ onBack }: { onBack: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [indicators, setIndicators] = useState<IndicatorData | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  const { isConnected, isConnecting, error, connect, disconnect } = useLiveAPI({
    mode: 'presentation',
    onIndicatorsUpdate: setIndicators
  });

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

  useEffect(() => {
    if (!isConnected && videoRef.current && previewStreamRef.current) {
      videoRef.current.srcObject = previewStreamRef.current;
    }
  }, [isConnected]);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

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
              className={`flex items-center px-4 py-2 rounded-full font-medium transition-colors ${
                isConnected || isConnecting 
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
              <div className="text-zinc-500 text-sm text-center mt-10">
                Start the session to see real-time metrics here.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
