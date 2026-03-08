import express from 'express';
import cors from 'cors';
import runsRouter from './routes/runs.ts';
import projectsRouter from './routes/projects.ts';

const app = express();
const PORT = process.env.SERVER_PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use(runsRouter);
app.use(projectsRouter);

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
