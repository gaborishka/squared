import { Eye, Activity, User } from 'lucide-react';
import { IndicatorData } from '../types';

export function CameraOverlay({ data }: { data: IndicatorData }) {
  if (!data) return null;

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
