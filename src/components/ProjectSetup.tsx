import { useEffect, useMemo, useState } from 'react';
import { LoaderCircle, Upload, X } from 'lucide-react';
import { api } from '../api/client';
import type { ProjectDetails } from '../types';

interface ProjectSetupProps {
  isOpen: boolean;
  initialProject: ProjectDetails | null;
  onClose: () => void;
  onSaved: (project: ProjectDetails) => void;
}

export function ProjectSetup({ isOpen, initialProject, onClose, onSaved }: ProjectSetupProps) {
  const isEditing = Boolean(initialProject);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [slides, setSlides] = useState<ProjectDetails['slides']>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(initialProject?.name ?? '');
    setDescription(initialProject?.description ?? '');
    setSlides(initialProject?.slides ?? []);
    setSelectedFile(null);
    setError(null);
  }, [initialProject, isOpen]);

  const hasUploadPreview = useMemo(() => slides.length > 0, [slides]);

  if (!isOpen) return null;

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Project name is required.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      let project = initialProject
        ? await api.updateProject(initialProject.id, {
            name: name.trim(),
            description: description.trim(),
            slides: slides.map((slide) => ({ id: slide.id, speakerNotes: slide.speakerNotes })),
          })
        : await api.createProject({
            name: name.trim(),
            description: description.trim(),
          });

      if (selectedFile) {
        project = await api.uploadProjectFile(project.id, selectedFile);
      }

      if (slides.length > 0) {
        project = await api.updateProject(project.id, {
          name: project.name,
          description: project.description,
          slides: slides.map((slide) => ({ id: slide.id, speakerNotes: slide.speakerNotes })),
        });
      }

      onSaved(project);
      onClose();
    } catch (saveError) {
      console.error(saveError);
      setError('Could not save the project. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm p-4 md:p-10 overflow-y-auto">
      <form
        onSubmit={handleSave}
        className="max-w-5xl mx-auto rounded-[36px] border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">
              {isEditing ? 'Edit Project' : 'New Project'}
            </p>
            <h3 className="text-2xl font-semibold text-zinc-50 mt-1">
              {isEditing ? 'Refine your presentation project' : 'Create a presentation project'}
            </h3>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-0">
          <section className="p-6 md:p-8 border-b lg:border-b-0 lg:border-r border-zinc-800 space-y-6">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-zinc-300">Project Name</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                placeholder="Quarterly GTM deck"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-zinc-300">Description</label>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="w-full min-h-32 rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                placeholder="What this presentation is for, who the audience is, and what a strong delivery should emphasize."
              />
            </div>

            <div className="rounded-[28px] border border-dashed border-zinc-700 bg-zinc-900/70 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="text-lg font-semibold text-zinc-100">Attach presentation file</h4>
                  <p className="text-sm text-zinc-400 mt-1">
                    Supports `PPTX`, `PDF`, `TXT`, and `MD`. Uploading replaces the current slide structure.
                  </p>
                </div>
                <Upload className="w-5 h-5 text-emerald-400 shrink-0 mt-1" />
              </div>
              <label className="mt-4 block rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-4 cursor-pointer hover:border-zinc-700 transition-colors">
                <input
                  type="file"
                  accept=".pptx,.pdf,.txt,.md"
                  className="hidden"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                />
                <span className="block text-sm font-medium text-zinc-200">
                  {selectedFile ? selectedFile.name : 'Choose a file to parse on save'}
                </span>
                <span className="block text-xs text-zinc-500 mt-1">
                  {selectedFile
                    ? 'The backend will extract slides and update the project after you save.'
                    : 'If you skip this, you can still add structure later.'}
                </span>
              </label>
            </div>

            {error && <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
          </section>

          <section className="p-6 md:p-8 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Slide Preview</p>
                <h4 className="text-xl font-semibold text-zinc-50 mt-1">
                  {hasUploadPreview ? `${slides.length} slides ready` : 'Upload to preview'}
                </h4>
              </div>
              {hasUploadPreview && (
                <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
                  Speaker notes are editable
                </span>
              )}
            </div>

            <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-4">
              {slides.length === 0 ? (
                <div className="rounded-[28px] border border-zinc-800 bg-zinc-900/60 p-6 text-sm text-zinc-400">
                  Once a file is uploaded, extracted slide titles and content will appear here for quick review.
                </div>
              ) : (
                slides.map((slide, index) => (
                  <article key={slide.id} className="rounded-[28px] border border-zinc-800 bg-zinc-900/60 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Slide {slide.slideNumber || index + 1}</p>
                        <h5 className="text-lg font-semibold text-zinc-100 mt-1">{slide.title}</h5>
                      </div>
                    </div>
                    <p className="text-sm text-zinc-400 mt-3 whitespace-pre-wrap line-clamp-6">{slide.content || 'No extracted text.'}</p>
                    <textarea
                      value={slide.speakerNotes}
                      onChange={(event) =>
                        setSlides((current) =>
                          current.map((item) =>
                            item.id === slide.id ? { ...item, speakerNotes: event.target.value } : item,
                          ),
                        )
                      }
                      className="mt-4 w-full min-h-24 rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                      placeholder="Speaker notes, rescue phrases, or reminders for this slide."
                    />
                  </article>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-5 border-t border-zinc-800">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2.5 text-sm font-medium text-zinc-300 hover:text-zinc-100">
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-full bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {isSaving && <LoaderCircle className="w-4 h-4 animate-spin" />}
            {isEditing ? 'Save Project' : 'Create Project'}
          </button>
        </div>
      </form>
    </div>
  );
}
