import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Clock3, FilePenLine, LoaderCircle, Mic, Plus, Presentation, Sparkles } from 'lucide-react';
import { api } from '../api/client';
import type { GamePlan, ProjectAnalysis, ProjectDetails, RunDetails, RunSummary } from '../types';
import { GamePlanView } from './GamePlanView';
import { ProjectList } from './ProjectList';
import { ProjectSetup } from './ProjectSetup';
import { RunAnalysis } from './RunAnalysis';

interface HomeProps {
  refreshToken: number;
  onStartRehearsal: (project: ProjectDetails) => void;
  onStartPresentation: (project: ProjectDetails, gamePlan: GamePlan) => void;
}

export function Home({ refreshToken, onStartRehearsal, onStartPresentation }: HomeProps) {
  const [projects, setProjects] = useState<ProjectDetails[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectRuns, setProjectRuns] = useState<RunSummary[]>([]);
  const [projectAnalysis, setProjectAnalysis] = useState<ProjectAnalysis | null>(null);
  const [latestGamePlan, setLatestGamePlan] = useState<GamePlan | null>(null);
  const [setupProject, setSetupProject] = useState<ProjectDetails | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [selectedRun, setSelectedRun] = useState<RunDetails | null>(null);
  const [gamePlanOpen, setGamePlanOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const summaries = await api.listProjects();
      const details = await Promise.all(summaries.map((project) => api.getProject(project.id)));
      setProjects(details);
      setSelectedProjectId((current) => current ?? details[0]?.id ?? null);
    } catch (loadError) {
      console.error(loadError);
      setError('Could not load projects from the backend.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadSelectedProjectData = useCallback(async (projectId: string) => {
    try {
      const [project, runs, analysis] = await Promise.all([
        api.getProject(projectId),
        api.listRuns(projectId),
        api.getProjectAnalysis(projectId),
      ]);
      setProjects((current) => {
        const next = current.filter((item) => item.id !== projectId);
        return [project, ...next].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      });
      setProjectRuns(runs);
      setProjectAnalysis(analysis);
      setLatestGamePlan(analysis.latestGamePlan);
    } catch (loadError) {
      console.error(loadError);
      setError('Could not load project details.');
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects, refreshToken]);

  useEffect(() => {
    if (!selectedProjectId) {
      setProjectRuns([]);
      setProjectAnalysis(null);
      setLatestGamePlan(null);
      return;
    }
    void loadSelectedProjectData(selectedProjectId);
  }, [selectedProjectId, loadSelectedProjectData]);

  const handleSavedProject = async (project: ProjectDetails) => {
    setProjects((current) => {
      const next = current.filter((item) => item.id !== project.id);
      return [project, ...next].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
    setSelectedProjectId(project.id);
    await loadSelectedProjectData(project.id);
  };

  const handleDeleteProject = async () => {
    if (!selectedProject) return;
    try {
      await api.deleteProject(selectedProject.id);
      setProjects((current) => current.filter((project) => project.id !== selectedProject.id));
      setSelectedProjectId((current) => (current === selectedProject.id ? null : current));
      setProjectRuns([]);
      setProjectAnalysis(null);
      setLatestGamePlan(null);
    } catch (deleteError) {
      console.error(deleteError);
      setError('Could not delete the project.');
    }
  };

  const handleOpenRun = async (runId: string) => {
    try {
      const run = await api.getRun(runId);
      setSelectedRun(run);
    } catch (runError) {
      console.error(runError);
      setError('Could not load run analysis.');
    }
  };

  const handlePreparePresentation = async () => {
    if (!selectedProject) return;
    setGamePlanOpen(true);
    const rehearsalRunCount = projectAnalysis?.rehearsalRuns ?? 0;
    const isLatestPlanCurrent =
      latestGamePlan != null &&
      latestGamePlan.runCount >= rehearsalRunCount;
    if (isLatestPlanCurrent) return;
    setIsGeneratingPlan(true);
    try {
      const plan = await api.generateGamePlan(selectedProject.id);
      setLatestGamePlan(plan);
      setProjectAnalysis((current) => (current ? { ...current, latestGamePlan: plan } : current));
    } catch (planError) {
      console.error(planError);
      setError('Could not generate a game plan yet. Try after at least one rehearsal.');
      setGamePlanOpen(false);
    } finally {
      setIsGeneratingPlan(false);
    }
  };

  const comparisonRun = selectedRun
    ? projectRuns.find((run) => run.id !== selectedRun.id && run.mode === selectedRun.mode)
    : null;

  return (
    <>
      <div className="max-w-[1500px] mx-auto px-4 md:px-6 py-6 md:py-8">
        <div className="rounded-[40px] border border-zinc-800 bg-zinc-950/70 p-6 md:p-8 shadow-[0_32px_120px_rgba(0,0,0,0.45)]">
          <div className="flex flex-col xl:flex-row gap-6">
            <ProjectList
              projects={projects}
              selectedProjectId={selectedProjectId}
              onSelectProject={setSelectedProjectId}
              onCreateProject={() => {
                setSetupProject(null);
                setSetupOpen(true);
              }}
            />

            <section className="flex-1 min-w-0 space-y-6">
              <div className="rounded-[32px] border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-950 to-zinc-900 p-6 md:p-8">
                <img src="/logo-squared-v5.svg" alt="Squared logo" className="h-14 w-auto mb-5" />
                <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
                  <div className="max-w-3xl">
                    <p className="text-xs uppercase tracking-[0.28em] text-zinc-500">Squared v2</p>
                    <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-zinc-50 mt-2">
                      Project-centric rehearsal and presentation coaching.
                    </h1>
                    <p className="text-lg text-zinc-400 mt-4">
                      Upload the deck, rehearse against the real structure, and carry forward risk-aware cues into presentation mode.
                    </p>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3 min-w-[280px]">
                    <button
                      onClick={() => {
                        setSetupProject(null);
                        setSetupOpen(true);
                      }}
                      className="rounded-[24px] border border-zinc-800 bg-zinc-900 px-5 py-4 text-left hover:border-zinc-700 transition-colors"
                    >
                      <Plus className="w-5 h-5 text-indigo-400" />
                      <p className="text-base font-semibold text-zinc-100 mt-3">New project</p>
                      <p className="text-sm text-zinc-400 mt-1">Create a deck, upload slides, and add speaker notes.</p>
                    </button>
                    <button
                      onClick={handlePreparePresentation}
                      disabled={!selectedProject}
                      className="rounded-[24px] border border-zinc-800 bg-zinc-900 px-5 py-4 text-left hover:border-zinc-700 transition-colors disabled:opacity-50"
                    >
                      <Sparkles className="w-5 h-5 text-emerald-400" />
                      <p className="text-base font-semibold text-zinc-100 mt-3">Prepare game plan</p>
                      <p className="text-sm text-zinc-400 mt-1">Generate risk-aware cues from rehearsal history.</p>
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <div className="rounded-[28px] border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-200 flex items-center gap-3">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              {isLoading ? (
                <div className="rounded-[32px] border border-zinc-800 bg-zinc-900/60 p-10 text-center text-zinc-400">
                  <LoaderCircle className="w-8 h-8 animate-spin mx-auto mb-4 text-indigo-400" />
                  Loading project workspace…
                </div>
              ) : !selectedProject ? (
                <div className="rounded-[32px] border border-zinc-800 bg-zinc-900/60 p-10 text-center text-zinc-400">
                  Select a project on the left or create a new one to start rehearsing.
                </div>
              ) : (
                <>
                  <div className="rounded-[32px] border border-zinc-800 bg-zinc-900/60 p-6 md:p-8">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                      <div className="max-w-3xl">
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Active project</p>
                        <h2 className="text-3xl font-semibold text-zinc-50 mt-2">{selectedProject.name}</h2>
                        <p className="text-zinc-400 mt-3 text-base whitespace-pre-wrap">
                          {selectedProject.description || 'No project description yet.'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => onStartRehearsal(selectedProject)}
                          className="inline-flex items-center gap-2 rounded-full bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-400 transition-colors"
                        >
                          <Mic className="w-4 h-4" />
                          Rehearse
                        </button>
                        <button
                          onClick={handlePreparePresentation}
                          className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-400 transition-colors"
                        >
                          <Presentation className="w-4 h-4" />
                          Present
                        </button>
                        <button
                          onClick={() => {
                            setSetupProject(selectedProject);
                            setSetupOpen(true);
                          }}
                          className="inline-flex items-center gap-2 rounded-full border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 hover:border-zinc-600"
                        >
                          <FilePenLine className="w-4 h-4" />
                          Edit
                        </button>
                        <button
                          onClick={handleDeleteProject}
                          className="inline-flex items-center gap-2 rounded-full border border-red-500/30 px-5 py-2.5 text-sm font-medium text-red-200 hover:bg-red-500/10"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="grid md:grid-cols-4 gap-4 mt-8">
                      <div className="rounded-[24px] bg-zinc-950/70 border border-zinc-800 px-5 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Slides</p>
                        <div className="text-3xl font-semibold text-zinc-50 mt-3">{selectedProject.slideCount}</div>
                      </div>
                      <div className="rounded-[24px] bg-zinc-950/70 border border-zinc-800 px-5 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Rehearsals</p>
                        <div className="text-3xl font-semibold text-zinc-50 mt-3">{projectAnalysis?.rehearsalRuns ?? 0}</div>
                      </div>
                      <div className="rounded-[24px] bg-zinc-950/70 border border-zinc-800 px-5 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Avg score</p>
                        <div className="text-3xl font-semibold text-zinc-50 mt-3">
                          {Math.round(projectAnalysis?.avgScore ?? 0)}
                        </div>
                      </div>
                      <div className="rounded-[24px] bg-zinc-950/70 border border-zinc-800 px-5 py-4">
                        <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Trend</p>
                        <div className="text-3xl font-semibold text-zinc-50 mt-3 capitalize">
                          {projectAnalysis?.trend ?? 'stable'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid xl:grid-cols-[1.05fr_0.95fr] gap-6">
                    <section className="rounded-[32px] border border-zinc-800 bg-zinc-900/60 p-6">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Slide structure</p>
                          <h3 className="text-2xl font-semibold text-zinc-50 mt-1">Deck preview</h3>
                        </div>
                        <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs text-zinc-300">
                          {selectedProject.fileType ? selectedProject.fileType.toUpperCase() : 'No file'}
                        </span>
                      </div>
                      <div className="mt-5 max-h-[520px] overflow-y-auto pr-1 space-y-4">
                        {selectedProject.slides.length === 0 ? (
                          <div className="rounded-[28px] border border-dashed border-zinc-700 bg-zinc-950/60 p-5 text-sm text-zinc-400">
                            Upload a presentation file to parse slide-by-slide content and speaker notes.
                          </div>
                        ) : (
                          selectedProject.slides.map((slide) => {
                            const slideRisk = projectAnalysis?.slideSummary.find((entry) => entry.slideNumber === slide.slideNumber);
                            return (
                              <article key={slide.id} className="rounded-[28px] border border-zinc-800 bg-zinc-950/70 p-5">
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Slide {slide.slideNumber}</p>
                                    <h4 className="text-lg font-semibold text-zinc-100 mt-1">{slide.title}</h4>
                                  </div>
                                  <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs capitalize text-zinc-300">
                                    {slideRisk?.riskLevel ?? 'safe'}
                                  </span>
                                </div>
                                <p className="text-sm text-zinc-400 mt-3 whitespace-pre-wrap line-clamp-5">{slide.content || 'No content extracted.'}</p>
                                {slide.speakerNotes && (
                                  <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300 whitespace-pre-wrap">
                                    {slide.speakerNotes}
                                  </div>
                                )}
                              </article>
                            );
                          })
                        )}
                      </div>
                    </section>

                    <section className="space-y-6">
                      <div className="rounded-[32px] border border-zinc-800 bg-zinc-900/60 p-6">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Latest plan</p>
                            <h3 className="text-2xl font-semibold text-zinc-50 mt-1">Presentation readiness</h3>
                          </div>
                          <button
                            onClick={handlePreparePresentation}
                            className="rounded-full border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:border-zinc-600"
                          >
                            {latestGamePlan ? 'Review plan' : 'Generate plan'}
                          </button>
                        </div>
                        {latestGamePlan ? (
                          <div className="mt-5 space-y-4">
                            <div className="rounded-[28px] border border-zinc-800 bg-zinc-950/60 p-4">
                              <p className="text-sm text-zinc-400">Attention budget</p>
                              <h4 className="text-xl font-semibold text-zinc-50 mt-2">
                                {latestGamePlan.attentionBudget.maxInterventions} interventions over{' '}
                                {latestGamePlan.attentionBudget.prioritySlides.length || 0} priority slides.
                              </h4>
                            </div>
                            <div className="grid sm:grid-cols-2 gap-3">
                              {latestGamePlan.segments.slice(0, 4).map((segment) => (
                                <div key={segment.slideNumber} className="rounded-[24px] border border-zinc-800 bg-zinc-950/60 p-4">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-sm font-medium text-zinc-100">Slide {segment.slideNumber}</span>
                                    <span className="text-xs uppercase tracking-[0.16em] text-zinc-500">{segment.riskLevel}</span>
                                  </div>
                                  <p className="text-sm text-zinc-400 mt-2 line-clamp-2">
                                    {segment.knownIssues[0] || 'No recurring issue detected.'}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-5 rounded-[28px] border border-dashed border-zinc-700 bg-zinc-950/60 p-5 text-sm text-zinc-400">
                            Run at least one rehearsal, then generate a game plan to inspect risk segments and cue policies before presentation mode.
                          </div>
                        )}
                      </div>

                      <div className="rounded-[32px] border border-zinc-800 bg-zinc-900/60 p-6">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Runs</p>
                            <h3 className="text-2xl font-semibold text-zinc-50 mt-1">Recent sessions</h3>
                          </div>
                          <span className="rounded-full bg-zinc-950 px-3 py-1 text-xs text-zinc-300">
                            {projectRuns.length} total
                          </span>
                        </div>
                        <div className="mt-5 max-h-[420px] overflow-y-auto pr-1 space-y-3">
                          {projectRuns.length === 0 ? (
                            <div className="rounded-[28px] border border-dashed border-zinc-700 bg-zinc-950/60 p-5 text-sm text-zinc-400">
                              No sessions saved yet for this project.
                            </div>
                          ) : (
                            projectRuns.map((run) => (
                              <button
                                key={run.id}
                                onClick={() => void handleOpenRun(run.id)}
                                className="w-full rounded-[26px] border border-zinc-800 bg-zinc-950/70 px-4 py-4 text-left hover:border-zinc-700 transition-colors"
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{run.mode}</p>
                                    <h4 className="text-lg font-semibold text-zinc-100 mt-1">
                                      {run.overallScore != null ? `Score ${Math.round(run.overallScore)}` : 'No score captured'}
                                    </h4>
                                  </div>
                                  <div className="text-right text-sm text-zinc-400">
                                    <div className="inline-flex items-center gap-2">
                                      <Clock3 className="w-4 h-4" />
                                      {new Date(run.createdAt).toLocaleDateString()}
                                    </div>
                                    <div className="mt-2">{Math.floor(run.duration / 60000)}m {Math.floor((run.duration % 60000) / 1000)}s</div>
                                  </div>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </section>
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </div>

      <ProjectSetup
        isOpen={setupOpen}
        initialProject={setupProject}
        onClose={() => setSetupOpen(false)}
        onSaved={(project) => {
          void handleSavedProject(project);
        }}
      />

      {gamePlanOpen && selectedProject && (
        <GamePlanView
          project={selectedProject}
          plan={latestGamePlan}
          isGenerating={isGeneratingPlan}
          onClose={() => setGamePlanOpen(false)}
          onStartPresentation={(plan) => onStartPresentation(selectedProject, plan)}
        />
      )}

      {selectedRun && (
        <RunAnalysis
          run={selectedRun}
          comparisonRun={comparisonRun}
          onClose={() => setSelectedRun(null)}
        />
      )}
    </>
  );
}
