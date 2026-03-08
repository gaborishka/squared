import { Activity, Clock3, MessageSquare, TrendingUp, X } from 'lucide-react';
import type { RunDetails, RunSummary } from '../types';

interface RunAnalysisProps {
  run: RunDetails;
  comparisonRun?: RunSummary | null;
  onClose: () => void;
}

function formatDuration(duration: number): string {
  const totalSeconds = Math.floor(duration / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function RunAnalysis({ run, comparisonRun, onClose }: RunAnalysisProps) {
  const scoreDelta =
    comparisonRun?.overallScore != null && run.overallScore != null
      ? Math.round(run.overallScore - comparisonRun.overallScore)
      : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm p-4 md:p-10 overflow-y-auto">
      <div className="max-w-5xl mx-auto rounded-[36px] border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Run Analysis</p>
            <h3 className="text-2xl font-semibold text-zinc-50 mt-1 capitalize">{run.mode} session</h3>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 md:p-8 space-y-6">
          <div className="grid md:grid-cols-4 gap-4">
            <div className="rounded-[28px] border border-zinc-800 bg-zinc-900/70 p-5">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Activity className="w-4 h-4 text-indigo-400" />
                Overall score
              </div>
              <div className="text-3xl font-semibold text-zinc-50 mt-3">
                {run.overallScore != null ? Math.round(run.overallScore) : '--'}
              </div>
            </div>
            <div className="rounded-[28px] border border-zinc-800 bg-zinc-900/70 p-5">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Clock3 className="w-4 h-4 text-sky-400" />
                Duration
              </div>
              <div className="text-3xl font-semibold text-zinc-50 mt-3">{formatDuration(run.duration)}</div>
            </div>
            <div className="rounded-[28px] border border-zinc-800 bg-zinc-900/70 p-5">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <MessageSquare className="w-4 h-4 text-amber-400" />
                Feedback items
              </div>
              <div className="text-3xl font-semibold text-zinc-50 mt-3">{run.feedbacks.length}</div>
            </div>
            <div className="rounded-[28px] border border-zinc-800 bg-zinc-900/70 p-5">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                Vs previous
              </div>
              <div className="text-3xl font-semibold text-zinc-50 mt-3">
                {scoreDelta == null ? '--' : `${scoreDelta >= 0 ? '+' : ''}${scoreDelta}`}
              </div>
            </div>
          </div>

          <div className="grid xl:grid-cols-[0.95fr_1.05fr] gap-6">
            <section className="rounded-[32px] border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Timeline</p>
              <div className="mt-4 space-y-3 max-h-[480px] overflow-y-auto pr-1">
                {run.feedbacks.length === 0 ? (
                  <div className="rounded-2xl bg-zinc-950/60 px-4 py-3 text-sm text-zinc-400">
                    No live feedback was captured during this session.
                  </div>
                ) : (
                  run.feedbacks.map((feedback) => (
                    <article key={feedback.id} className="rounded-2xl border border-zinc-800 bg-zinc-950/70 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-xs text-zinc-500">{feedback.timestamp}</span>
                        <span className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                          {feedback.slideNumber != null ? `Slide ${feedback.slideNumber}` : 'General'}
                        </span>
                      </div>
                      <p className="text-sm text-zinc-200 mt-2">{feedback.message}</p>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-[32px] border border-zinc-800 bg-zinc-900/60 p-5">
              <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Per-slide breakdown</p>
              <div className="mt-4 space-y-4 max-h-[480px] overflow-y-auto pr-1">
                {run.slideAnalyses.length === 0 ? (
                  <div className="rounded-2xl bg-zinc-950/60 px-4 py-3 text-sm text-zinc-400">
                    Slide-level analysis will appear here once the rehearsal agent starts saving it.
                  </div>
                ) : (
                  run.slideAnalyses.map((analysis) => (
                    <article key={analysis.id} className="rounded-[28px] border border-zinc-800 bg-zinc-950/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Slide {analysis.slideNumber}</p>
                          <h4 className="text-lg font-semibold text-zinc-100 mt-1 capitalize">{analysis.riskLevel}</h4>
                        </div>
                        {analysis.bestPhrase && (
                          <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
                            Best phrase captured
                          </span>
                        )}
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
                        <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                          "{analysis.bestPhrase}"
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
