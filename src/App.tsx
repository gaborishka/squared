import { useState } from 'react';
import { Home } from './components/Home';
import { RehearsalMode } from './components/RehearsalMode';
import { PresentationMode } from './components/PresentationMode';
import { Dashboard } from './components/Dashboard';
import { ErrorBoundary } from './components/ErrorBoundary';

export default function App() {
  const [mode, setMode] = useState<'home' | 'rehearsal' | 'presentation' | 'dashboard'>('home');
  const goHome = () => setMode('home');

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-indigo-500/30">
      {mode === 'home' && <Home onSelectMode={setMode} />}
      {mode === 'rehearsal' && (
        <ErrorBoundary onBack={goHome}>
          <RehearsalMode onBack={goHome} onSessionEnd={() => setMode('dashboard')} />
        </ErrorBoundary>
      )}
      {mode === 'presentation' && (
        <ErrorBoundary onBack={goHome}>
          <PresentationMode onBack={goHome} onSessionEnd={() => setMode('dashboard')} />
        </ErrorBoundary>
      )}
      {mode === 'dashboard' && (
        <ErrorBoundary onBack={goHome}>
          <Dashboard onBack={goHome} />
        </ErrorBoundary>
      )}
    </div>
  );
}
