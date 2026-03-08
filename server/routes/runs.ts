import { Router } from 'express';
import { saveRun, getRuns, getRun } from '../db/queries.ts';

const router = Router();

router.post('/api/runs', (req, res) => {
  try {
    const { run, feedbacks } = req.body;
    saveRun(run, feedbacks);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

router.get('/api/runs', (req, res) => {
  try {
    const projectId = req.query.project_id as string | undefined;
    res.json(getRuns(projectId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

router.get('/api/runs/:id', (req, res) => {
  try {
    const result = getRun(req.params.id);
    if (!result) res.status(404).json({ error: 'Run not found' });
    else res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
