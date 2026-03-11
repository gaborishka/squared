import { Router } from 'express';
import multer from 'multer';
import type { ProjectInput } from '../../shared/types.js';
import { createProject, deleteProject, getProject, listProjects, replaceProjectUpload, updateProject } from '../db/queries.js';
import { parseUploadFile } from '../services/parsers.js';

const upload = multer({ storage: multer.memoryStorage() });

export const projectsRouter = Router();

projectsRouter.post('/', (req, res) => {
  const input = req.body as ProjectInput;
  if (!input.name?.trim()) {
    res.status(400).json({ error: 'Project name is required.' });
    return;
  }
  res.status(201).json(createProject(input));
});

projectsRouter.get('/', (_req, res) => {
  res.json(listProjects());
});

projectsRouter.get('/:id/file', (req, res) => {
  const project = getProject(String(req.params.id));
  if (!project?.filePath) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }
  res.sendFile(project.filePath, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'File not found on disk.' });
    }
  });
});

projectsRouter.get('/:id', (req, res) => {
  const projectId = String(req.params.id);
  const project = getProject(projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.json(project);
});

projectsRouter.put('/:id', (req, res) => {
  const projectId = String(req.params.id);
  const input = req.body as ProjectInput;
  if (!input.name?.trim()) {
    res.status(400).json({ error: 'Project name is required.' });
    return;
  }

  const project = updateProject(projectId, input);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.json(project);
});

projectsRouter.delete('/:id', (req, res) => {
  const deleted = deleteProject(String(req.params.id));
  if (!deleted) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.status(204).end();
});

projectsRouter.post('/:id/upload', upload.single('file'), async (req, res) => {
  const projectId = String(req.params.id);
  if (!req.file) {
    res.status(400).json({ error: 'File is required.' });
    return;
  }

  const project = getProject(projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  try {
    const parsed = await parseUploadFile(projectId, req.file);
    const updated = replaceProjectUpload(
      projectId,
      {
        content: parsed.content,
        filePath: parsed.filePath,
        fileType: parsed.fileType,
        slideCount: parsed.slideCount,
      },
      parsed.slides,
    );
    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to parse uploaded presentation.' });
  }
});
