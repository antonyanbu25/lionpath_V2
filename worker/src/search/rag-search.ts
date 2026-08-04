/**
 * Embedding-based rerank for portal omni-search (Gemini text-embedding-004).
 * Falls back to preserving caller order when embeddings are unavailable.
 */

import type { Env } from "../env";
import { embedVerbatim } from "../embeddings";

export interface RagCandidate {
  id: string;
  type: string;
  text: string;
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

/** Rerank search candidates by semantic similarity to the query. */
export async function rerankWithEmbeddings(
  env: Env,
  query: string,
  candidates: RagCandidate[],
): Promise<{ id: string; score: number }[]> {
  const trimmed = String(query || "").trim();
  if (!trimmed || !candidates.length) return [];

  const qEmb = await embedVerbatim(env, trimmed);
  if (!qEmb.length) {
    return candidates.map((c, i) => ({ id: c.id, score: 1 - i * 0.001 }));
  }

  const scored = await Promise.all(
    candidates.slice(0, 40).map(async (c) => {
      const emb = await embedVerbatim(env, c.text);
      const score = emb.length ? cosineSimilarity(qEmb, emb) : 0;
      return { id: c.id, score };
    }),
  );

  return scored.sort((a, b) => b.score - a.score);
}
