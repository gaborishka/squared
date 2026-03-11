import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Clock3,
  FilePenLine,
  Layers,
  LoaderCircle,
  Mic,
  Plus,
  Presentation,
  Trash2,
  TrendingUp,
  Target,
  History,
} from 'lucide-react';
import squaredLogo from '../../squared-cropped.png';
import { api } from '../api/client';
import type { GamePlan, ProjectAnalysis, ProjectDetails, RunDetails, RunSummary } from '../types';
import { usePdfThumbnails } from '../hooks/usePdfThumbnails';
import { GamePlanView } from './GamePlanView';
import { ProjectSetup } from './ProjectSetup';
import { RunAnalysis } from './RunAnalysis';

interface HomeProps {
  refreshToken: number;
  onStartRehearsal: (project: ProjectDetails) => void;
  onStartPresentation: (project: ProjectDetails, gamePlan: GamePlan) => void;
}

type DetailsTab = 'deck' | 'plan' | 'sessions';

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
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailsTab>('deck');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  const { thumbnails: pdfThumbnails, loading: pdfLoading } = usePdfThumbnails(
    selectedProjectId,
    selectedProject?.fileType ?? null,
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

  useEffect(() => {
    setDeleteConfirm(false);
  }, [selectedProjectId]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

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
      setDeleteConfirm(false);
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

  const lastRunDate = projectRuns[0]
    ? new Date(projectRuns[0].createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : null;

  return (
    <>
      <div className="h-screen flex flex-col overflow-hidden bg-zinc-950">
        {/* ──── Header ──── */}
        <header className="relative z-50 flex items-center justify-between px-6 lg:px-10 py-4 border-b border-zinc-800/40 bg-zinc-950/80 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-3">
            <img src={squaredLogo} alt="Squared" style={{ height: '100px' }} />
          </div>

          <div className="flex items-center gap-3">
            {/* Project Switcher */}
            {projects.length > 0 && (
              <div ref={dropdownRef} className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="inline-flex items-center gap-2.5 rounded-xl border border-zinc-700/60 bg-zinc-900/80 px-4 py-2.5 text-[15px] text-zinc-100 hover:border-zinc-600 transition-all duration-200"
                >
                  <span className="max-w-[240px] truncate font-medium">{selectedProject?.name ?? 'Select project'}</span>
                  <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} />
                </button>
                {dropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                    className="absolute right-0 top-full mt-2 w-80 rounded-2xl border border-zinc-700/50 bg-zinc-900/95 backdrop-blur-xl shadow-2xl shadow-black/50 z-50 py-2 max-h-[420px] overflow-y-auto"
                  >
                    <div className="px-4 py-2 border-b border-zinc-800/50 mb-1">
                      <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Projects</p>
                    </div>
                    {projects.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => {
                          setSelectedProjectId(project.id);
                          setDropdownOpen(false);
                        }}
                        className={`w-full px-4 py-3.5 text-left transition-all duration-150 flex items-center justify-between gap-3 ${
                          project.id === selectedProjectId
                            ? 'bg-indigo-500/12 border-l-2 border-indigo-400'
                            : 'text-zinc-300 hover:bg-zinc-800/60 border-l-2 border-transparent'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className={`text-[15px] font-medium truncate ${project.id === selectedProjectId ? 'text-indigo-200' : 'text-zinc-200'}`}>
                            {project.name}
                          </div>
                          <div className="text-sm text-zinc-400 mt-0.5">
                            {project.slideCount} slides
                            {project.updatedAt && (
                              <span className="ml-2 text-zinc-500">
                                {new Date(project.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </div>
                        </div>
                        {project.id === selectedProjectId && (
                          <div className="w-2 h-2 rounded-full bg-indigo-400 shrink-0 animate-pulse" />
                        )}
                      </button>
                    ))}
                  </motion.div>
                )}
              </div>
            )}

            <button
              onClick={() => {
                setSetupProject(null);
                setSetupOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-zinc-800/80 border border-zinc-700/40 px-4 py-2.5 text-[15px] text-zinc-200 hover:bg-zinc-700/80 hover:border-zinc-600/60 transition-all duration-200"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New</span>
            </button>
          </div>
        </header>

        {/* ──── Main Content ──── */}
        <main className="flex-1 min-h-0 overflow-y-auto relative">
          {/* Ambient glow */}
          <div className="pointer-events-none fixed top-[8%] left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-indigo-500/[0.03] rounded-full blur-[160px]" />
          <div className="pointer-events-none fixed top-[25%] left-[30%] w-[400px] h-[400px] bg-emerald-500/[0.02] rounded-full blur-[120px]" />

          <div className="max-w-6xl mx-auto px-6 lg:px-10 py-8 lg:py-12 relative z-10">
            {/* Error Banner */}
            {error && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-3.5 text-sm text-red-300 flex items-center gap-3 mb-8">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span className="flex-1">{error}</span>
                <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 text-sm font-medium">dismiss</button>
              </div>
            )}

            {isLoading ? (
              /* ──── Loading ──── */
              <div className="text-center py-32">
                <LoaderCircle className="w-8 h-8 animate-spin mx-auto text-zinc-500" />
                <p className="text-base text-zinc-500 mt-4">Loading projects...</p>
              </div>
            ) : !selectedProject ? (
              /* ──── Empty State ──── */
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="text-center py-24 max-w-lg mx-auto"
              >
                <div className="inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-b from-zinc-800/80 to-zinc-900 border border-zinc-700/50 mb-10 shadow-xl shadow-indigo-500/5">
                  <Mic className="w-10 h-10 text-indigo-400" />
                </div>
                <h1 className="text-4xl lg:text-5xl font-bold text-zinc-50 tracking-tight">Welcome to Squared</h1>
                <p className="text-lg text-zinc-400 mt-4 leading-relaxed">
                  Upload your deck and start rehearsing with AI-powered speech coaching.
                </p>
                <button
                  onClick={() => {
                    setSetupProject(null);
                    setSetupOpen(true);
                  }}
                  className="mt-12 inline-flex items-center gap-2.5 rounded-2xl bg-indigo-500 px-8 py-4 text-lg font-semibold text-white hover:bg-indigo-400 transition-all duration-200 shadow-lg shadow-indigo-500/25 hover:shadow-xl hover:shadow-indigo-500/35 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Plus className="w-5 h-5" />
                  Create your first project
                </button>
              </motion.div>
            ) : (
              /* ──── Active Project — Two Column Layout ──── */
              <motion.div
                key={selectedProjectId}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
              >
                <div className="lg:grid lg:grid-cols-[380px_1fr] lg:gap-12 space-y-8 lg:space-y-0 items-start">

                  {/* ──── LEFT COLUMN: Project Hero ──── */}
                  <div className="lg:sticky lg:top-12 space-y-8">
                    {/* Project Name */}
                    <div>
                      <h1 className="text-4xl lg:text-5xl font-bold tracking-tight bg-gradient-to-b from-white via-zinc-200 to-zinc-500 bg-clip-text text-transparent leading-[1.1]">
                        {selectedProject.name}
                      </h1>
                      {lastRunDate && (
                        <p className="text-sm text-zinc-500 mt-3 flex items-center gap-1.5">
                          <Clock3 className="w-3.5 h-3.5" />
                          Last session {lastRunDate}
                        </p>
                      )}
                    </div>

                    {/* Stats Cards */}
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/50 p-4 group hover:border-zinc-700/50 transition-colors">
                        <Layers className="w-5 h-5 text-indigo-400 mb-2" />
                        <div className="text-2xl font-bold text-zinc-100 tabular-nums">{selectedProject.slideCount}</div>
                        <div className="text-xs text-zinc-500 mt-0.5">slides</div>
                      </div>
                      <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/50 p-4 group hover:border-zinc-700/50 transition-colors">
                        <TrendingUp className="w-5 h-5 text-emerald-400 mb-2" />
                        <div className="text-2xl font-bold text-zinc-100 tabular-nums">{Math.round(projectAnalysis?.avgScore ?? 0)}</div>
                        <div className="text-xs text-zinc-500 mt-0.5">avg score</div>
                      </div>
                      <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/50 p-4 group hover:border-zinc-700/50 transition-colors">
                        <History className="w-5 h-5 text-amber-400 mb-2" />
                        <div className="text-2xl font-bold text-zinc-100 tabular-nums">{projectRuns.length}</div>
                        <div className="text-xs text-zinc-500 mt-0.5">sessions</div>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="space-y-3">
                      <button
                        onClick={() => onStartRehearsal(selectedProject)}
                        className="w-full group flex items-center justify-center gap-3 rounded-2xl bg-indigo-500 px-6 py-4 text-lg font-semibold text-white hover:bg-indigo-400 transition-all duration-200 shadow-lg shadow-indigo-500/20 hover:shadow-xl hover:shadow-indigo-500/30 hover:scale-[1.02] active:scale-[0.98]"
                      >
                        <Mic className="w-5 h-5" />
                        Rehearse
                      </button>
                      <button
                        onClick={handlePreparePresentation}
                        className="w-full group flex items-center justify-center gap-3 rounded-2xl bg-emerald-600 px-6 py-4 text-lg font-semibold text-white hover:bg-emerald-500 transition-all duration-200 shadow-lg shadow-emerald-600/20 hover:shadow-xl hover:shadow-emerald-600/30 hover:scale-[1.02] active:scale-[0.98]"
                      >
                        <Presentation className="w-5 h-5" />
                        Present
                      </button>
                    </div>

                    {/* Secondary Actions */}
                    <div className="flex items-center gap-1 pt-2 border-t border-zinc-800/30">
                      <button
                        onClick={() => {
                          setSetupProject(selectedProject);
                          setSetupOpen(true);
                        }}
                        className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors px-3 py-2 rounded-lg hover:bg-zinc-800/40"
                      >
                        <FilePenLine className="w-4 h-4" />
                        Edit project
                      </button>
                      {!deleteConfirm ? (
                        <button
                          onClick={() => setDeleteConfirm(true)}
                          className="flex items-center gap-2 text-sm text-zinc-500 hover:text-red-400 transition-colors px-3 py-2 rounded-lg hover:bg-red-500/5"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      ) : (
                        <span className="flex items-center gap-2 text-sm px-3 py-2">
                          <span className="text-red-400">Delete this project?</span>
                          <button onClick={handleDeleteProject} className="text-red-400 underline hover:text-red-300 font-medium">Yes</button>
                          <button onClick={() => setDeleteConfirm(false)} className="text-zinc-500 hover:text-zinc-300">No</button>
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ──── RIGHT COLUMN: Content Tabs ──── */}
                  <div className="min-w-0">
                    {/* Tab Bar */}
                    <div className="flex bg-zinc-900/50 rounded-xl p-1 border border-zinc-800/40">
                      <button
                        onClick={() => setActiveTab('deck')}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                          activeTab === 'deck'
                            ? 'bg-zinc-800/80 text-zinc-100 shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        <Layers className="w-4 h-4" />
                        Deck
                        {selectedProject.slideCount > 0 && (
                          <span className={`text-xs tabular-nums ${activeTab === 'deck' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                            {selectedProject.slideCount}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => setActiveTab('plan')}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                          activeTab === 'plan'
                            ? 'bg-zinc-800/80 text-zinc-100 shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        <Target className="w-4 h-4" />
                        Plan
                        {latestGamePlan && (
                          <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">Ready</span>
                        )}
                      </button>
                      <button
                        onClick={() => setActiveTab('sessions')}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                          activeTab === 'sessions'
                            ? 'bg-zinc-800/80 text-zinc-100 shadow-sm'
                            : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        <History className="w-4 h-4" />
                        Sessions
                        {projectRuns.length > 0 && (
                          <span className={`text-xs tabular-nums ${activeTab === 'sessions' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                            {projectRuns.length}
                          </span>
                        )}
                      </button>
                    </div>

                    {/* ──── Deck Tab ──── */}
                    {activeTab === 'deck' && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        className="mt-6"
                      >
                        {selectedProject.slides.length === 0 ? (
                          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/30 py-16 text-center">
                            <Layers className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                            <p className="text-base text-zinc-500">No slides uploaded yet.</p>
                            <button
                              onClick={() => {
                                setSetupProject(selectedProject);
                                setSetupOpen(true);
                              }}
                              className="mt-4 text-sm text-indigo-400 hover:text-indigo-300 font-medium"
                            >
                              Upload a deck
                            </button>
                          </div>
                        ) : (
                          <>
                            {pdfLoading && (
                              <div className="flex items-center gap-2 mb-4 text-sm text-zinc-500">
                                <LoaderCircle className="w-4 h-4 animate-spin" />
                                Rendering slide previews...
                              </div>
                            )}
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                              {selectedProject.slides.map((slide) => {
                                const risk = projectAnalysis?.slideSummary.find((s) => s.slideNumber === slide.slideNumber);
                                const thumb = pdfThumbnails.get(slide.slideNumber);
                                const contentLines = (slide.content || '')
                                  .split('\n')
                                  .map((l) => l.trim())
                                  .filter((l) => l && l !== slide.title);

                                return (
                                  <div
                                    key={slide.id}
                                    className="group aspect-[16/10] rounded-xl overflow-hidden border border-zinc-700/25 hover:border-zinc-600/40 transition-all duration-200 cursor-default relative"
                                  >
                                    {thumb ? (
                                      /* ── PDF Thumbnail ── */
                                      <img
                                        src={thumb}
                                        alt={`Slide ${slide.slideNumber}: ${slide.title}`}
                                        className="w-full h-full object-contain bg-white"
                                      />
                                    ) : (
                                      /* ── Enhanced Text Card ── */
                                      <div className="w-full h-full bg-gradient-to-br from-zinc-800/50 to-zinc-900/70 p-5 flex flex-col">
                                        <h3 className="text-[15px] font-semibold text-zinc-100 line-clamp-2 leading-snug group-hover:text-white transition-colors">
                                          {slide.title}
                                        </h3>
                                        {contentLines.length > 0 && (
                                          <div className="mt-3 space-y-1.5 flex-1 min-h-0 overflow-hidden">
                                            {contentLines.slice(0, 5).map((line, i) => (
                                              <div key={i} className="flex items-start gap-2">
                                                <span className="w-1 h-1 rounded-full bg-zinc-600 mt-[7px] shrink-0" />
                                                <span className="text-xs text-zinc-500 line-clamp-1">{line}</span>
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                        {!contentLines.length && slide.speakerNotes && (
                                          <p className="text-xs text-zinc-500 mt-3 line-clamp-3 leading-relaxed flex-1">
                                            {slide.speakerNotes}
                                          </p>
                                        )}
                                      </div>
                                    )}
                                    {/* ── Overlays ── */}
                                    <div className="absolute top-3 left-3">
                                      <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg text-xs font-mono font-medium border ${
                                        thumb
                                          ? 'bg-black/50 backdrop-blur-sm text-white/90 border-white/10'
                                          : 'bg-zinc-800/60 text-zinc-400 border-zinc-700/30'
                                      }`}>
                                        {slide.slideNumber}
                                      </span>
                                    </div>
                                    {risk && (
                                      <div className="absolute top-3 right-3">
                                        <span className={`text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-md border ${
                                          thumb ? 'backdrop-blur-sm' : ''
                                        } ${
                                          risk.riskLevel === 'fragile'
                                            ? 'text-red-400 bg-red-500/15 border-red-500/25'
                                            : risk.riskLevel === 'watch'
                                              ? 'text-amber-400 bg-amber-500/15 border-amber-500/25'
                                              : 'text-zinc-400 bg-zinc-800/50 border-zinc-700/20'
                                        }`}>
                                          {risk.riskLevel}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </motion.div>
                    )}

                    {/* ──── Plan Tab ──── */}
                    {activeTab === 'plan' && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        className="mt-6"
                      >
                        {latestGamePlan ? (
                          <div className="space-y-6">
                            {/* Plan summary */}
                            <div className="rounded-xl border border-zinc-800/50 bg-zinc-900/40 p-5">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-base text-zinc-200 font-medium">
                                    {latestGamePlan.attentionBudget.maxInterventions} interventions across{' '}
                                    {latestGamePlan.segments.length} slides
                                  </p>
                                  <p className="text-sm text-zinc-500 mt-1">
                                    Based on {latestGamePlan.overview.totalRuns} rehearsal{latestGamePlan.overview.totalRuns !== 1 ? 's' : ''}
                                  </p>
                                </div>
                                <button
                                  onClick={handlePreparePresentation}
                                  className="text-sm text-indigo-400 hover:text-indigo-300 font-medium px-3 py-1.5 rounded-lg hover:bg-indigo-500/10 transition-all"
                                >
                                  Full plan
                                </button>
                              </div>
                            </div>

                            {/* Segment cards */}
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                              {latestGamePlan.segments.map((seg) => (
                                <div key={seg.slideNumber} className="rounded-xl border border-zinc-800/50 bg-zinc-900/40 px-5 py-4">
                                  <div className="flex items-center justify-between gap-3 mb-2">
                                    <span className="text-sm font-medium text-zinc-300">Slide {seg.slideNumber}</span>
                                    <span className={`text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                                      seg.riskLevel === 'fragile'
                                        ? 'text-red-400 bg-red-500/10'
                                        : seg.riskLevel === 'watch'
                                          ? 'text-amber-400 bg-amber-500/10'
                                          : 'text-zinc-500 bg-zinc-800/40'
                                    }`}>
                                      {seg.riskLevel}
                                    </span>
                                  </div>
                                  <p className="text-sm text-zinc-500 line-clamp-2">
                                    {seg.knownIssues[0] || 'No issues'}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/30 py-16 text-center">
                            <Target className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                            <p className="text-base text-zinc-500">No game plan yet.</p>
                            <button
                              onClick={handlePreparePresentation}
                              className="mt-4 text-sm text-indigo-400 hover:text-indigo-300 font-medium"
                            >
                              Generate after a rehearsal
                            </button>
                          </div>
                        )}
                      </motion.div>
                    )}

                    {/* ──── Sessions Tab ──── */}
                    {activeTab === 'sessions' && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        className="mt-6 space-y-3"
                      >
                        {projectRuns.length === 0 ? (
                          <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/30 py-16 text-center">
                            <History className="w-8 h-8 text-zinc-700 mx-auto mb-3" />
                            <p className="text-base text-zinc-500">No sessions yet.</p>
                            <p className="text-sm text-zinc-600 mt-1">Start a rehearsal to build your history.</p>
                          </div>
                        ) : (
                          projectRuns.map((run) => (
                            <button
                              key={run.id}
                              onClick={() => void handleOpenRun(run.id)}
                              className="w-full rounded-xl border border-zinc-800/50 bg-zinc-900/40 px-5 py-4 text-left hover:border-zinc-700/60 hover:bg-zinc-900/60 transition-all duration-200 group"
                            >
                              <div className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-3 min-w-0">
                                  {/* Mode badge */}
                                  <span className={`shrink-0 inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-lg ${
                                    run.mode === 'rehearsal'
                                      ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/20'
                                      : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                                  }`}>
                                    {run.mode === 'rehearsal' ? (
                                      <Mic className="w-3.5 h-3.5" />
                                    ) : (
                                      <Presentation className="w-3.5 h-3.5" />
                                    )}
                                    <span className="capitalize">{run.mode}</span>
                                  </span>
                                  {/* Score */}
                                  {run.overallScore != null && (
                                    <span className="text-lg font-bold text-zinc-200 tabular-nums">
                                      {Math.round(run.overallScore)}
                                      <span className="text-xs text-zinc-500 font-normal ml-0.5">pts</span>
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-4 text-sm text-zinc-500 shrink-0">
                                  <span className="tabular-nums">{Math.floor(run.duration / 60000)}m {Math.floor((run.duration % 60000) / 1000)}s</span>
                                  <span>{new Date(run.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                                  <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                                </div>
                              </div>
                            </button>
                          ))
                        )}
                      </motion.div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </main>
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
