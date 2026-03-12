import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeDatabase } from './db/database.js';
import { requireAuth } from './middleware/auth.js';
import { analysesRouter } from './routes/analyses.js';
import { authRouter } from './routes/auth.js';
import { liveRouter } from './routes/live.js';
import { projectsRouter } from './routes/projects.js';
import { runsRouter } from './routes/runs.js';

const app = express();

const allowedOrigins = new Set<string>();
const publicBaseUrl = process.env.APP_URL?.replace(/\/$/, '');
if (publicBaseUrl) allowedOrigins.add(publicBaseUrl);
// Always allow local development origins
allowedOrigins.add('http://localhost:3000');
allowedOrigins.add('http://localhost:5173');
allowedOrigins.add('http://127.0.0.1:3000');
allowedOrigins.add('http://127.0.0.1:5173');

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin or `Origin: null` (e.g. same-origin, server-to-server, packaged Electron file://)
    if (!origin || origin === 'null' || allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));

// Public routes
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});
app.use('/api/auth', authRouter);

// All other API routes require authentication
app.use('/api', requireAuth);
app.use('/api/live', liveRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/runs', runsRouter);
app.use('/api', analysesRouter);

const configuredStaticDir = process.env.SQUARED_STATIC_DIR?.trim();
if (configuredStaticDir) {
  const staticDir = path.resolve(configuredStaticDir);
  app.use(express.static(staticDir));

  app.get(/^(?!\/api(?:\/|$)).*/, (req, res, next) => {
    const acceptsHtml = req.accepts(['html', 'json']) === 'html';
    const hasFileExtension = path.extname(req.path) !== '';
    if (!acceptsHtml || hasFileExtension) {
      next();
      return;
    }

    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(error);
  res.status(500).json({ error: 'Unexpected server error.' });
});

const currentFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] === currentFilePath) {
  const port = Number(process.env.SERVER_PORT || process.env.PORT || 3001);
  void initializeDatabase()
    .then(() => {
      app.listen(port, () => {
        console.log(`Squared API server listening on http://localhost:${port}`);
      });
    })
    .catch((error) => {
      console.error('Failed to initialize PostgreSQL for Squared:', error);
      process.exit(1);
    });
}

export { app };
