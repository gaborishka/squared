import crypto from 'node:crypto';
import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { queryRow, queryRows } from '../db/database.js';
import { claimOrphanRecords } from '../db/queries.js';
import { SESSION_COOKIE, requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

function getOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
  const redirectUri = `${appUrl}/api/auth/callback`;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required.');
  }

  return new OAuth2Client(clientId, clientSecret, redirectUri);
}

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OAUTH_STATE_COOKIE = 'sq_oauth_state';
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

function isSecureContext(): boolean {
  const appUrl = process.env.APP_URL || '';
  return appUrl.startsWith('https') || process.env.NODE_ENV === 'production';
}

function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  };
}

authRouter.get('/google', (_req, res) => {
  const client = getOAuthClient();
  const state = crypto.randomBytes(32).toString('hex');
  const secure = isSecureContext();

  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: OAUTH_STATE_MAX_AGE_MS,
    path: '/api/auth/callback',
  });

  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    prompt: 'select_account',
    state,
  });
  res.redirect(url);
});

authRouter.get('/callback', async (req, res) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const storedState = req.cookies?.[OAUTH_STATE_COOKIE];

  // Clear the state cookie regardless of outcome
  res.clearCookie(OAUTH_STATE_COOKIE, { path: '/api/auth/callback' });

  if (!code || !state || !storedState || state !== storedState) {
    res.redirect('/?error=auth_failed');
    return;
  }

  try {
    const client = getOAuthClient();
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error('GOOGLE_CLIENT_ID is not configured.');
    }

    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) {
      throw new Error('No id_token received from Google.');
    }

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: clientId,
    });
    const payload = ticket.getPayload()!;
    const googleId = payload.sub;
    const email = payload.email!;
    const name = payload.name ?? null;
    const pictureUrl = payload.picture ?? null;

    // Upsert user
    const user = await queryRow<{ id: string }>(
      `INSERT INTO users (id, google_id, email, name, picture_url, last_login_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (google_id) DO UPDATE SET
         email = EXCLUDED.email,
         name = EXCLUDED.name,
         picture_url = EXCLUDED.picture_url,
         last_login_at = NOW()
       RETURNING id`,
      [crypto.randomUUID(), googleId, email, name, pictureUrl],
    );

    // Claim any orphan records from before auth was added
    await claimOrphanRecords(user!.id);

    // Create session
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
    await queryRows(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
      [sessionId, user!.id, expiresAt],
    );

    // Clean up expired sessions for this user
    await queryRows(`DELETE FROM sessions WHERE user_id = $1 AND expires_at < NOW()`, [user!.id]);

    res.cookie(SESSION_COOKIE, sessionId, cookieOptions(isSecureContext()));
    res.redirect('/');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect('/?error=auth_failed');
  }
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

authRouter.post('/logout', async (req, res) => {
  const sessionId = req.cookies?.[SESSION_COOKIE];
  if (sessionId) {
    await queryRows(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});
