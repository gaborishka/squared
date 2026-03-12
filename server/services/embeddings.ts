import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';

const EMBEDDING_MODEL = 'gemini-embedding-2-preview';
const OUTPUT_DIMENSIONALITY = 256;

let warnedFallback = false;

function normalizeVector(values: number[]): number[] {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + (value * value), 0));
  if (!Number.isFinite(magnitude) || magnitude === 0) return values.map(() => 0);
  return values.map((value) => Number((value / magnitude).toFixed(8)));
}

function deterministicEmbedding(text: string, dimensions = OUTPUT_DIMENSIONALITY): number[] {
  const values = new Array(dimensions).fill(0);
  for (let index = 0; index < dimensions; index += 1) {
    const hash = crypto.createHash('sha256').update(`${index}:${text}`).digest();
    values[index] = ((hash.readUInt32BE(0) / 0xffffffff) * 2) - 1;
  }
  return normalizeVector(values);
}

async function remoteEmbed(texts: string[], taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'): Promise<number[][]> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    if (!warnedFallback) {
      warnedFallback = true;
      console.warn('[run-memory] GEMINI_API_KEY missing; using deterministic local embeddings fallback.');
    }
    return texts.map((text) => deterministicEmbedding(text));
  }

  try {
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } });
    const response = await ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: texts,
      config: {
        taskType,
        outputDimensionality: OUTPUT_DIMENSIONALITY,
      },
    });
    const embeddings = response.embeddings?.map((embedding) => normalizeVector(embedding.values ?? [])) ?? [];
    if (embeddings.length !== texts.length || embeddings.some((embedding) => embedding.length === 0)) {
      throw new Error(`Unexpected embedding response size: received ${embeddings.length} for ${texts.length} inputs.`);
    }
    return embeddings;
  } catch (error) {
    console.warn('[run-memory] Remote embedding failed, using deterministic local fallback.', error);
    return texts.map((text) => deterministicEmbedding(text));
  }
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  return remoteEmbed(texts, 'RETRIEVAL_DOCUMENT');
}

export async function embedQuery(text: string): Promise<number[]> {
  const [embedding] = await remoteEmbed([text], 'RETRIEVAL_QUERY');
  return embedding ?? deterministicEmbedding(text);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return 0;
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    sum += left[index] * right[index];
  }
  return Number(sum.toFixed(6));
}

export { EMBEDDING_MODEL, OUTPUT_DIMENSIONALITY };
