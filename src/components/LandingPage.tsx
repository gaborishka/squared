import { ArrowRight, Brain, Mic, Presentation } from 'lucide-react';
import { motion } from 'motion/react';
import squaredIcon from '../../squared_icon.png';
import { api } from '../api/client';
import { ParticleBackground } from './ParticleBackground';

export function LandingPage() {
  const isElectronApp = Boolean(window.squaredElectron?.isElectron);
  const authBaseUrl = api.getAuthBaseUrl() || window.location.origin;
  const authUrl = `${authBaseUrl}/api/auth/google${isElectronApp ? '?platform=desktop' : ''}`;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex flex-col overflow-hidden relative">
      {/* Particle network background */}
      <div className="absolute inset-0">
        <ParticleBackground className="absolute inset-0 w-full h-full" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center gap-3 px-8 py-6">
        <img src={squaredIcon} alt="Squared" className="h-10 w-10" />
        <span className="text-xl font-bold tracking-tight text-zinc-100">squared</span>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 relative z-10 -mt-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="text-center max-w-3xl w-full"
        >
          {/* Headline */}
          <h1 className="text-6xl lg:text-8xl font-extrabold tracking-tight leading-[1.05]">
            <span className="bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-transparent">
              Nail every
            </span>
            <br />
            <span className="bg-[linear-gradient(135deg,#818cf8_0%,#a78bfa_40%,#34d399_100%)] bg-clip-text text-transparent">
              presentation
            </span>
          </h1>

          <p className="text-lg text-zinc-500 mt-4 leading-relaxed">
            Your AI presentation navigator — from first rehearsal to final stage.
          </p>

          {/* Feature strip */}
          <div className="mt-8 flex items-stretch rounded-2xl border border-zinc-800/60 bg-zinc-900/40 backdrop-blur-sm overflow-hidden">
            <div className="flex-1 flex items-center gap-3 px-5 py-4 group/cell cursor-default hover:bg-indigo-500/[0.08] transition-all duration-300">
              <Mic className="w-4.5 h-4.5 text-indigo-400 shrink-0 group-hover/cell:drop-shadow-[0_0_6px_rgba(129,140,248,0.6)] transition-all duration-300" />
              <div className="text-left">
                <div className="text-sm font-medium text-zinc-200 group-hover/cell:text-indigo-200 transition-colors duration-300">Rehearse</div>
                <div className="text-xs text-zinc-500 group-hover/cell:text-zinc-400 transition-colors duration-300">Live voice & vision coaching</div>
              </div>
            </div>
            <div className="w-px bg-zinc-800/60" />
            <div className="flex-1 flex items-center gap-3 px-5 py-4 group/cell cursor-default hover:bg-emerald-500/[0.08] transition-all duration-300">
              <Presentation className="w-4.5 h-4.5 text-emerald-400 shrink-0 group-hover/cell:drop-shadow-[0_0_6px_rgba(52,211,153,0.6)] transition-all duration-300" />
              <div className="text-left">
                <div className="text-sm font-medium text-zinc-200 group-hover/cell:text-emerald-200 transition-colors duration-300">Present</div>
                <div className="text-xs text-zinc-500 group-hover/cell:text-zinc-400 transition-colors duration-300">AI game plan & silent HUD</div>
              </div>
            </div>
            <div className="w-px bg-zinc-800/60" />
            <div className="flex-1 flex items-center gap-3 px-5 py-4 group/cell cursor-default hover:bg-violet-500/[0.08] transition-all duration-300">
              <Brain className="w-4.5 h-4.5 text-violet-400 shrink-0 group-hover/cell:drop-shadow-[0_0_6px_rgba(167,139,250,0.6)] transition-all duration-300" />
              <div className="text-left">
                <div className="text-sm font-medium text-zinc-200 group-hover/cell:text-violet-200 transition-colors duration-300">Improve</div>
                <div className="text-xs text-zinc-500 group-hover/cell:text-zinc-400 transition-colors duration-300">Learns from every session</div>
              </div>
            </div>
          </div>

          {/* CTA */}
          <a
            href={authUrl}
            onClick={(e) => {
              if (isElectronApp) {
                e.preventDefault();
                window.squaredElectron.openExternalAuth(authUrl);
              }
            }}
            className="group mt-8 inline-flex items-center gap-3 rounded-2xl bg-white px-7 py-3.5 text-[17px] font-semibold text-zinc-900 hover:bg-zinc-100 transition-all duration-200 shadow-lg shadow-white/10 hover:shadow-xl hover:shadow-white/20 hover:scale-[1.02] active:scale-[0.98]"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Get started with Google
            <ArrowRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
          </a>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 text-center py-5 text-sm text-zinc-700">
        Powered by Google Gemini
      </footer>
    </div>
  );
}
