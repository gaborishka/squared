import { MutableRefObject } from 'react';
import { OverallScoreRing } from './OverallScoreRing';
import { AudioWaveform } from './AudioWaveform';
import { FillerWordsBubbles } from './FillerWordsBubbles';
import { FeedbackTimeline, FeedbackItem } from './FeedbackTimeline';
import { ShieldCheck, ShieldAlert, Shield } from 'lucide-react';
import { IndicatorData } from '../types';

interface SessionInsightsProps {
    data: IndicatorData;
    feedbackHistory: FeedbackItem[];
    analyserRef?: MutableRefObject<AnalyserNode | null>;
}

export function SessionInsights({ data, feedbackHistory, analyserRef }: SessionInsightsProps) {
    const overallScore = data.overallScore ?? 0;
    const volumeLevel = data.volumeLevel ?? 'Good';
    const confidenceScore = data.confidenceScore ?? 0;
    const fillerWords = data.fillerWords ?? { total: 0, breakdown: {} };

    const confidenceColor = confidenceScore >= 70 ? 'text-emerald-400' : confidenceScore >= 40 ? 'text-amber-400' : 'text-red-400';
    const confidenceBarColor = confidenceScore >= 70 ? 'bg-emerald-500' : confidenceScore >= 40 ? 'bg-amber-500' : 'bg-red-500';
    const confidenceIcon = confidenceScore >= 70
        ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        : confidenceScore >= 40
            ? <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
            : <Shield className="w-3.5 h-3.5 text-red-500" />;

    return (
        <div className="flex flex-col h-full gap-4">
            {/* Hero score */}
            <div className="flex justify-center py-1">
                <OverallScoreRing score={overallScore} size={88} />
            </div>

            {/* Metrics row */}
            <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-zinc-950/60 px-3 py-2.5">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-600">Volume</span>
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                        <span className="text-sm font-semibold text-zinc-200">{volumeLevel}</span>
                        <AudioWaveform volumeLevel={volumeLevel} analyserRef={analyserRef} />
                    </div>
                </div>
                <div className="rounded-xl bg-zinc-950/60 px-3 py-2.5 relative overflow-hidden">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-600">Confidence</span>
                        {confidenceIcon}
                    </div>
                    <div className="flex items-baseline gap-1 mt-1.5">
                        <span className={`text-xl font-bold leading-none ${confidenceColor}`}>{confidenceScore}</span>
                        <span className="text-[10px] text-zinc-600">/100</span>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-zinc-800/40" />
                    <div
                        className={`absolute bottom-0 left-0 h-[2px] ${confidenceBarColor} transition-all duration-500`}
                        style={{ width: `${confidenceScore}%` }}
                    />
                </div>
            </div>

            {/* Filler words */}
            {fillerWords.total > 0 && (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-600">Filler words</span>
                        <span className="text-[10px] text-zinc-500 tabular-nums">{fillerWords.total}</span>
                    </div>
                    <FillerWordsBubbles fillerWords={fillerWords} />
                </div>
            )}

            {/* Feedback — fills rest */}
            <div className="flex flex-col flex-1 min-h-0">
                <span className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2 block">Coach feedback</span>
                <FeedbackTimeline feedbackHistory={feedbackHistory} />
            </div>
        </div>
    );
}
