import { BarChart3, FileText, Plus, Presentation, Sparkles } from 'lucide-react';
import type { ProjectSummary } from '../types';

interface ProjectListProps {
  projects: ProjectSummary[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onCreateProject: () => void;
}

export function ProjectList({ projects, selectedProjectId, onSelectProject, onCreateProject }: ProjectListProps) {
  return (
    <aside className="w-full xl:w-[340px] shrink-0 bg-zinc-900/80 border border-zinc-800 rounded-[32px] p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Projects</p>
          <h2 className="text-2xl font-semibold text-zinc-50 mt-1">Presentation Hub</h2>
        </div>
        <button
          onClick={onCreateProject}
          className="inline-flex items-center gap-2 rounded-full bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="flex-1 rounded-3xl border border-dashed border-zinc-700 bg-zinc-950/60 p-6 text-center text-sm text-zinc-400">
          <Sparkles className="w-8 h-8 mx-auto mb-3 text-indigo-400" />
          Create your first project to attach slides, rehearse against it, and build a game plan.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pr-1 space-y-3">
          {projects.map((project) => {
            const selected = project.id === selectedProjectId;
            return (
              <button
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                className={`w-full rounded-3xl border p-4 text-left transition-all ${
                  selected
                    ? 'border-indigo-500/50 bg-indigo-500/10 shadow-[0_0_0_1px_rgba(99,102,241,0.25)]'
                    : 'border-zinc-800 bg-zinc-950/60 hover:border-zinc-700 hover:bg-zinc-950'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-zinc-100">{project.name}</h3>
                    <p className="text-sm text-zinc-400 line-clamp-2 mt-1">
                      {project.description || 'No description yet.'}
                    </p>
                  </div>
                  <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300">
                    {project.slideCount || 0} slides
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-4 text-left">
                  <div className="rounded-2xl bg-zinc-900 px-3 py-2">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                      <Presentation className="w-3.5 h-3.5" />
                      Runs
                    </div>
                    <div className="text-lg font-semibold text-zinc-100 mt-1">{project.runCount}</div>
                  </div>
                  <div className="rounded-2xl bg-zinc-900 px-3 py-2">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                      <BarChart3 className="w-3.5 h-3.5" />
                      Score
                    </div>
                    <div className="text-lg font-semibold text-zinc-100 mt-1">
                      {project.lastOverallScore != null ? Math.round(project.lastOverallScore) : '--'}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-zinc-900 px-3 py-2">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                      <FileText className="w-3.5 h-3.5" />
                      File
                    </div>
                    <div className="text-sm font-semibold text-zinc-100 mt-1 uppercase">
                      {project.fileType ?? '--'}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}
