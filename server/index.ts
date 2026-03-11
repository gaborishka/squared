import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analysesRouter } from './routes/analyses.js';
import { projectsRouter } from './routes/projects.js';
import { runsRouter } from './routes/runs.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

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
  app.listen(port, () => {
    console.log(`Squared API server listening on http://localhost:${port}`);
  });
}

export { app };
