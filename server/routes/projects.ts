import { Router } from 'express';
import crypto from 'crypto';
import {
  createProject, getProjects, getProject,
  updateProject, deleteProject, setProjectSlides
} from '../db/queries.ts';

const router = Router();

router.post('/api/projects', (req, res) => {
  try {
    const { name, description, content, file_type } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Missing required field: name' });
      return;
    }
    const id = crypto.randomUUID();
    createProject({ id, name, description, content, file_type });
    const project = getProject(id);
    res.status(201).json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

router.get('/api/projects', (_req, res) => {
  try {
    res.json(getProjects());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

router.get('/api/projects/:id', (req, res) => {
  try {
    const project = getProject(req.params.id);
    if (!project) res.status(404).json({ error: 'Project not found' });
    else res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

router.put('/api/projects/:id', (req, res) => {
  try {
    const result = updateProject(req.params.id, req.body);
    if (!result) res.status(404).json({ error: 'Project not found' });
    else res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

router.delete('/api/projects/:id', (req, res) => {
  try {
    const existing = getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    deleteProject(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

router.post('/api/projects/:id/slides', (req, res) => {
  try {
    const existing = getProject(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const { slides } = req.body;
    if (!Array.isArray(slides)) {
      res.status(400).json({ error: 'Missing slides array' });
      return;
    }
    setProjectSlides(req.params.id, slides);
    const project = getProject(req.params.id);
    res.json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
