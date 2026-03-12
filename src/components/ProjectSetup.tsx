import { useCallback, useEffect, useRef, useState } from 'react';
import { FileUp, LoaderCircle, X } from 'lucide-react';
import squaredIcon from '../../squared_icon.png';
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName(initialProject?.name ?? '');
    setDescription(initialProject?.description ?? '');
    setSelectedFile(null);
    setError(null);
  }, [initialProject, isOpen]);

  const handleEscape = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) onClose();
    },
    [onClose, isSaving],
  );

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, handleEscape]);

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
          })
        : await api.createProject({
            name: name.trim(),
            description: description.trim(),
          });

      if (selectedFile) {
        project = await api.uploadProjectFile(project.id, selectedFile);
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
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm p-4 md:p-10 overflow-y-auto flex items-start justify-center"
      onMouseDown={(event) => {
        if (formRef.current && !formRef.current.contains(event.target as Node) && !isSaving) onClose();
      }}
    >
      <form
        ref={formRef}
        onSubmit={handleSave}
        className="w-full max-w-xl rounded-3xl border border-zinc-800/80 bg-zinc-950 shadow-2xl shadow-black/40 overflow-hidden relative"
      >
        {/* Decorative gradient orb */}
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full bg-indigo-500/10 blur-[100px] pointer-events-none" />

        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 z-10 p-2 rounded-xl text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="relative px-8 pt-10 pb-2 text-center">
          <img src={squaredIcon} alt="Squared" className="w-12 h-12 mb-5 inline-block" />
          <h3 className="text-2xl font-semibold text-zinc-50 tracking-tight">
            {isEditing ? 'Edit project' : 'New project'}
          </h3>
          <p className="text-sm text-zinc-500 mt-1.5 max-w-xs mx-auto">
            {isEditing
              ? 'Update your presentation details and coaching context.'
              : 'Set up your deck and start rehearsing with AI coaching.'}
          </p>
        </div>

        {/* Form body */}
        <div className="px-8 pt-6 pb-2 space-y-5">
          {/* Project Name */}
          <div className="space-y-1.5">
            <label htmlFor="project-name" className="block text-xs font-medium text-zinc-400 uppercase tracking-wider">Name</label>
            <input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
              placeholder="Quarterly GTM deck"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label htmlFor="project-description" className="block text-xs font-medium text-zinc-400 uppercase tracking-wider">Description</label>
            <textarea
              id="project-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-colors resize-none"
              placeholder="Audience, goals, and what a strong delivery should emphasize."
            />
          </div>

          {/* File upload */}
          <label className="group block rounded-xl border border-dashed border-zinc-700/80 bg-zinc-900/40 hover:bg-zinc-900/60 hover:border-zinc-600 p-5 cursor-pointer transition-all">
            <input
              type="file"
              accept=".pptx,.pdf,.txt,.md"
              className="hidden"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-zinc-800/80 group-hover:bg-zinc-800 transition-colors shrink-0">
                <FileUp className="w-4 h-4 text-zinc-400 group-hover:text-indigo-400 transition-colors" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-200 truncate">
                  {selectedFile ? selectedFile.name : 'Attach presentation file'}
                </p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {selectedFile
                    ? 'Will be parsed when you save'
                    : 'PPTX, PDF, TXT, or MD — optional'}
                </p>
              </div>
            </div>
          </label>

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-8 py-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2.5 text-sm font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30 hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none transition-all"
          >
            {isSaving && <LoaderCircle className="w-4 h-4 animate-spin" />}
            {isEditing ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
}
