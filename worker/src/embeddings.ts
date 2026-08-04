/**
 * Verbatim embeddings for product-gap clustering (spec §8).
 * Uses Gemini text-embedding-004 when GEMINI_API_KEY is configured.
 */

import type { ProviderEnv } from "./providers/types";

export const EMBEDDING_MODEL = "text-embedding-004";

interface EmbedResponse {
  embedding?: { values?: number[] };
  error?: { message?: string };
}

export interface EmbeddingResult {
  embedding: number[];
  embeddingModel: string;
}

/** Embed searchable text; returns null when unconfigured or on failure. */
export async function embedText(env: ProviderEnv, text: string): Promise<EmbeddingResult | null> {
  const embedding = await embedVerbatim(env, text);
  if (!embedding.length) return null;
  return { embedding, embeddingModel: EMBEDDING_MODEL };
}

/** Embed one verbatim; returns empty array when unconfigured or on failure. */
export async function embedVerbatim(env: ProviderEnv, text: string): Promise<number[]> {
  const trimmed = String(text || "").trim();
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!trimmed || !apiKey) return [];

  const model = EMBEDDING_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text: trimmed.slice(0, 2048) }] },
      }),
    });
    const data = (await res.json()) as EmbedResponse;
    if (!res.ok) {
      console.warn("[embeddings] API error:", data.error?.message || res.status);
      return [];
    }
    const values = data.embedding?.values;
    return Array.isArray(values) ? values : [];
  } catch (err) {
    console.warn("[embeddings] embed failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
