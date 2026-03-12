import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Home } from './components/Home';
import { LandingPage } from './components/LandingPage';
import { RehearsalMode } from './components/RehearsalMode';
import { PresentationMode } from './components/PresentationMode';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import type { GamePlan, ProjectDetails } from './types';

function AppContent() {
  const { user, isLoading } = useAuth();
  const [mode, setMode] = useState<'home' | 'rehearsal' | 'presentation'>('home');
  const [refreshToken, setRefreshToken] = useState(0);
  const [activeProject, setActiveProject] = useState<ProjectDetails | null>(null);
  const [activeGamePlan, setActiveGamePlan] = useState<GamePlan | null>(null);

  const goHome = () => {
    setMode('home');
    setRefreshToken((current) => current + 1);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <LoaderCircle className="w-8 h-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  return (
    <div className="h-full bg-zinc-950 text-zinc-50 font-sans selection:bg-indigo-500/30">
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

const isElectronMac = window.squaredElectron?.platform === 'darwin';

function TitleBarDragRegion() {
  if (!isElectronMac) return null;
  return (
    <div
      className="fixed top-0 inset-x-0 z-[60] bg-zinc-950"
      style={{ WebkitAppRegion: 'drag', height: 38 } as React.CSSProperties}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <TitleBarDragRegion />
      {isElectronMac ? (
        <div className="h-screen flex flex-col" style={{ paddingTop: 38 }}>
          <div className="flex-1 min-h-0">
            <AppContent />
          </div>
        </div>
      ) : (
        <AppContent />
      )}
    </AuthProvider>
  );
}
