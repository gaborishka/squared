import { Router } from 'express';
import { getGamePlan, getLatestGamePlan, getProject } from '../db/queries.js';
import { getProjectAnalysis, readStoredRiskSegments } from '../services/analysis.js';
import { generateGamePlan } from '../services/gameplan.js';
import { getProjectSlideMemoryMap, getSlideMemory } from '../services/runMemory.js';

export const analysesRouter = Router();

analysesRouter.get('/projects/:id/analysis', async (req, res) => {
  const analysis = await getProjectAnalysis(req.params.id);
  if (!analysis) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.json(analysis);
});

analysesRouter.get('/projects/:id/risks', async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.json(await readStoredRiskSegments(req.params.id));
});

analysesRouter.get('/projects/:id/memory', async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  const slideNumber = typeof req.query.slide_number === 'string' ? Number(req.query.slide_number) : null;
  const runId = typeof req.query.run_id === 'string' ? req.query.run_id : undefined;
  if (slideNumber != null && Number.isInteger(slideNumber) && slideNumber > 0) {
    res.json(await getSlideMemory(req.params.id, slideNumber, 2, runId));
    return;
  }

  res.json(await getProjectSlideMemoryMap(req.params.id, runId));
});

analysesRouter.post('/projects/:id/gameplan', async (req, res) => {
  const plan = await generateGamePlan(req.params.id);
  if (!plan) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.status(201).json(plan);
});

analysesRouter.get('/gameplans/:id', async (req, res) => {
  const plan = await getGamePlan(req.params.id);
  if (!plan) {
    res.status(404).json({ error: 'Game plan not found.' });
    return;
  }
  res.json(plan);
});

analysesRouter.get('/projects/:id/gameplan/latest', async (req, res) => {
  const plan = await getLatestGamePlan(req.params.id);
  if (!plan) {
    res.status(404).json({ error: 'Game plan not found.' });
    return;
  }
  res.json(plan);
});
