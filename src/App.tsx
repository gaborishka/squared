import { useState } from 'react';
import { Home } from './components/Home';
import { RehearsalMode } from './components/RehearsalMode';
import { PresentationMode } from './components/PresentationMode';

export default function App() {
  const [mode, setMode] = useState<'home' | 'rehearsal' | 'presentation'>('home');

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-indigo-500/30">
      {mode === 'home' && <Home onSelectMode={setMode} />}
      {mode === 'rehearsal' && <RehearsalMode onBack={() => setMode('home')} />}
      {mode === 'presentation' && <PresentationMode onBack={() => setMode('home')} />}
    </div>
  );
}
