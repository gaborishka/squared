import { Router } from 'express';
import type { SaveRunPayload } from '../../shared/types.js';
import { getRun, listRuns, saveRun } from '../db/queries.js';
import { attachRunReport } from '../services/runReport.js';

export const runsRouter = Router();

runsRouter.post('/', (req, res) => {
  const payload = req.body as SaveRunPayload;
  if (!payload?.run?.id || !payload.run.mode) {
    res.status(400).json({ error: 'Invalid run payload.' });
    return;
  }

  res.status(201).json(attachRunReport(saveRun(payload)));
});

runsRouter.get('/', (req, res) => {
  const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : undefined;
  res.json(listRuns(projectId));
});

runsRouter.get('/:id', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'Run not found.' });
    return;
  }
  res.json(attachRunReport(run));
});
