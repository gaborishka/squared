import type { Request, Response, NextFunction } from 'express';
import type { AuthUser } from '../../shared/types.js';
import { queryRow } from '../db/database.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const SESSION_COOKIE = 'sq_session';

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (!sessionId) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }

  const row = await queryRow<{
    user_id: string;
    email: string;
    name: string | null;
    picture_url: string | null;
    expires_at: Date | string;
  }>(
    `SELECT s.user_id, s.expires_at, u.email, u.name, u.picture_url
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1`,
    [sessionId],
  );

  if (!row || new Date(row.expires_at) < new Date()) {
    res.status(401).json({ error: 'Session expired.' });
    return;
  }

  req.user = {
    id: row.user_id,
    email: row.email,
    name: row.name,
    pictureUrl: row.picture_url,
  };

  next();
}
