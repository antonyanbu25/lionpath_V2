/**
 * Embedding-based rerank for portal omni-search (Gemini text-embedding-004).
 * Document vectors are precomputed at write time; only the query is embedded here.
 */

import type { Env } from "../env";
import { embedVerbatim } from "../embeddings";

export interface RagCandidate {
  id: string;
  embedding?: number[] | null;
}

/** @deprecated alias — use RagCandidate */
export type RagEmbeddingCandidate = RagCandidate;

const QUERY_CACHE_TTL_MS = 60_000;

/** @type {Map<string, { embedding: number[]; expiresAt: number }>} */
const queryEmbedCache = new Map();

function normalizeQuery(query: string): string {
  return String(query || "").trim().toLowerCase();
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

async function embedQueryCached(env: Env, query: string, userId?: string): Promise<number[]> {
  const key = normalizeQuery(query);
  if (!key) return [];

  const hit = queryEmbedCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.embedding;

  const embedding = await embedVerbatim(env, key, {
    passName: "search/rag-search",
    userId,
  });
  if (embedding.length) {
    queryEmbedCache.set(key, { embedding, expiresAt: Date.now() + QUERY_CACHE_TTL_MS });
  }
  return embedding;
}

/** Rerank search candidates by semantic similarity to the query (stored vectors only). */
export async function rerankWithEmbeddings(
  env: Env,
  query: string,
  candidates: RagCandidate[],
  opts?: { userId?: string },
): Promise<{ id: string; score: number }[]> {
  const trimmed = String(query || "").trim();
  if (!trimmed || !candidates.length) return [];

  const withEmb = candidates.filter((c) => Array.isArray(c.embedding) && c.embedding!.length);
  const pool = (withEmb.length ? withEmb : candidates).slice(0, 40);
  if (!pool.length) return [];

  const qEmb = await embedQueryCached(env, trimmed, opts?.userId);
  if (!qEmb.length) {
    return pool.map((c, i) => ({ id: c.id, score: 1 - i * 0.001 }));
  }

  const scored = pool.map((c) => {
    const emb = c.embedding;
    const score = Array.isArray(emb) && emb.length ? cosineSimilarity(qEmb, emb) : 0;
    return { id: c.id, score };
  });

  return scored.sort((a, b) => b.score - a.score);
}
