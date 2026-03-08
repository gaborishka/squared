import { AlertTriangle, Clock3, Shield, Sparkles, X } from 'lucide-react';
import type { GamePlan, ProjectDetails } from '../types';

interface GamePlanViewProps {
  project: ProjectDetails;
  plan: GamePlan | null;
  isGenerating: boolean;
  onClose: () => void;
  onStartPresentation: (plan: GamePlan) => void;
}

const riskTone: Record<string, string> = {
  safe: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  watch: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  fragile: 'border-red-500/30 bg-red-500/10 text-red-100',
};

export function GamePlanView({ project, plan, isGenerating, onClose, onStartPresentation }: GamePlanViewProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm p-4 md:p-10 overflow-y-auto">
      <div className="max-w-6xl mx-auto rounded-[36px] border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Game Plan</p>
            <h3 className="text-2xl font-semibold text-zinc-50 mt-1">{project.name}</h3>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!plan ? (
          <div className="p-10 text-center text-zinc-400">
            <Sparkles className={`w-10 h-10 mx-auto mb-4 text-indigo-400 ${isGenerating ? 'animate-pulse' : ''}`} />
            <p className="text-lg text-zinc-100 font-medium">Preparing your game plan</p>
            <p className="mt-2">Aggregating weak spots, recovery phrases, and timing targets from prior rehearsal runs.</p>
          </div>
        ) : (
          <div className="p-6 md:p-8 space-y-6">
            <div className="grid md:grid-cols-4 gap-4">
              <div className="rounded-[28px] border border-zinc-800 bg-zinc-900/70 p-5">
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  Runs used
                </div>
                <div className="text-3xl font-semibold text-zinc-50 mt-3">{plan.runCount}</div>
              </div>
              <div className="rounded-[28px] border border-zinc-800 bg-zinc-900/70 p-5">
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <Sparkles className="w-4 h-4 text-indigo-400" />
                  Trend
                </div>
                <div className="text-3xl font-semibold text-zinc-50 mt-3 capitalize">{plan.overview.trend}</div>
              </div>
              <div className="rounded-[28px] border border-zinc-800 bg-zinc-900/70 p-5">
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Priority slides
                </div>
                <div className="text-3xl font-semibold text-zinc-50 mt-3">
                  {plan.attentionBudget.prioritySlides.length || '--'}
                </div>
              </div>
              <div className="rounded-[28px] border border-zinc-800 bg-zinc-900/70 p-5">
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <Clock3 className="w-4 h-4 text-sky-400" />
                  Time target
                </div>
                <div className="text-3xl font-semibold text-zinc-50 mt-3">{plan.timingStrategy.totalTargetMinutes}m</div>
              </div>
            </div>

            <div className="rounded-[32px] border border-zinc-800 bg-zinc-900/60 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-zinc-400">Attention budget</p>
                  <h4 className="text-xl font-semibold text-zinc-50 mt-1">
                    Max {plan.attentionBudget.maxInterventions} interventions, concentrated on slides{' '}
                    {plan.attentionBudget.prioritySlides.join(', ') || 'with no flagged hotspots'}.
                  </h4>
                </div>
                <div className="rounded-full bg-zinc-950 px-4 py-2 text-sm text-zinc-300">
                  Avg score {Math.round(plan.overview.avgScore)}
                </div>
              </div>
            </div>

            <div className="grid xl:grid-cols-2 gap-4">
              {plan.segments.map((segment) => (
                <article key={segment.slideNumber} className={`rounded-[30px] border p-5 ${riskTone[segment.riskLevel]}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] opacity-70">Slide {segment.slideNumber}</p>
                      <h5 className="text-lg font-semibold mt-2">{segment.slideTitle}</h5>
                    </div>
                    <div className="rounded-full bg-black/20 px-3 py-1 text-xs uppercase tracking-[0.18em]">
                      {segment.interventionPolicy}
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4 mt-5 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] opacity-70">Known issues</p>
                      <div className="mt-2 space-y-2">
                        {segment.knownIssues.length > 0 ? (
                          segment.knownIssues.map((issue) => (
                            <div key={issue} className="rounded-2xl bg-black/15 px-3 py-2">
                              {issue}
                            </div>
                          ))
                        ) : (
                          <div className="rounded-2xl bg-black/15 px-3 py-2">No repeated issues on record.</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] opacity-70">Prepared cues</p>
                      <div className="mt-2 space-y-2">
                        {segment.preparedCues.length > 0 ? (
                          segment.preparedCues.map((cue) => (
                            <div key={cue} className="rounded-2xl bg-black/15 px-3 py-2">
                              {cue}
                            </div>
                          ))
                        ) : (
                          <div className="rounded-2xl bg-black/15 px-3 py-2">No extra cue needed.</div>
                        )}
                      </div>
                    </div>
                  </div>

                  {segment.recoveryPhrases.length > 0 && (
                    <div className="mt-5">
                      <p className="text-xs uppercase tracking-[0.18em] opacity-70">Recovery phrases</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {segment.recoveryPhrases.map((phrase) => (
                          <span key={phrase} className="rounded-full bg-black/20 px-3 py-1.5 text-xs">
                            {phrase}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 px-6 py-5 border-t border-zinc-800">
          <button onClick={onClose} className="rounded-full px-4 py-2.5 text-sm font-medium text-zinc-300 hover:text-zinc-100">
            Close
          </button>
          {plan && (
            <button
              onClick={() => onStartPresentation(plan)}
              className="rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-400 transition-colors"
            >
              Start Presentation with this Plan
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
