import { useState, useEffect, useRef } from 'react';
import { Activity, ChevronDown, ChevronUp, Eye, User } from 'lucide-react';
import { IndicatorData } from '../types';

type StatusLevel = 'good' | 'warn' | 'bad' | 'neutral';

const dotColor: Record<StatusLevel, string> = {
  good: 'bg-emerald-400',
  warn: 'bg-amber-400',
  bad: 'bg-red-400',
  neutral: 'bg-zinc-500',
};

const classifyPace = (pace: string): StatusLevel => {
  if (!pace) return 'neutral';
  const l = pace.toLowerCase();
  if (l.includes('fast') || l.includes('slow')) return 'warn';
  if (l.includes('good') || l.includes('normal') || l.includes('perfect')) return 'good';
  return 'neutral';
};

const classifyEye = (eye: string): StatusLevel => {
  if (!eye) return 'neutral';
  const l = eye.toLowerCase();
  if (l.includes('looking away') || l.includes('around') || l.includes('down')) return 'bad';
  if (l.includes('glancing') || l.includes('not visible') || l.includes('face not')) return 'warn';
  if (l.includes('camera') || l.includes('good') || l.includes('direct')) return 'good';
  return 'neutral';
};

const classifyPosture = (posture: string): StatusLevel => {
  if (!posture) return 'neutral';
  const l = posture.toLowerCase();
  if (l.includes('slouch') || l.includes('bad')) return 'bad';
  if (l.includes('watch') || l.includes('not visible') || l.includes('posture not')) return 'warn';
  if (l.includes('good') || l.includes('straight') || l.includes('upright')) return 'good';
  return 'neutral';
};

