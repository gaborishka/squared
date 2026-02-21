import { Eye, Mic, User, MessageSquare } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface FeedbackItem {
    id: string;
    timestamp: string; // "mm:ss"
    message: string;
}

function getIconForMessage(message: string) {
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.match(/eye|look|contact|stare|visual/)) return <Eye className="w-4 h-4" />;
    if (lowerMsg.match(/volume|loud|quiet|pace|fast|slow|speed|voice|speak/)) return <Mic className="w-4 h-4" />;
    if (lowerMsg.match(/posture|slouch|straight|back|sit/)) return <User className="w-4 h-4" />;
    return <MessageSquare className="w-4 h-4" />;
}

function getColorForMessage(message: string) {
    const lowerMsg = message.toLowerCase();
    // Positive
    if (lowerMsg.match(/great|good|excellent|perfect|well done|spot on|awesome/)) return 'border-emerald-500';
    // Warnings / Corrective
    if (lowerMsg.match(/too (fast|slow|quiet|loud)|try|maybe|slight|could be|away/)) return 'border-amber-500';
    // Critical / Bad
    if (lowerMsg.match(/slouch|stop|very (fast|slow|quiet|loud)|barely|cannot|poor/)) return 'border-red-500';
    // Default
    return 'border-indigo-500';
}

export function FeedbackTimeline({ feedbackHistory }: { feedbackHistory: FeedbackItem[] }) {
    if (feedbackHistory.length === 0) {
        return <div className="text-zinc-500 text-sm italic py-4">Waiting for coach feedback...</div>;
    }

    return (
        <div className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
            <AnimatePresence>
                {feedbackHistory.map((item) => (
                    <motion.div
                        key={item.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`flex flex-col bg-zinc-900/50 p-3 rounded-xl border-l-4 border-y border-r border-y-zinc-800 border-r-zinc-800 ${getColorForMessage(item.message)}`}
                    >
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-mono text-zinc-500">{item.timestamp}</span>
                            <div className="text-zinc-400">{getIconForMessage(item.message)}</div>
                        </div>
                        <p className="text-sm text-zinc-300 leading-snug">{item.message}</p>
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}
