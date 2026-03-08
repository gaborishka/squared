import { MessageSquare, AlertCircle } from 'lucide-react';
import { IndicatorData } from '../types';

export function Indicators({ data }: { data: IndicatorData }) {
    const fillerCount = data.fillerWords?.total ?? 0;

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Current slide</div>
                    <div className="mt-2 text-2xl font-semibold text-zinc-100">{data.currentSlide ?? '--'}</div>
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">Agent mode</div>
                    <div className="mt-2 text-lg font-semibold text-zinc-100 capitalize">{data.agentMode}</div>
                </div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center text-sm text-zinc-400">
                    <MessageSquare className="w-4 h-4 mr-2" /> Filler Words
                </div>
                <div className="text-zinc-100 font-medium bg-zinc-950 px-4 py-3 rounded-xl border border-zinc-800 text-3xl flex items-center justify-between">
                    <span>{fillerCount}</span>
                    {fillerCount > 0 && <span className="text-sm text-amber-500 font-normal">Needs attention</span>}
                </div>
            </div>

            {data.feedbackMessage && (
                <div className="space-y-2">
                    <div className="flex items-center text-sm text-zinc-400">
                        <AlertCircle className="w-4 h-4 mr-2" /> Latest Feedback
                    </div>
                    <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-indigo-300 text-sm leading-relaxed">
                        "{data.feedbackMessage}"
                    </div>
                </div>
            )}

            {(data.microPrompt || data.rescueText) && (
                <div className="space-y-2">
                    <div className="flex items-center text-sm text-zinc-400">
                        <AlertCircle className="w-4 h-4 mr-2" /> Live Cue
                    </div>
                    <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-100 text-sm leading-relaxed">
                        <div className="font-semibold">{data.microPrompt || 'Stay steady'}</div>
                        {data.rescueText && <div className="mt-2 text-emerald-50/90">{data.rescueText}</div>}
                    </div>
                </div>
            )}
        </div>
    );
}