function StatusDot({ level }: { level: StatusLevel }) {
  return <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor[level]}`} />;
}

function PresentationOverlay({ data }: { data: IndicatorData }) {
  const [expanded, setExpanded] = useState(false);
  const prevAgentModeRef = useRef(data.agentMode);

  const hasCue = !!data.microPrompt;
  const hasRescue = !!data.rescueText;
  const hasSlide = data.currentSlide != null;
  const hasTiming = data.slideTimeRemaining != null;
  const isUrgent = data.agentMode === 'rescue' || data.agentMode === 'directive';

  // Auto-expand when agent escalates to urgent or rescue text arrives
  useEffect(() => {
    const wasUrgent = prevAgentModeRef.current === 'rescue' || prevAgentModeRef.current === 'directive';
    if ((isUrgent && !wasUrgent) || hasRescue) {
      setExpanded(true);
    }
    prevAgentModeRef.current = data.agentMode;
  }, [data.agentMode, isUrgent, hasRescue]);

  const toneClasses =
    data.agentMode === 'rescue'
      ? 'border-red-500/50 bg-red-950/80'
      : data.agentMode === 'directive'
        ? 'border-amber-500/40 bg-amber-950/80'
        : 'border-zinc-700/40 bg-zinc-950/70';

  const accentColor =
    data.agentMode === 'rescue'
      ? 'text-red-300'
      : data.agentMode === 'directive'
        ? 'text-amber-300'
        : 'text-zinc-200';

  const eyeLevel = classifyEye(data.eyeContact);
  const paceLevel = classifyPace(data.pace);
  const postureLevel = classifyPosture(data.posture);
  const fillerCount = data.fillerWords?.total ?? 0;

  return (
    <div className="absolute inset-0 pointer-events-none p-4 flex flex-col items-center justify-start">
      {!expanded ? (
        /* ── Collapsed pill ── */
        <button
          onClick={() => setExpanded(true)}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-lg border border-zinc-700/30 bg-zinc-950/60 backdrop-blur-md px-3 py-1.5 hover:bg-zinc-900/80 hover:border-zinc-600/40 transition-colors cursor-pointer"
        >
          <div className={`w-1.5 h-1.5 rounded-full ${isUrgent ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400 animate-pulse'}`} />
          {hasSlide ? (
            <span className="text-xs text-white/60 tabular-nums">Slide {data.currentSlide}</span>
          ) : (
            <span className="text-xs text-white/40">Monitoring</span>
          )}
          {hasCue && (
            <>
              <span className="text-white/20">·</span>
              <span className={`text-xs font-medium ${accentColor}`}>{data.microPrompt}</span>
            </>
          )}
          <ChevronDown className="w-3 h-3 text-white/30" />
        </button>
      ) : (
        /* ── Expanded card ── */
        <div className={`pointer-events-auto max-w-sm w-full rounded-xl border backdrop-blur-xl shadow-2xl transition-all duration-300 ${toneClasses}`}>
          {/* Header — clickable to collapse */}
          <button
            onClick={() => setExpanded(false)}
            className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors rounded-t-xl"
          >
            <div className="flex items-center gap-2 text-xs text-white/50">
              <div className={`w-1.5 h-1.5 rounded-full ${isUrgent ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
              <span className="tabular-nums">{hasSlide ? `Slide ${data.currentSlide}` : 'Active'}</span>
              {hasTiming && (
                <span className={`tabular-nums ${data.slideTimeRemaining! < 15 ? 'text-amber-400' : ''}`}>
                  · {Math.max(0, data.slideTimeRemaining!)}s
                </span>
              )}
            </div>
            <ChevronUp className="w-3.5 h-3.5 text-white/30" />
          </button>

          <div className="px-4 pb-3 space-y-2.5">
            {/* Cue / urgent label */}
            {hasCue && (
              <p className={`text-lg font-semibold ${accentColor}`}>
                {data.microPrompt}
              </p>
            )}
            {isUrgent && !hasCue && (
              <p className={`text-base font-semibold ${accentColor}`}>
                {data.agentMode === 'rescue' ? 'Need help?' : 'Adjust now'}
              </p>
            )}

            {/* Rescue text */}
            {hasRescue && (
              <p className="text-sm text-white/85 leading-relaxed bg-white/5 rounded-lg px-3 py-2">
                {data.rescueText}
              </p>
            )}

            {/* Metrics row */}
            <div className="flex items-center gap-3 text-[11px]">
              <div className="flex items-center gap-1">
                <StatusDot level={eyeLevel} />
                <Eye className="w-3 h-3 text-white/40" />
                <span className="text-white/60">{data.eyeContact || '—'}</span>
              </div>
              <div className="flex items-center gap-1">
                <StatusDot level={paceLevel} />
                <Activity className="w-3 h-3 text-white/40" />
                <span className="text-white/60">{data.pace || '—'}</span>
              </div>
              <div className="flex items-center gap-1">
                <StatusDot level={postureLevel} />
                <User className="w-3 h-3 text-white/40" />
                <span className="text-white/60">{data.posture || '—'}</span>
              </div>
            </div>

            {/* Score + fillers row */}
            <div className="flex items-center gap-4 text-[11px] text-white/50">
              {data.overallScore > 0 && <span>Score: <span className="text-white/70 font-medium">{data.overallScore}</span></span>}
              {fillerCount > 0 && <span>Fillers: <span className={`font-medium ${fillerCount > 3 ? 'text-amber-400' : 'text-white/70'}`}>{fillerCount}</span></span>}
              {data.confidenceScore > 0 && <span>Confidence: <span className="text-white/70 font-medium">{data.confidenceScore}</span></span>}
            </div>

            {/* Timing bar */}
            {hasTiming && (
              <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full transition-all duration-700 ${
                    data.slideTimeRemaining! < 5
                      ? 'bg-red-400'
                      : data.slideTimeRemaining! < 15
                        ? 'bg-amber-400'
                        : 'bg-emerald-400'
                  }`}
                  style={{
                    width: `${Math.max(3, Math.min(100, (data.slideTimeRemaining! / 90) * 100))}%`,
                  }}
                />
              </div>
            )}

            {/* Feedback message */}
            {data.feedbackMessage && (
              <p className="text-xs text-white/50 leading-relaxed border-t border-white/5 pt-2">
                {data.feedbackMessage}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CameraOverlay({ data, variant = 'rehearsal' }: { data: IndicatorData; variant?: 'rehearsal' | 'presentation' }) {
  if (!data) return null;

  if (variant === 'presentation') {
    return <PresentationOverlay data={data} />;
  }

  const eyeLevel = classifyEye(data.eyeContact);
  const paceLevel = classifyPace(data.pace);
  const postureLevel = classifyPosture(data.posture);

  const indicators = [
    { icon: Eye, label: data.eyeContact || 'Analyzing...', level: eyeLevel },
    { icon: Activity, label: data.pace || 'Analyzing...', level: paceLevel },
    { icon: User, label: data.posture || 'Analyzing...', level: postureLevel },
  ];

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col">
      <div className="flex justify-center pt-4">
        <div className="flex items-center bg-black/50 backdrop-blur-md rounded-xl divide-x divide-white/10">
          {indicators.map(({ icon: Icon, label, level }, i) => (
            <div key={i} className="flex items-center gap-1.5 px-3 py-2">
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor[level]}`} />
              <Icon className="w-3 h-3 text-white/60 shrink-0" />
              <span className="text-[11px] text-white/80 font-medium whitespace-nowrap">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
