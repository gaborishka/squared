import { AlertTriangle, ChevronDown, ChevronUp, Clock3, Crosshair, HelpCircle, MessageCircleQuestion, Presentation, Shield, Sparkles, TrendingDown, TrendingUp, X, Zap } from 'lucide-react';
import { useState } from 'react';
import { motion } from 'motion/react';
import type { GamePlan, GamePlanSegment, ProjectDetails, QAQuestion } from '../types';

interface GamePlanViewProps {
  project: ProjectDetails;
  plan: GamePlan | null;
  isGenerating: boolean;
  onClose: () => void;
  onStartPresentation: (plan: GamePlan) => void;
}

const trendIcon = {
  improving: TrendingUp,
  stable: Sparkles,
  declining: TrendingDown,
};

const trendColor = {
  improving: 'text-emerald-400',
  stable: 'text-zinc-400',
  declining: 'text-red-400',
};

function riskDot(level: string) {
  if (level === 'fragile') return 'bg-red-400';
  if (level === 'watch') return 'bg-amber-400';
  return 'bg-emerald-400';
}

function riskBorder(level: string) {
  if (level === 'fragile') return 'border-red-500/25';
  if (level === 'watch') return 'border-amber-500/20';
  return 'border-zinc-800/50';
}

function policyLabel(policy: string) {
  if (policy === 'teleprompter') return { text: 'Teleprompter', color: 'text-red-400 bg-red-500/10' };
  if (policy === 'directive') return { text: 'Directive', color: 'text-amber-400 bg-amber-500/10' };
  if (policy === 'soft_cue') return { text: 'Soft cue', color: 'text-sky-400 bg-sky-500/10' };
  return { text: 'Silent', color: 'text-zinc-500 bg-zinc-800/60' };
}

function hasContent(segment: GamePlanSegment) {
  return segment.knownIssues.length > 0 || segment.preparedCues.length > 0 || segment.recoveryPhrases.length > 0;
}

function difficultyStyle(difficulty: QAQuestion['difficulty']) {
  if (difficulty === 'hard') return 'text-red-400 bg-red-500/10';
  if (difficulty === 'medium') return 'text-amber-400 bg-amber-500/10';
  return 'text-emerald-400 bg-emerald-500/10';
}

function sourceLabel(source: QAQuestion['source']) {
  const labels: Record<QAQuestion['source'], string> = {
    content_gap: 'Content gap',
    weak_spot: 'Weak spot',
    controversial: 'Bold claim',
    technical: 'Technical',
    clarification: 'Clarification',
  };
  return labels[source] ?? source;
}

