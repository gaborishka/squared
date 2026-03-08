import { Activity, Clock3, Eye, User } from 'lucide-react';
import { IndicatorData } from '../types';

export function CameraOverlay({ data, variant = 'rehearsal' }: { data: IndicatorData; variant?: 'rehearsal' | 'presentation' }) {
  if (!data) return null;

  const presentationTone =
    data.agentMode === 'rescue'
      ? 'border-red-500/40 bg-red-500/15 text-red-50'
      : data.agentMode === 'directive'
        ? 'border-amber-500/40 bg-amber-500/15 text-amber-50'
        : 'border-emerald-500/30 bg-zinc-950/70 text-zinc-50';

  const getPaceColor = (pace: string) => {
    if (!pace) return 'bg-zinc-900/80 text-zinc-400';
    const lower = pace.toLowerCase();
    if (lower.includes('fast') || lower.includes('slow')) return 'bg-amber-500/90 text-white';
    if (lower.includes('good') || lower.includes('normal') || lower.includes('perfect')) return 'bg-emerald-500/90 text-white';
    return 'bg-zinc-900/80 text-zinc-200';
  };

  const getEyeContactColor = (eye: string) => {
    if (!eye) return 'bg-zinc-900/80 text-zinc-400';
    const lower = eye.toLowerCase();
    if (lower.includes('looking away') || lower.includes('around') || lower.includes('down')) return 'bg-red-500/90 text-white';
    if (lower.includes('glancing') || lower.includes('not visible') || lower.includes('face not')) return 'bg-amber-500/90 text-white';
    if (lower.includes('camera') || lower.includes('good') || lower.includes('direct')) return 'bg-emerald-500/90 text-white';
    return 'bg-zinc-900/80 text-zinc-200';
  };

  const getPostureColor = (posture: string) => {
    if (!posture) return 'bg-zinc-900/80 text-zinc-400';
    const lower = posture.toLowerCase();
    if (lower.includes('slouch') || lower.includes('bad')) return 'bg-red-500/90 text-white';
    if (lower.includes('watch') || lower.includes('not visible') || lower.includes('posture not')) return 'bg-amber-500/90 text-white';
    if (lower.includes('good') || lower.includes('straight') || lower.includes('upright')) return 'bg-emerald-500/90 text-white';
    return 'bg-zinc-900/80 text-zinc-200';
  };

  if (variant === 'presentation') {
    return (
      <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between">
        <div className="flex justify-center">
          <div className={`min-w-[280px] max-w-[70vw] rounded-[28px] border backdrop-blur-xl shadow-2xl transition-all ${presentationTone}`}>
            <div className="px-5 py-4">
              <div className="flex items-center justify-between gap-4 text-xs uppercase tracking-[0.22em] opacity-75">
                <span>{data.currentSlide != null ? `Slide ${data.currentSlide}` : 'Monitor mode'}</span>
                <span>{data.agentMode}</span>
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-tight">
                {data.microPrompt || 'Stay steady'}
              </div>
              {data.rescueText && (
                <div className="mt-3 rounded-2xl bg-black/25 px-4 py-3 text-sm leading-relaxed text-white/90">
                  {data.rescueText}
                </div>
              )}
            </div>

            <div className="px-5 pb-4">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-white/65 mb-2">
                <span className="inline-flex items-center gap-2">
                  <Clock3 className="w-3.5 h-3.5" />
                  Slide timing
                </span>
                <span>{data.slideTimeRemaining != null ? `${Math.max(0, data.slideTimeRemaining)}s left` : 'no target'}</span>
              </div>
              <div className="h-2 rounded-full bg-black/25 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${
                    data.agentMode === 'rescue' ? 'bg-red-400' : data.agentMode === 'directive' ? 'bg-amber-400' : 'bg-emerald-400'
                  }`}
                  style={{
                    width: `${data.slideTimeRemaining == null ? 100 : Math.max(8, Math.min(100, (data.slideTimeRemaining / 90) * 100))}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <div className="rounded-full bg-zinc-950/70 border border-zinc-800 backdrop-blur-xl px-4 py-2 text-xs uppercase tracking-[0.18em] text-zinc-300">
            {data.eyeContact} • {data.posture} • {data.pace}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between">
      <div className="flex justify-between items-start">
        {/* Top Left: Eye Contact */}
        <div className={`flex items-center space-x-2 px-4 py-2 rounded-full backdrop-blur-md border border-white/10 transition-colors shadow-lg ${getEyeContactColor(data.eyeContact)}`}>
          <Eye className="w-4 h-4" />
          <span className="text-sm font-medium">{data.eyeContact || 'Analyzing Eye Contact...'}</span>
        </div>

        {/* Top Right: Pace */}
        <div className={`flex items-center space-x-2 px-4 py-2 rounded-full backdrop-blur-md border border-white/10 transition-colors shadow-lg ${getPaceColor(data.pace)}`}>
          <Activity className="w-4 h-4" />
          <span className="text-sm font-medium">{data.pace || 'Analyzing Pace...'}</span>
        </div>
      </div>

      <div className="flex justify-between items-end mb-20">
        {/* Bottom Left: Posture */}
        <div className={`flex items-center space-x-2 px-4 py-2 rounded-full backdrop-blur-md border border-white/10 transition-colors shadow-lg ${getPostureColor(data.posture)}`}>
          <User className="w-4 h-4" />
          <span className="text-sm font-medium">{data.posture || 'Analyzing Posture...'}</span>
        </div>
      </div>
    </div>
  );
}
