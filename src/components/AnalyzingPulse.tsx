import { motion } from 'framer-motion';

export function AnalyzingPulse() {
    return (
        <div className="flex flex-col items-center justify-center h-full text-zinc-400">
            <div className="relative w-32 h-32 flex items-center justify-center mb-6">
                {[...Array(3)].map((_, i) => (
                    <motion.div
                        key={i}
                        className="absolute rounded-full border border-indigo-500/30"
                        initial={{ width: 40, height: 40, opacity: 1 }}
                        animate={{ width: 120, height: 120, opacity: 0 }}
                        transition={{
                            duration: 2,
                            repeat: Infinity,
                            ease: "easeOut",
                            delay: i * 0.6,
                        }}
                    />
                ))}
                <div className="w-10 h-10 bg-indigo-500/20 rounded-full flex items-center justify-center backdrop-blur-md border border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.5)]">
                    <div className="w-4 h-4 bg-indigo-400 rounded-full animate-pulse" />
                </div>
            </div>
            <p className="text-sm font-medium animate-pulse text-indigo-300">Analyzing your speech and presence...</p>
        </div>
    );
}
