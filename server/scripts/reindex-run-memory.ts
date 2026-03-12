import { closeDatabase, initializeDatabase } from '../db/database.js';
import { listRuns } from '../db/queries.js';
import { indexRunMemory } from '../services/runMemory.js';

async function main(): Promise<void> {
  await initializeDatabase();
  try {
    const runs = await listRuns();
    let indexed = 0;

    for (const run of runs) {
      if (!run.projectId) continue;
      await indexRunMemory(run.id);
      indexed += 1;
    }

    console.log(`Reindexed memory for ${indexed} runs.`);
  } finally {
    await closeDatabase();
  }
}

void main().catch((error) => {
  console.error('Failed to reindex run memory:', error);
  process.exit(1);
});
