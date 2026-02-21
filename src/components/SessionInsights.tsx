import { MutableRefObject } from 'react';
import { OverallScoreRing } from './OverallScoreRing';
import { AudioWaveform } from './AudioWaveform';
import { FillerWordsBubbles } from './FillerWordsBubbles';
import { FeedbackTimeline, FeedbackItem } from './FeedbackTimeline';
import { ShieldAlert, ShieldCheck, Shield } from 'lucide-react';
import { IndicatorData } from '../types';

interface SessionInsightsProps {
    data: IndicatorData;
    feedbackHistory: FeedbackItem[];
    analyserRef?: MutableRefObject<AnalyserNode | null>;
}

export function SessionInsights({ data, feedbackHistory, analyserRef }: SessionInsightsProps) {
    // Safe defaults if data is missing during initial updates
    const overallScore = data.overallScore ?? 0;
    const volumeLevel = data.volumeLevel ?? 'Good';
    const confidenceScore = data.confidenceScore ?? 0;
    const fillerWords = data.fillerWords ?? { total: 0, breakdown: {} };

    const getConfidenceIcon = () => {
        if (confidenceScore >= 70) return <ShieldCheck className="w-5 h-5 text-emerald-500" />;
        if (confidenceScore >= 40) return <ShieldAlert className="w-5 h-5 text-amber-500" />;
        return <Shield className="w-5 h-5 text-red-500" />;
    };

    const getConfidenceColor = () => {
        if (confidenceScore >= 70) return 'bg-emerald-500';
        if (confidenceScore >= 40) return 'bg-amber-500';
        return 'bg-red-500';
    };

    return (
        <div className="flex flex-col h-full space-y-6">

            {/* Overall Score */}
            <div className="flex flex-col items-center justify-center py-2">
                <OverallScoreRing score={overallScore} />
            </div>

            {/* Metric Cards (2-column layout) */}
            <div className="grid grid-cols-2 gap-3">
                {/* Volume Card */}
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 flex flex-col justify-between h-20">
                    <span className="text-xs font-medium text-zinc-400">Volume</span>
                    <div className="flex items-end justify-between">
                        <span className="text-sm font-semibold text-zinc-200">{volumeLevel}</span>
                        <AudioWaveform volumeLevel={volumeLevel} analyserRef={analyserRef} />
                    </div>
                </div>

                {/* Confidence Card */}
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 flex flex-col justify-between h-20 relative overflow-hidden group">
                    <div className="flex justify-between items-center z-10">
                        <span className="text-xs font-medium text-zinc-400">Confidence</span>
                        {getConfidenceIcon()}
                    </div>
                    <div className="flex items-end justify-between z-10 mt-2">
                        <div className="flex items-baseline space-x-1">
                            <span className="text-2xl font-bold text-zinc-200 leading-none">{confidenceScore}</span>
                            <span className="text-[10px] text-zinc-500 font-medium">/100</span>
                        </div>
                    </div>
                    {/* Progress Bar Background */}
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-800/50" />
                    {/* Subdued Progress Bar Fill */}
                    <div
                        className={`absolute bottom-0 left-0 h-1 ${getConfidenceColor()} opacity-80 group-hover:opacity-100 transition-all duration-500 ease-out`}
                        style={{ width: `${confidenceScore}%` }}
                    />
                </div>
            </div>

            {/* Filler Words */}
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                <h4 className="text-sm font-medium text-zinc-400 mb-3 flex items-center justify-between">
                    <span>Filler Words</span>
                    <span className="text-xs bg-zinc-800 px-2 py-0.5 rounded-full text-zinc-300">Total: {fillerWords.total}</span>
                </h4>
                <FillerWordsBubbles fillerWords={fillerWords} />
            </div>

            {/* Coach Feedback */}
            <div className="flex flex-col flex-1 min-h-0 bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                <h4 className="text-sm font-medium text-zinc-400 mb-3 block">Coach Feedback</h4>
                <FeedbackTimeline feedbackHistory={feedbackHistory} />
            </div>

        </div>
    );
}
