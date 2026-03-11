import { Eye, Mic, User, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface FeedbackItem {
    id: string;
    timestamp: string; // "mm:ss"
    message: string;
}

function getIconForMessage(message: string) {
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.match(/eye|look|contact|stare|visual/)) return <Eye className="w-3.5 h-3.5" />;
    if (lowerMsg.match(/volume|loud|quiet|pace|fast|slow|speed|voice|speak/)) return <Mic className="w-3.5 h-3.5" />;
    if (lowerMsg.match(/posture|slouch|straight|back|sit/)) return <User className="w-3.5 h-3.5" />;
    return <MessageSquare className="w-3.5 h-3.5" />;
}

function getAccentColor(message: string): string {
    const l = message.toLowerCase();
    if (l.match(/great|good|excellent|perfect|well done|spot on|awesome/)) return 'text-emerald-500';
    if (l.match(/too (fast|slow|quiet|loud)|try|maybe|slight|could be|away/)) return 'text-amber-500';
    if (l.match(/slouch|stop|very (fast|slow|quiet|loud)|barely|cannot|poor/)) return 'text-red-500';
    return 'text-indigo-400';
}

export function FeedbackTimeline({ feedbackHistory }: { feedbackHistory: FeedbackItem[] }) {
    if (feedbackHistory.length === 0) {
        return <p className="text-zinc-600 text-xs italic py-2">Waiting for coach feedback...</p>;
    }

    return (
        <div className="flex-1 overflow-y-auto space-y-2 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
            <AnimatePresence>
                {feedbackHistory.map((item) => (
                    <motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex gap-2.5 group"
                    >
                        <div className={`shrink-0 mt-0.5 ${getAccentColor(item.message)}`}>
                            {getIconForMessage(item.message)}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-xs text-zinc-300 leading-snug">{item.message}</p>
                            <span className="text-[10px] text-zinc-600 font-mono">{item.timestamp}</span>
                        </div>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
