import { useState } from 'react';
import { Home } from './components/Home';
import { RehearsalMode } from './components/RehearsalMode';
import { PresentationMode } from './components/PresentationMode';
import { ErrorBoundary } from './components/ErrorBoundary';
import type { GamePlan, ProjectDetails } from './types';

export default function App() {
  const [mode, setMode] = useState<'home' | 'rehearsal' | 'presentation'>('home');
  const [refreshToken, setRefreshToken] = useState(0);
  const [activeProject, setActiveProject] = useState<ProjectDetails | null>(null);
  const [activeGamePlan, setActiveGamePlan] = useState<GamePlan | null>(null);

  const goHome = () => {
    setMode('home');
    setRefreshToken((current) => current + 1);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-indigo-500/30">
      {mode === 'home' && (
        <Home
          refreshToken={refreshToken}
          onStartRehearsal={(project) => {
            setActiveProject(project);
            setActiveGamePlan(null);
            setMode('rehearsal');
          }}
          onStartPresentation={(project, gamePlan) => {
            setActiveProject(project);
            setActiveGamePlan(gamePlan);
            setMode('presentation');
          }}
        />
      )}
      {mode === 'rehearsal' && (
        <ErrorBoundary onBack={goHome}>
          {activeProject ? (
            <RehearsalMode project={activeProject} onBack={goHome} onSessionEnd={goHome} />
          ) : null}
        </ErrorBoundary>
      )}
      {mode === 'presentation' && (
        <ErrorBoundary onBack={goHome}>
          {activeProject && activeGamePlan ? (
            <PresentationMode
              project={activeProject}
              gamePlan={activeGamePlan}
              onBack={goHome}
              onSessionEnd={goHome}
            />
          ) : null}
        </ErrorBoundary>
      )}
    </div>
  );
}