export function GamePlanView({ project, plan, isGenerating, onClose, onStartPresentation }: GamePlanViewProps) {
  const TrendIcon = plan ? trendIcon[plan.overview.trend] : Sparkles;
  const prioritySet = new Set(plan?.attentionBudget.prioritySlides ?? []);
  const [expandedQA, setExpandedQA] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="min-h-full flex flex-col">
        {/* Header — sticky */}
        <header className="sticky top-0 z-10 bg-zinc-950/90 backdrop-blur-xl border-b border-zinc-800/50">
          <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-4">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-widest">Game Plan</p>
              <h2 className="text-xl font-semibold text-zinc-100 truncate mt-0.5">{project.name}</h2>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 p-2.5 rounded-xl text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
          {!plan ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className={`w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-6 ${isGenerating ? 'animate-pulse' : ''}`}>
                <Sparkles className="w-7 h-7 text-indigo-400" />
              </div>
              <p className="text-lg font-medium text-zinc-200">Building your game plan</p>
              <p className="text-sm text-zinc-500 mt-2 max-w-sm">
                Analyzing weak spots, recovery phrases, and timing from prior rehearsals.
              </p>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="space-y-8"
            >
              {/* Stats row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/50 px-4 py-3.5">
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Shield className="w-3.5 h-3.5 text-emerald-400" />
                    Rehearsals
                  </div>
                  <div className="text-2xl font-bold text-zinc-100 mt-1.5 tabular-nums">{plan.runCount}</div>
                </div>
                <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/50 px-4 py-3.5">
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <TrendIcon className={`w-3.5 h-3.5 ${trendColor[plan.overview.trend]}`} />
                    Trend
                  </div>
                  <div className={`text-2xl font-bold mt-1.5 capitalize ${trendColor[plan.overview.trend]}`}>
                    {plan.overview.trend}
                  </div>
                </div>
                <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/50 px-4 py-3.5">
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Crosshair className="w-3.5 h-3.5 text-amber-400" />
                    Avg score
                  </div>
                  <div className="text-2xl font-bold text-zinc-100 mt-1.5 tabular-nums">
                    {plan.overview.avgScore > 0 ? Math.round(plan.overview.avgScore) : '--'}
                  </div>
                </div>
                <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/50 px-4 py-3.5">
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Clock3 className="w-3.5 h-3.5 text-sky-400" />
                    Target time
                  </div>
                  <div className="text-2xl font-bold text-zinc-100 mt-1.5 tabular-nums">{plan.timingStrategy.totalTargetMinutes}m</div>
                </div>
              </div>

              {/* Attention budget */}
              <div className="rounded-xl bg-zinc-900/40 border border-zinc-800/40 px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0">
                    <Zap className="w-4 h-4 text-indigo-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-zinc-200">
                      {plan.attentionBudget.maxInterventions} intervention{plan.attentionBudget.maxInterventions !== 1 ? 's' : ''} allowed
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {plan.attentionBudget.prioritySlides.length > 0
                        ? `Focus on slide${plan.attentionBudget.prioritySlides.length > 1 ? 's' : ''} ${plan.attentionBudget.prioritySlides.join(', ')}`
                        : 'No priority hotspots flagged'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Slide segments */}
              <div>
                <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-widest mb-4">
                  Slide breakdown
                  <span className="text-zinc-600 ml-2 normal-case tracking-normal">{plan.segments.length} slides</span>
                </h3>

                <div className="space-y-2">
                  {plan.segments.map((segment) => {
                    const policy = policyLabel(segment.interventionPolicy);
                    const isPriority = prioritySet.has(segment.slideNumber);
                    const expanded = hasContent(segment);
                    const timeTarget = plan.timingStrategy.perSlideTargets[segment.slideNumber];

                    return (
                      <div
                        key={segment.slideNumber}
                        className={`rounded-xl border bg-zinc-900/40 transition-colors ${riskBorder(segment.riskLevel)} ${isPriority ? 'ring-1 ring-amber-500/20' : ''}`}
                      >
                        {/* Slide header row */}
                        <div className="flex items-center gap-3 px-4 py-3">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${riskDot(segment.riskLevel)}`} />
                          <span className="text-xs font-mono text-zinc-500 shrink-0 w-6 text-right">{segment.slideNumber}</span>
                          <span className="text-sm font-medium text-zinc-200 truncate flex-1">{segment.slideTitle}</span>
                          {timeTarget != null && (
                            <span className="text-[11px] text-zinc-600 tabular-nums shrink-0">{timeTarget}s</span>
                          )}
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md shrink-0 ${policy.color}`}>
                            {policy.text}
                          </span>
                          {isPriority && (
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          )}
                        </div>

                        {/* Expanded content — only if there's actual data */}
                        {expanded && (
                          <div className="px-4 pb-3 pt-0 flex flex-wrap gap-x-6 gap-y-2 border-t border-zinc-800/30 mt-0 pt-3 ml-[44px]">
                            {segment.knownIssues.length > 0 && (
                              <div className="min-w-0">
                                <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Issues</p>
                                <div className="space-y-1">
                                  {segment.knownIssues.map((issue) => (
                                    <p key={issue} className="text-xs text-zinc-400 leading-relaxed">{issue}</p>
                                  ))}
                                </div>
                              </div>
                            )}
                            {segment.preparedCues.length > 0 && (
                              <div className="min-w-0">
                                <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Cues</p>
                                <div className="space-y-1">
                                  {segment.preparedCues.map((cue) => (
                                    <p key={cue} className="text-xs text-zinc-400 leading-relaxed">{cue}</p>
                                  ))}
                                </div>
                              </div>
                            )}
                            {segment.recoveryPhrases.length > 0 && (
                              <div className="min-w-0">
                                <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Recovery</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {segment.recoveryPhrases.map((phrase) => (
                                    <span key={phrase} className="text-xs text-zinc-400 bg-zinc-800/60 px-2 py-0.5 rounded-md">{phrase}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Q&A Shield */}
              {plan.qaShield && plan.qaShield.length > 0 && (
                <div>
                  <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-widest mb-4">
                    <span className="inline-flex items-center gap-1.5">
                      <MessageCircleQuestion className="w-3.5 h-3.5 text-violet-400" />
                      Q&A Shield
                    </span>
                    <span className="text-zinc-600 ml-2 normal-case tracking-normal">{plan.qaShield.length} predicted questions</span>
                  </h3>

                  <div className="space-y-2">
                    {plan.qaShield.map((qa) => {
                      const isExpanded = expandedQA === qa.id;
                      return (
                        <div
                          key={qa.id}
                          className="rounded-xl border border-zinc-800/50 bg-zinc-900/40 transition-colors hover:border-zinc-700/50"
                        >
                          <button
                            onClick={() => setExpandedQA(isExpanded ? null : qa.id)}
                            className="w-full flex items-start gap-3 px-4 py-3 text-left"
                          >
                            <HelpCircle className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-zinc-200 leading-relaxed">{qa.question}</p>
                              <div className="flex items-center gap-2 mt-1.5">
                                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${difficultyStyle(qa.difficulty)}`}>
                                  {qa.difficulty}
                                </span>
                                <span className="text-[10px] text-zinc-600">{sourceLabel(qa.source)}</span>
                                {qa.slideNumber != null && (
                                  <span className="text-[10px] text-zinc-600">slide {qa.slideNumber}</span>
                                )}
                              </div>
                            </div>
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-zinc-600 shrink-0 mt-0.5" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-zinc-600 shrink-0 mt-0.5" />
                            )}
                          </button>
                          {isExpanded && (
                            <div className="px-4 pb-3 ml-7 border-t border-zinc-800/30 pt-3">
                              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Suggested answer</p>
                              <p className="text-xs text-zinc-300 leading-relaxed">{qa.suggestedAnswer}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </div>

        {/* Footer — sticky */}
        {plan && (
          <footer className="sticky bottom-0 bg-zinc-950/90 backdrop-blur-xl border-t border-zinc-800/50">
            <div className="max-w-5xl mx-auto flex items-center justify-end gap-3 px-6 py-4">
              <button
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => onStartPresentation(plan)}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-600/20 hover:shadow-emerald-600/30"
              >
                <Presentation className="w-4 h-4" />
                Start Presentation
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
