export function FillerWordsBubbles({ fillerWords }: { fillerWords: { total: number, breakdown: Record<string, number> } }) {
    if (!fillerWords || fillerWords.total === 0) {
        return <div className="text-zinc-500 text-sm italic">No filler words detected yet. Great job!</div>;
    }

    return (
        <div className="flex flex-wrap gap-2">
            {Object.entries(fillerWords.breakdown).map(([word, count]) => {
                let colors = 'border-zinc-700 text-zinc-400';
                if (count >= 5) {
                    colors = 'bg-red-500/20 text-red-400 border-red-500/30';
                } else if (count >= 3) {
                    colors = 'bg-amber-500/20 text-amber-400 border-amber-500/30';
                }

                return (
                    <div
                        key={word}
                        className={`group relative px-3 py-1 rounded-full border text-sm transition-all hover:scale-105 cursor-default ${colors}`}
                    >
                        {word}
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-zinc-800 text-zinc-200 text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                            Count: {count}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
