import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Eye,
  Gauge,
  MessageSquare,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';
import type { ProjectDetails, RunDetails, RunSummary } from '../types';

interface RunAnalysisProps {
  run: RunDetails;
  comparisonRun?: RunSummary | null;
  project?: ProjectDetails | null;
  onClose: () => void;
}

type SummaryTone = 'positive' | 'warning' | 'muted';

function formatDuration(duration: number): string {
  const totalSeconds = Math.floor(duration / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatSigned(value: number | null, suffix = ''): string {
  if (value == null || Number.isNaN(value)) return '--';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded >= 0 ? '+' : ''}${rounded}${suffix}`;
}

function formatMetric(value: number | null, suffix = '', digits = 0): string {
  if (value == null || Number.isNaN(value)) return '--';
  return `${value.toFixed(digits)}${suffix}`;
}

function verdictLabel(verdict: NonNullable<RunDetails['runReport']>['verdict']): string {
  if (verdict === 'strong') return 'Strong run';
  if (verdict === 'mixed') return 'Mixed run';
  return 'Needs another pass';
}

function verdictTone(verdict: NonNullable<RunDetails['runReport']>['verdict']): SummaryTone {
  if (verdict === 'strong') return 'positive';
  if (verdict === 'mixed') return 'warning';
  return 'muted';
}

function severityLabel(severity: RunDetails['feedbacks'][number]['severity']): string {
  if (severity === 'critical') return 'Critical';
  if (severity === 'warning') return 'Warning';
  return 'Info';
}

function severityClasses(severity: RunDetails['feedbacks'][number]['severity']): string {
  if (severity === 'critical') return 'border-red-500/30 bg-red-500/10 text-red-200';
  if (severity === 'warning') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  return 'border-zinc-700 bg-zinc-900 text-zinc-300';
}

function categoryLabel(category: RunDetails['feedbacks'][number]['category']): string {
  if (!category) return 'General';
  return category.replace('_', ' ');
}

function categoryClasses(category: RunDetails['feedbacks'][number]['category']): string {
  if (category === 'pace') return 'bg-sky-500/10 text-sky-200';
  if (category === 'eye_contact') return 'bg-cyan-500/10 text-cyan-200';
  if (category === 'posture') return 'bg-teal-500/10 text-teal-200';
  if (category === 'filler') return 'bg-amber-500/10 text-amber-200';
  if (category === 'structure') return 'bg-violet-500/10 text-violet-200';
  if (category === 'content') return 'bg-indigo-500/10 text-indigo-200';
  return 'bg-zinc-800 text-zinc-300';
}

function riskClasses(riskLevel: RunDetails['slideAnalyses'][number]['riskLevel']): string {
  if (riskLevel === 'fragile') return 'border-red-500/30 bg-red-500/10 text-red-200';
  if (riskLevel === 'watch') return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
  return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200';
}

function metricTone(delta: number | null): string {
  if (delta == null) return 'text-zinc-500';
  if (delta > 0) return 'text-emerald-300';
  if (delta < 0) return 'text-red-300';
  return 'text-zinc-400';
}

function verdictForRun(run: RunDetails): { label: string; tone: SummaryTone; summary: string } {
  const fragileSlides = run.slideAnalyses.filter((analysis) => analysis.riskLevel === 'fragile').length;
  const warnings = run.feedbacks.filter((feedback) => feedback.severity !== 'info').length;
  const score = run.overallScore ?? 0;

  if (score >= 80 && fragileSlides === 0 && warnings <= 1) {
    return {
      label: 'Strong run',
      tone: 'positive',
      summary: 'Delivery looked stable overall, with only a small amount of coaching needed during the session.',
    };
  }

  if (score >= 62 && fragileSlides <= 1) {
    return {
      label: 'Mixed run',
      tone: 'warning',
      summary: 'The session had solid moments, but a few risky sections are still interrupting flow and confidence.',
    };
  }

  return {
    label: 'Needs another pass',
    tone: 'muted',
    summary: 'The core structure is there, but this run still has enough friction that the next rehearsal should stay focused and tactical.',
  };
}

function buildWins(run: RunDetails, fillerPerMinute: number | null): string[] {
  const wins: string[] = [];

  if ((run.overallScore ?? 0) >= 75) {
    wins.push('Overall delivery held together well across most of the session.');
  }
  if ((run.avgConfidence ?? 0) >= 70) {
    wins.push('Confidence stayed strong enough to keep the talk feeling intentional.');
  }
  if ((run.eyeContactPct ?? 0) >= 65) {
    wins.push('Eye contact was steady for most of the run, which helps authority land.');
  }
  if ((run.postureGoodPct ?? 0) >= 70) {
    wins.push('Posture stayed composed and supported a more confident presence.');
  }
  if (fillerPerMinute != null && fillerPerMinute <= 2) {
    wins.push('Filler usage stayed controlled, so the delivery sounded cleaner.');
  }

  const recoverySlide = run.slideAnalyses.find((analysis) => Boolean(analysis.bestPhrase));
  if (recoverySlide) {
    wins.push(`You found a usable recovery phrase on slide ${recoverySlide.slideNumber}, which is a good anchor for the next run.`);
  }

  return wins.slice(0, 3);
}

function buildRisks(run: RunDetails, fillerPerMinute: number | null): string[] {
  const risks: string[] = [];
  const fragileSlides = run.slideAnalyses.filter((analysis) => analysis.riskLevel === 'fragile');

  if (run.avgPaceWpm != null && run.avgPaceWpm > 170) {
    risks.push(`Average pace landed at ${Math.round(run.avgPaceWpm)} WPM, which is likely rushing transitions.`);
  } else if (run.avgPaceWpm != null && run.avgPaceWpm < 105) {
    risks.push(`Average pace landed at ${Math.round(run.avgPaceWpm)} WPM, which can make the talk feel hesitant.`);
  }

  if (fillerPerMinute != null && fillerPerMinute > 3) {
    risks.push(`Filler words are still showing up at ${fillerPerMinute.toFixed(1)}/min, which is high enough to muddy key points.`);
  }

  if ((run.eyeContactPct ?? 100) < 55) {
    risks.push('Eye contact dropped too often, so the delivery can feel less direct on camera.');
  }

  if ((run.postureGoodPct ?? 100) < 60) {
    risks.push('Posture consistency is still soft, which can read as hesitation even when the content is fine.');
  }

  if (fragileSlides.length > 0) {
    risks.push(`Slides ${fragileSlides.map((slide) => slide.slideNumber).join(', ')} are the main breakpoints from this session.`);
  }

  if (risks.length === 0 && run.feedbacks.length > 0) {
    risks.push('The biggest remaining issue is consistency: feedback stayed active even when the overall score held up.');
  }

  return risks.slice(0, 3);
}

function buildNextSteps(run: RunDetails, fillerPerMinute: number | null): string[] {
  const nextSteps: string[] = [];
  const riskySlides = run.slideAnalyses
    .filter((analysis) => analysis.riskLevel !== 'safe')
    .map((analysis) => analysis.slideNumber);

  if (riskySlides.length > 0) {
    nextSteps.push(`Run slides ${riskySlides.join(', ')} in isolation until the transition into each one feels automatic.`);
  }

  if (run.avgPaceWpm != null && (run.avgPaceWpm > 170 || run.avgPaceWpm < 105)) {
    nextSteps.push('Do one timed pass focused only on pace, aiming to stay in a steady 105-170 WPM lane.');
  }

  if (fillerPerMinute != null && fillerPerMinute > 3) {
    nextSteps.push('Redo the opening and every transition beat with a deliberate pause instead of speaking through the silence.');
  }

  if ((run.eyeContactPct ?? 100) < 55 || (run.postureGoodPct ?? 100) < 60) {
    nextSteps.push('Practice one short run with the camera framed and posture visible so visual cues become part of the rehearsal loop.');
  }

  if (nextSteps.length === 0) {
    nextSteps.push('Repeat the full run once more and try to preserve the same strengths while making the stronger moments feel more repeatable.');
  }

  return nextSteps.slice(0, 3);
}

function summaryToneClasses(tone: SummaryTone): string {
  if (tone === 'positive') return 'border-emerald-500/30 bg-emerald-500/10';
  if (tone === 'warning') return 'border-amber-500/30 bg-amber-500/10';
  return 'border-zinc-700 bg-zinc-900/70';
}

export function RunAnalysis({ run, comparisonRun, project, onClose }: RunAnalysisProps) {
  const minutes = run.duration > 0 ? run.duration / 60000 : 0;
  const fillerPerMinute = minutes > 0 ? run.fillerWordCount / minutes : null;
  const feedbackPerMinute = minutes > 0 ? run.feedbacks.length / minutes : null;
  const fallbackVerdict = verdictForRun(run);
  const verdict = run.runReport
    ? {
      label: verdictLabel(run.runReport.verdict),
      tone: verdictTone(run.runReport.verdict),
      summary: run.runReport.summary,
    }
    : fallbackVerdict;
  const wins = run.runReport?.wins.length ? run.runReport.wins : buildWins(run, fillerPerMinute);
  const risks = run.runReport?.risks.length ? run.runReport.risks : buildRisks(run, fillerPerMinute);
  const nextSteps = run.runReport?.nextSteps.length ? run.runReport.nextSteps : buildNextSteps(run, fillerPerMinute);
  const slideTitleByNumber = new Map(project?.slides.map((slide) => [slide.slideNumber, slide.title]) ?? []);
  const comparison = run.runReport?.comparison ?? (comparisonRun
    ? {
      overallScoreDelta: run.overallScore != null && comparisonRun.overallScore != null
        ? run.overallScore - comparisonRun.overallScore
        : null,
      avgPaceWpmDelta: run.avgPaceWpm != null && comparisonRun.avgPaceWpm != null
        ? run.avgPaceWpm - comparisonRun.avgPaceWpm
        : null,
      avgConfidenceDelta: run.avgConfidence != null && comparisonRun.avgConfidence != null
        ? run.avgConfidence - comparisonRun.avgConfidence
        : null,
      fillerWordCountDelta: run.fillerWordCount - comparisonRun.fillerWordCount,
      eyeContactPctDelta: run.eyeContactPct != null && comparisonRun.eyeContactPct != null
        ? run.eyeContactPct - comparisonRun.eyeContactPct
        : null,
      postureGoodPctDelta: run.postureGoodPct != null && comparisonRun.postureGoodPct != null
        ? run.postureGoodPct - comparisonRun.postureGoodPct
        : null,
    }
    : null);
  const slideCards = run.runReport?.slideCards ?? run.slideAnalyses.map((analysis) => ({
    slideNumber: analysis.slideNumber,
    slideTitle: slideTitleByNumber.get(analysis.slideNumber) || 'Untitled slide',
    riskLevel: analysis.riskLevel,
    issues: analysis.issues,
    bestPhrase: analysis.bestPhrase,
    repeatedFromHistory: false,
  }));
  const highlights = run.runReport?.highlights ?? [];
  const riskySlideCount = slideCards.filter((slide) => slide.riskLevel !== 'safe').length;
  const bestRecoveryPhrase =
    slideCards.find((slide) => Boolean(slide.bestPhrase))?.bestPhrase
    || run.slideAnalyses.find((analysis) => analysis.bestPhrase)?.bestPhrase
    || 'No recovery phrase captured yet.';

  const metricCards = [
    {
      label: 'Avg pace',
      value: formatMetric(run.avgPaceWpm, ' WPM'),
      detail: run.avgPaceWpm == null ? 'No reading' : run.avgPaceWpm > 170 ? 'Too fast' : run.avgPaceWpm < 105 ? 'Too slow' : 'On pace',
      icon: Gauge,
      iconClass: 'text-sky-400',
    },
    {
      label: 'Avg confidence',
      value: formatMetric(run.avgConfidence, '/100'),
      detail: run.avgConfidence == null ? 'No reading' : run.avgConfidence >= 70 ? 'Strong' : run.avgConfidence >= 50 ? 'Uneven' : 'Fragile',
      icon: TrendingUp,
      iconClass: 'text-emerald-400',
    },
    {
      label: 'Eye contact',
      value: formatMetric(run.eyeContactPct, '%'),
      detail: run.eyeContactPct == null ? 'No reading' : run.eyeContactPct >= 65 ? 'Steady' : 'Needs work',
      icon: Eye,
      iconClass: 'text-cyan-400',
    },
    {
      label: 'Posture',
      value: formatMetric(run.postureGoodPct, '%'),
      detail: run.postureGoodPct == null ? 'No reading' : run.postureGoodPct >= 70 ? 'Stable' : 'Uneven',
      icon: Activity,
      iconClass: 'text-teal-400',
    },
    {
      label: 'Fillers',
      value: `${run.fillerWordCount}`,
      detail: fillerPerMinute == null ? 'No rate' : `${fillerPerMinute.toFixed(1)}/min`,
      icon: MessageSquare,
      iconClass: 'text-amber-400',
    },
    {
      label: 'Coach prompts',
      value: `${run.feedbacks.length}`,
      detail: feedbackPerMinute == null ? 'No rate' : `${feedbackPerMinute.toFixed(1)}/min`,
      icon: Clock3,
      iconClass: 'text-violet-400',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm p-4 md:p-10 overflow-y-auto">
      <div className="max-w-6xl mx-auto rounded-[36px] border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Run Analysis</p>
            <h3 className="text-2xl font-semibold text-zinc-50 mt-1 capitalize">{run.mode} session</h3>
            <p className="text-sm text-zinc-500 mt-1">{formatDate(run.createdAt)}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 md:p-8 space-y-6">
          <section className={`rounded-[32px] border p-6 ${summaryToneClasses(verdict.tone)}`}>
            <div className="grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
              <div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs uppercase tracking-[0.2em] text-zinc-200">
                    {verdict.label}
                  </span>
                  {comparison && (
                    <span className={`text-sm font-medium ${metricTone(comparison.overallScoreDelta)}`}>
                      {formatSigned(comparison.overallScoreDelta, ' pts')} vs previous
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-end gap-4">
                  <div className="text-6xl font-semibold leading-none text-zinc-50">
                    {run.overallScore != null ? Math.round(run.overallScore) : '--'}
                  </div>
                  <div className="pb-1 text-sm text-zinc-300">
                    Overall score
                  </div>
                </div>
                <p className="mt-4 max-w-3xl text-base leading-7 text-zinc-200">
                  {verdict.summary}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Duration</p>
                  <p className="mt-3 text-2xl font-semibold text-zinc-50">{formatDuration(run.duration)}</p>
                </div>
                <div className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Feedback</p>
                  <p className="mt-3 text-2xl font-semibold text-zinc-50">{run.feedbacks.length}</p>
                </div>
                <div className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Risky slides</p>
                  <p className="mt-3 text-2xl font-semibold text-zinc-50">
                    {riskySlideCount}
                  </p>
                </div>
                <div className="rounded-[24px] border border-zinc-800/80 bg-zinc-950/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Best recovery</p>
                  <p className="mt-3 text-sm font-medium text-zinc-200 line-clamp-3">
                    {bestRecoveryPhrase}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {metricCards.map((metric) => {
              const Icon = metric.icon;
              return (
                <article key={metric.label} className="rounded-[28px] border border-zinc-800 bg-zinc-900/60 p-5">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-zinc-400">{metric.label}</div>
                    <Icon className={`w-4 h-4 ${metric.iconClass}`} />
                  </div>
                  <div className="mt-3 text-3xl font-semibold text-zinc-50">{metric.value}</div>
                  <div className="mt-2 text-sm text-zinc-500">{metric.detail}</div>
                </article>
              );
            })}
          </section>

          <section className="grid gap-4 xl:grid-cols-3">
            <article className="rounded-[28px] border border-emerald-500/20 bg-emerald-500/10 p-5">
              <div className="flex items-center gap-2 text-sm text-emerald-200">
                <CheckCircle2 className="w-4 h-4" />
                What Worked
              </div>
              <div className="mt-4 space-y-3">
                {wins.length === 0 ? (
                  <p className="text-sm text-emerald-100/80">The strongest signal here is simply finishing the full run and collecting usable coaching data.</p>
                ) : (
                  wins.map((item) => (
                    <div key={item} className="rounded-2xl bg-black/15 px-4 py-3 text-sm text-emerald-50">
                      {item}
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="rounded-[28px] border border-amber-500/20 bg-amber-500/10 p-5">
              <div className="flex items-center gap-2 text-sm text-amber-200">
                <AlertTriangle className="w-4 h-4" />
                Main Risks
              </div>
              <div className="mt-4 space-y-3">
                {risks.length === 0 ? (
                  <p className="text-sm text-amber-50/80">No single risk dominated this run, so the next improvement is mostly about consistency.</p>
                ) : (
                  risks.map((item) => (
                    <div key={item} className="rounded-2xl bg-black/15 px-4 py-3 text-sm text-amber-50">
                      {item}
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="rounded-[28px] border border-sky-500/20 bg-sky-500/10 p-5">
              <div className="flex items-center gap-2 text-sm text-sky-200">
                <Target className="w-4 h-4" />
                Practice Next
              </div>
              <div className="mt-4 space-y-3">
                {nextSteps.map((item) => (
                  <div key={item} className="rounded-2xl bg-black/15 px-4 py-3 text-sm text-sky-50">
                    {item}
                  </div>
                ))}
              </div>
            </article>
          </section>

          <section className="rounded-[32px] border border-zinc-800 bg-zinc-900/60 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Comparison</p>
                <p className="text-sm text-zinc-500 mt-1">
                  {comparisonRun ? `Against ${formatDate(comparisonRun.createdAt)}` : 'No earlier session of this type yet.'}
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {[
                { label: 'Overall score', value: formatSigned(comparison?.overallScoreDelta ?? null, ' pts') },
                { label: 'Pace', value: formatSigned(comparison?.avgPaceWpmDelta ?? null, ' WPM') },
                { label: 'Confidence', value: formatSigned(comparison?.avgConfidenceDelta ?? null, ' pts') },
                { label: 'Fillers', value: formatSigned(comparison?.fillerWordCountDelta ?? null) },
                { label: 'Eye contact', value: formatSigned(comparison?.eyeContactPctDelta ?? null, '%') },
                { label: 'Posture', value: formatSigned(comparison?.postureGoodPctDelta ?? null, '%') },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">{item.label}</div>
                  <div className={`mt-2 text-lg font-semibold ${item.value.startsWith('+') ? 'text-emerald-300' : item.value.startsWith('-') ? 'text-red-300' : 'text-zinc-50'}`}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {highlights.length > 0 && (
            <section className="rounded-[32px] border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Highlights</p>
              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                {highlights.map((highlight) => (
                  <article key={`${highlight.timestamp}:${highlight.message}`} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs text-zinc-500">{highlight.timestamp}</span>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] ${severityClasses(highlight.severity)}`}>
                          {highlight.type}
                        </span>
                        <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                          {highlight.slideNumber != null ? `Slide ${highlight.slideNumber}` : 'General'}
                        </span>
                      </div>
                    </div>
                    <p className="mt-3 text-sm text-zinc-200 leading-6">{highlight.message}</p>
                  </article>
                ))}
              </div>
            </section>
          )}

          <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <section className="rounded-[32px] border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Session Timeline</p>
              <div className="mt-4 space-y-3 max-h-[560px] overflow-y-auto pr-1">
                {run.feedbacks.length === 0 ? (
                  <div className="rounded-2xl bg-zinc-950/60 px-4 py-3 text-sm text-zinc-400">
                    No live feedback was captured during this session.
                  </div>
                ) : (
                  run.feedbacks.map((feedback) => (
                    <article key={feedback.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="font-mono text-xs text-zinc-500">{feedback.timestamp}</span>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] ${severityClasses(feedback.severity)}`}>
                            {severityLabel(feedback.severity)}
                          </span>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] capitalize ${categoryClasses(feedback.category)}`}>
                            {categoryLabel(feedback.category)}
                          </span>
                          <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                            {feedback.slideNumber != null ? `Slide ${feedback.slideNumber}` : 'General'}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm text-zinc-200 mt-3 leading-6">{feedback.message}</p>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-[32px] border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Slide Map</p>
              <div className="mt-4 space-y-4 max-h-[560px] overflow-y-auto pr-1">
                {slideCards.length === 0 ? (
                  <div className="rounded-2xl bg-zinc-950/60 px-4 py-3 text-sm text-zinc-400">
                    Slide-level analysis will appear here once the rehearsal agent starts saving it.
                  </div>
                ) : (
                  slideCards.map((analysis) => (
                    <article key={`${analysis.slideNumber}:${analysis.slideTitle}`} className="rounded-[28px] border border-zinc-800 bg-zinc-950/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Slide {analysis.slideNumber}</p>
                          <h4 className="text-lg font-semibold text-zinc-100 mt-1">
                            {analysis.slideTitle || slideTitleByNumber.get(analysis.slideNumber) || 'Untitled slide'}
                          </h4>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs capitalize ${riskClasses(analysis.riskLevel)}`}>
                          {analysis.riskLevel}
                        </span>
                      </div>

                      <div className="mt-4 space-y-2">
                        {analysis.issues.length > 0 ? (
                          analysis.issues.map((issue) => (
                          <div key={issue} className="rounded-2xl bg-zinc-900 px-3 py-2 text-sm text-zinc-200">
                              {issue}
                            </div>
                          ))
                        ) : (
                          <div className="rounded-2xl bg-zinc-900 px-3 py-2 text-sm text-zinc-400">No explicit issues logged.</div>
                        )}
                      </div>

                      {analysis.bestPhrase && (
                        <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-200">Best recovery phrase</p>
                          <p className="mt-2 text-sm text-emerald-50 leading-6">"{analysis.bestPhrase}"</p>
                        </div>
                      )}

                      {analysis.repeatedFromHistory && (
                        <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                          This slide has been a repeated weak spot across sessions.
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
