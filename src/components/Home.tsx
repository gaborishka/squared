import { Mic, Presentation, ChevronRight, ActivitySquare } from 'lucide-react';
import { motion } from 'motion/react';

export function Home({ onSelectMode }: { onSelectMode: (mode: 'rehearsal' | 'presentation' | 'dashboard') => void }) {
  return (
    <div className="max-w-5xl mx-auto px-6 py-24">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-16"
      >
        <img src="/logo-squared-v5.svg" alt="Squared logo" className="h-24 md:h-32 w-auto mx-auto mb-6" />
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-4">Squared</h1>
        <p className="text-xl text-zinc-400">AI-powered real-time speech coaching.</p>
      </motion.div>

      <div className="grid md:grid-cols-2 gap-6">
        <button
          onClick={() => onSelectMode('rehearsal')}
          className="group relative bg-zinc-900 border border-zinc-800 rounded-3xl p-8 hover:bg-zinc-800/50 transition-colors text-left overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <Mic className="w-10 h-10 text-indigo-400 mb-6" />
          <h2 className="text-2xl font-semibold mb-2">Rehearsal Mode</h2>
          <p className="text-zinc-400 mb-8">Practice with a live AI coach that interrupts and guides you with voice feedback.</p>
          <div className="flex items-center text-indigo-400 font-medium">
            Start Rehearsing <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </button>

        <button
          onClick={() => onSelectMode('presentation')}
          className="group relative bg-zinc-900 border border-zinc-800 rounded-3xl p-8 hover:bg-zinc-800/50 transition-colors text-left overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <Presentation className="w-10 h-10 text-emerald-400 mb-6" />
          <h2 className="text-2xl font-semibold mb-2">Presentation Mode</h2>
          <p className="text-zinc-400 mb-8">Get silent, real-time visual cues during your actual presentation or video call.</p>
          <div className="flex items-center text-emerald-400 font-medium">
            Start Presenting <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </button>

        <button
          onClick={() => onSelectMode('dashboard')}
          className="group relative bg-zinc-900 border border-zinc-800 rounded-3xl p-8 hover:bg-zinc-800/50 transition-colors text-left overflow-hidden md:col-span-2"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <ActivitySquare className="w-10 h-10 text-amber-400 mb-6" />
          <h2 className="text-2xl font-semibold mb-2">Session History</h2>
          <p className="text-zinc-400 mb-8">Review the feedback from your past rehearsals and presentations.</p>
          <div className="flex items-center text-amber-400 font-medium">
            View Dashboard <ChevronRight className="w-4 h-4 ml-1 group-hover:translate-x-1 transition-transform" />
          </div>
        </button>
      </div>
    </div>
  );
}
