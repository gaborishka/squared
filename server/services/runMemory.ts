import type { LiveMemoryCue, RunMemoryChunk } from '../../shared/types.js';
import { getProject, getRun, replaceRunMemoryChunks, searchRunMemoryChunks } from '../db/queries.js';
import { embedDocuments, embedQuery } from './embeddings.js';
import { buildRunMemoryDrafts, buildSlideQuery, normalizeWhitespace, toLiveMemoryCue } from './runMemoryCore.js';

export { buildRunMemoryDrafts } from './runMemoryCore.js';

export async function indexRunMemory(runId: string): Promise<RunMemoryChunk[]> {
  const run = await getRun(runId);
  if (!run?.projectId) return [];
  const project = await getProject(run.projectId);
  if (!project) return [];

  const drafts = buildRunMemoryDrafts(run, project);
  if (drafts.length === 0) {
    return replaceRunMemoryChunks(run.id, project.id, []);
  }

  const embeddings = await embedDocuments(drafts.map((chunk) => chunk.textForEmbedding));
  const chunks: RunMemoryChunk[] = drafts.map((chunk, index) => ({
    ...chunk,
    embedding: embeddings[index] ?? [],
    createdAt: new Date().toISOString(),
  }));

  return replaceRunMemoryChunks(run.id, project.id, chunks);
}

export async function searchProjectMemory(
  projectId: string,
  query: string,
  filters?: { slideNumber?: number | null; limit?: number; runId?: string },
): Promise<LiveMemoryCue[]> {
  const trimmedQuery = normalizeWhitespace(query);
  if (!trimmedQuery) return [];

  const queryEmbedding = await embedQuery(trimmedQuery);
  const matches = await searchRunMemoryChunks(projectId, queryEmbedding, filters);
  return matches.map(({ chunk, similarityScore }) => toLiveMemoryCue(chunk, similarityScore));
}

export async function getSlideMemory(projectId: string, slideNumber: number, limit = 2, runId?: string): Promise<LiveMemoryCue[]> {
  const project = await getProject(projectId);
  if (!project) return [];
  const query = buildSlideQuery(project, slideNumber);
  const strict = await searchProjectMemory(projectId, query, { slideNumber, limit, runId });
  if (strict.length > 0) return strict;
  return searchProjectMemory(projectId, query, { limit, runId });
}

export async function getProjectSlideMemoryMap(projectId: string, runId?: string): Promise<Record<number, LiveMemoryCue[]>> {
  const project = await getProject(projectId);
  if (!project) return {};
  const result: Record<number, LiveMemoryCue[]> = {};
  for (const slide of project.slides) {
    result[slide.slideNumber] = await getSlideMemory(projectId, slide.slideNumber, 2, runId);
  }
  return result;
}
