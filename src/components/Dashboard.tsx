import { useState, useEffect } from 'react';
import { ArrowLeft, Database, Clock, Calendar, Activity, MessageSquare } from 'lucide-react';
import { RunData, FeedbackData } from '../types/api';

type RunWithFeedbacks = RunData & { created_at: string; feedbacks: FeedbackData[] };

export function Dashboard({ onBack }: { onBack: () => void }) {
    const [runs, setRuns] = useState<RunWithFeedbacks[]>([]);
    const [selectedRun, setSelectedRun] = useState<RunWithFeedbacks | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/runs')
            .then(res => res.json())
            .then(data => {
                setRuns(data);
                if (data.length > 0) setSelectedRun(data[0]);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load runs:', err);
                setLoading(false);
            });
    }, []);

    const formatDuration = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleString();
    };

    return (
        <div className="h-screen flex flex-col bg-zinc-950">
            <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-950/50 backdrop-blur-md shrink-0">
                <button onClick={onBack} className="flex items-center text-zinc-400 hover:text-white transition-colors">
                    <ArrowLeft className="w-5 h-5 mr-2" /> Back to Home
                </button>
                <div className="flex items-center space-x-2">
                    <Database className="w-5 h-5 text-indigo-400" />
                    <span className="text-sm font-medium text-zinc-300">Session History</span>
                </div>
            </header>

            <main className="flex-1 overflow-hidden flex flex-col md:flex-row p-6 gap-6">
                {/* Sidebar List */}
                <div className="w-full md:w-[320px] bg-zinc-900 border border-zinc-800 rounded-3xl p-4 flex flex-col h-full shrink-0">
                    <h2 className="text-lg font-semibold mb-4 px-2">Recent Sessions</h2>
                    {loading ? (
                        <div className="flex-1 flex items-center justify-center text-zinc-500">Loading...</div>
                    ) : runs.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center text-zinc-500">No sessions recorded.</div>
                    ) : (
                        <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                            {runs.map(run => (
                                <button
                                    key={run.id}
                                    onClick={() => setSelectedRun(run)}
                                    className={`w-full text-left p-4 rounded-xl transition-all ${selectedRun?.id === run.id
                                            ? 'bg-indigo-500/10 border-indigo-500/30 ring-1 ring-indigo-500/50'
                                            : 'bg-zinc-800/50 border-transparent hover:bg-zinc-800'
                                        } border`}
                                >
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="font-medium text-zinc-200 capitalize">{run.mode}</span>
                                        <span className="text-xs text-zinc-500">{formatDuration(run.duration)}</span>
                                    </div>
                                    <div className="text-xs text-zinc-500 flex items-center">
                                        <Calendar className="w-3 h-3 mr-1" />
                                        {formatDate(run.created_at)}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Detail View */}
                <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex flex-col h-full overflow-hidden">
                    {selectedRun ? (
                        <>
                            <div className="mb-8 border-b border-zinc-800 pb-6 shrink-0">
                                <div className="flex items-center space-x-3 mb-2">
                                    <Activity className="w-6 h-6 text-indigo-400" />
                                    <h2 className="text-2xl font-semibold capitalize">{selectedRun.mode} Session</h2>
                                </div>
                                <div className="flex gap-4 text-sm text-zinc-400">
                                    <div className="flex items-center">
                                        <Calendar className="w-4 h-4 mr-1.5" />
                                        {formatDate(selectedRun.created_at)}
                                    </div>
                                    <div className="flex items-center">
                                        <Clock className="w-4 h-4 mr-1.5" />
                                        {formatDuration(selectedRun.duration)} duration
                                    </div>
                                    <div className="flex items-center">
                                        <MessageSquare className="w-4 h-4 mr-1.5" />
                                        {selectedRun.feedbacks.length} insights
                                    </div>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto pr-2">
                                <h3 className="text-lg font-medium mb-4 text-zinc-300">Feedback Timeline</h3>
                                {selectedRun.feedbacks.length === 0 ? (
                                    <div className="text-zinc-500 p-4 bg-zinc-800/30 rounded-xl">No feedback recorded during this session.</div>
                                ) : (
                                    <div className="space-y-4">
                                        {selectedRun.feedbacks.map((fb, i) => (
                                            <div key={i} className="flex gap-4 p-4 rounded-xl bg-zinc-800/40 border border-zinc-700/30 group hover:border-zinc-600/50 transition-colors">
                                                <div className="text-xs font-mono text-zinc-500 bg-zinc-950 px-2 py-1 rounded-md h-fit mt-1 border border-zinc-800 group-hover:text-indigo-400 transition-colors">
                                                    {fb.timestamp}
                                                </div>
                                                <p className="text-zinc-300 leading-relaxed max-w-3xl">
                                                    {fb.message}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 flex items-center justify-center text-zinc-500 flex-col gap-4">
                            <Database className="w-12 h-12 opacity-20" />
                            <p>Select a session to view its details</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
