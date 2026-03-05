import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import express from 'express';
import { getRuns, saveRun, getRun } from './src/server/db';

function apiPlugin() {
  return {
    name: 'api-plugin',
    configureServer(server: any) {
      const app = express();
      app.use(express.json());

      app.post('/api/runs', (req, res) => {
        try {
          const { run, feedbacks } = req.body;
          saveRun(run, feedbacks);
          res.json({ success: true });
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: String(err) });
        }
      });

      app.get('/api/runs', (req, res) => {
        try {
          res.json(getRuns());
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: String(err) });
        }
      });

      app.get('/api/runs/:id', (req, res) => {
        try {
          const result = getRun(req.params.id);
          if (!result) res.status(404).json({ error: 'Run not found' });
          else res.json(result);
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: String(err) });
        }
      });

      server.middlewares.use(app);
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), apiPlugin()],
    define: {
      // NOTE: In Google AI Studio, the API key is injected at runtime from user secrets
      // and never exposed to end users. For any other deployment, use a server-side proxy.
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
