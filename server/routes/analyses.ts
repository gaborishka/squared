import { Router } from 'express';
import { getGamePlan, getLatestGamePlan } from '../db/queries.js';
import { getProjectAnalysis, readStoredRiskSegments } from '../services/analysis.js';
import { generateGamePlan } from '../services/gameplan.js';

export const analysesRouter = Router();

analysesRouter.get('/projects/:id/analysis', (req, res) => {
  const analysis = getProjectAnalysis(req.params.id);
  if (!analysis) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.json(analysis);
});

analysesRouter.get('/projects/:id/risks', (req, res) => {
  const analysis = getProjectAnalysis(req.params.id);
  if (!analysis) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.json(readStoredRiskSegments(req.params.id));
});

analysesRouter.post('/projects/:id/gameplan', (req, res) => {
  const plan = generateGamePlan(req.params.id);
  if (!plan) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.status(201).json(plan);
});

analysesRouter.get('/gameplans/:id', (req, res) => {
  const plan = getGamePlan(req.params.id);
  if (!plan) {
    res.status(404).json({ error: 'Game plan not found.' });
    return;
  }
  res.json(plan);
});

analysesRouter.get('/projects/:id/gameplan/latest', (req, res) => {
  const plan = getLatestGamePlan(req.params.id);
  if (!plan) {
    res.status(404).json({ error: 'Game plan not found.' });
    return;
  }
  res.json(plan);
});
