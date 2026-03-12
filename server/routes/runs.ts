import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import type { RunArtifact, SaveRunPayload } from '../../shared/types.js';
import { getRunArtifactsDir } from '../config/paths.js';
import { getRun, listRuns, saveRun } from '../db/queries.js';
import { indexRunMemory } from '../services/runMemory.js';
import { attachRunReport } from '../services/runReport.js';

export const runsRouter = Router();
const upload = multer({ storage: multer.memoryStorage() });

function extensionFor(fileName: string, mimeType: string): string {
  const fromName = path.extname(fileName).toLowerCase();
  if (fromName) return fromName;
  if (mimeType.includes('webm')) return '.webm';
  if (mimeType.includes('mp4')) return '.mp4';
  if (mimeType.includes('wav')) return '.wav';
  return '.bin';
}

function parseNullableMs(value: unknown): number | null | 'invalid' {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 'invalid';
}

runsRouter.post('/artifacts', upload.single('file'), async (req, res) => {
  const runId = typeof req.body.runId === 'string' ? req.body.runId.trim() : '';
  const kind = typeof req.body.kind === 'string' ? req.body.kind.trim() : '';
  if (!runId || !req.file || (kind !== 'full_recording' && kind !== 'derived_clip')) {
    res.status(400).json({ error: 'Invalid artifact payload.' });
    return;
  }

  const artifactId = crypto.randomUUID();
  const artifactsDir = path.resolve(getRunArtifactsDir(), runId);
  const ext = extensionFor(req.file.originalname, req.file.mimetype);
  const targetPath = path.join(artifactsDir, `${artifactId}${ext}`);
  const startMs = parseNullableMs(req.body.startMs);
  const endMs = parseNullableMs(req.body.endMs);

  if (startMs === 'invalid' || endMs === 'invalid') {
    res.status(400).json({ error: 'Invalid artifact timing metadata.' });
    return;
  }

  try {
    await fs.mkdir(artifactsDir, { recursive: true });
    await fs.writeFile(targetPath, req.file.buffer);
  } catch (error) {
    console.error('Failed to store run artifact', error);
    res.status(500).json({ error: 'Failed to store run artifact.' });
    return;
  }

  const artifact: RunArtifact = {
    id: artifactId,
    runId,
    kind,
    mimeType: req.file.mimetype || 'application/octet-stream',
    filePath: targetPath,
    startMs,
    endMs,
    createdAt: new Date().toISOString(),
  };

  res.status(201).json(artifact);
});

runsRouter.post('/', async (req, res) => {
  const payload = req.body as SaveRunPayload;
  if (!payload?.run?.id || !payload.run.mode) {
    res.status(400).json({ error: 'Invalid run payload.' });
    return;
  }

  const saved = await attachRunReport(await saveRun(payload));
  res.status(201).json(saved);

  if (payload.run.projectId) {
    void indexRunMemory(payload.run.id).catch((error) => {
      console.error(`Failed to index run memory for ${payload.run.id}:`, error);
    });
  }
});

runsRouter.get('/', async (req, res) => {
  const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : undefined;
  res.json(await listRuns(projectId));
});

runsRouter.get('/:id', async (req, res) => {
  const run = await getRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'Run not found.' });
    return;
  }
  res.json(await attachRunReport(run));
});
