import { Router } from 'express';
import type { LiveSessionKind } from '../../shared/types.js';
import { createLiveAuthToken, isLiveSessionKind } from '../services/liveAuth.js';

export const liveRouter = Router();

liveRouter.post('/auth-token', async (req, res) => {
  const kind = String((req.body as { kind?: string } | undefined)?.kind ?? '').trim();
  if (!isLiveSessionKind(kind)) {
    res.status(400).json({ error: 'Invalid live session kind.' });
    return;
  }

  try {
    res.json(await createLiveAuthToken(kind as LiveSessionKind));
  } catch (error) {
    console.error('[live-auth] Failed to create auth token', error);
    res.status(500).json({ error: 'Failed to create Live auth token.' });
  }
});
