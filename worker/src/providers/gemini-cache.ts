/**
 * Gemini explicit context caching — AI Studio first, provider-agnostic interface.
 * Caching failures never propagate; callers fall back to uncached generateContent.
 */

import { createHash } from "node:crypto";
import type { ProviderEnv } from "./types";
import { effectiveGeminiModel, usesVertexAi } from "./gemini";

export interface GeminiCacheHandle {
  name: string;
  tokenCount?: number;
}

export type PostCallTranscriptVariant =
  | "headTail2500"
  | "tail6000"
  | "timestamped5500"
  | "timestampedSummarise";

export interface PostCallTranscriptCacheBundle {
  caches: Partial<Record<PostCallTranscriptVariant, GeminiCacheHandle>>;
  skipped: boolean;
}

export interface TranscriptCacheInput {
  transcript: string;
  callId?: string;
  ttlSeconds: number;
  model: string;
  variant: PostCallTranscriptVariant;
  formattedText: string;
}

export interface StaticCacheInput {
  cacheKey: string;
  content: string;
  model: string;
  ttlSeconds: number;
  /** When set, cache systemInstruction instead of user contents. */
  asSystemInstruction?: boolean;
}

type GeminiBackend =
  | { mode: "aistudio"; apiKey: string }
  | { mode: "vertex"; project: string; location: string };

interface StaticCacheEntry {
  handle: GeminiCacheHandle;
  expiresAtMs: number;
}

/** Process-local registry — refreshed on deploy via restart. */
const staticCacheRegistry = new Map<string, StaticCacheEntry>();

const DEFAULT_POSTCALL_CACHE_TTL_SECONDS = 900;

function resolveBackend(env: ProviderEnv): GeminiBackend | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (apiKey) return { mode: "aistudio", apiKey };

  const project = (env.GOOGLE_CLOUD_PROJECT || env.VERTEX_PROJECT || "").trim();
  if (project) {
    const location = (env.VERTEX_LOCATION || env.GOOGLE_CLOUD_LOCATION || "us-central1").trim();
    return { mode: "vertex", project, location };
  }
  return null;
}

function modelResourceId(model: string): string {
  const trimmed = model.trim();
  return trimmed.startsWith("models/") ? trimmed : `models/${trimmed}`;
}

/** Minimum cacheable tokens by model family (Gemini API explicit caching). */
export function minCacheTokenFloor(model: string): number {
  if (/flash-lite/i.test(model)) return 1024;
  if (/^gemini-3/i.test(model)) return 4096;
  if (/^gemini-2/i.test(model)) return 2048;
  return 4096;
}

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

async function countTokensAiStudio(
  apiKey: string,
  model: string,
  text: string,
  asSystemInstruction?: boolean,
): Promise<number | null> {
  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/${encodeURIComponent(modelResourceId(model))}` +
      `:countTokens?key=${encodeURIComponent(apiKey)}`;
    const body: Record<string, unknown> = asSystemInstruction
      ? { systemInstruction: { parts: [{ text }] } }
      : { contents: [{ role: "user", parts: [{ text }] }] };
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { totalTokens?: number };
    return typeof data.totalTokens === "number" ? data.totalTokens : null;
  } catch {
    return null;
  }
}

async function createCacheAiStudio(
  apiKey: string,
  model: string,
  displayName: string,
  ttlSeconds: number,
  text: string,
  asSystemInstruction?: boolean,
): Promise<GeminiCacheHandle | null> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${encodeURIComponent(apiKey)}`;
    const body: Record<string, unknown> = {
      model: modelResourceId(model),
      ttl: `${Math.max(60, ttlSeconds)}s`,
      displayName: displayName.slice(0, 128),
    };
    if (asSystemInstruction) {
      body.systemInstruction = { parts: [{ text }] };
    } else {
      body.contents = [{ role: "user", parts: [{ text }] }];
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text();
      console.warn(`[gemini-cache] create failed (${res.status}): ${errBody.slice(0, 300)}`);
      return null;
    }
    const data = (await res.json()) as { name?: string; usageMetadata?: { totalTokenCount?: number } };
    if (!data.name) return null;
    return {
      name: data.name,
      tokenCount: data.usageMetadata?.totalTokenCount,
    };
  } catch (err) {
    console.warn("[gemini-cache] create error:", (err as Error).message);
    return null;
  }
}

async function deleteCacheAiStudio(apiKey: string, name: string): Promise<void> {
  try {
    const resource = name.startsWith("cachedContents/") ? name : `cachedContents/${name}`;
    const url =
      `https://generativelanguage.googleapis.com/v1beta/${encodeURIComponent(resource)}` +
      `?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      console.warn(`[gemini-cache] delete failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
  } catch (err) {
    console.warn("[gemini-cache] delete error:", (err as Error).message);
  }
}

/** Vertex explicit caching — not wired yet; returns null so callers fall back. */
async function createCacheVertex(
  _backend: Extract<GeminiBackend, { mode: "vertex" }>,
  _model: string,
  _displayName: string,
  _ttlSeconds: number,
  _text: string,
  _asSystemInstruction?: boolean,
): Promise<GeminiCacheHandle | null> {
  console.warn("[gemini-cache] Vertex explicit caching not implemented — using uncached fallback.");
  return null;
}

async function deleteCacheVertex(_backend: Extract<GeminiBackend, { mode: "vertex" }>, _name: string): Promise<void> {
  // no-op until Vertex path is wired
}

function postCallCacheTtlSeconds(env: ProviderEnv): number {
  const raw = (env as ProviderEnv & { POSTCALL_CACHE_TTL_SECONDS?: string }).POSTCALL_CACHE_TTL_SECONDS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 60) return Math.floor(parsed);
  return DEFAULT_POSTCALL_CACHE_TTL_SECONDS;
}

export function resolvePostCallCacheModel(env: ProviderEnv): string {
  return effectiveGeminiModel(env, env.POSTCALL_MODEL || env.MODEL);
}

/**
 * Create a cachedContents resource for one transcript variant.
 * Returns null when below token floor or on any API error.
 */
export async function createTranscriptCache(
  env: ProviderEnv,
  input: TranscriptCacheInput,
): Promise<GeminiCacheHandle | null> {
  const backend = resolveBackend(env);
  if (!backend) return null;

  const floor = minCacheTokenFloor(input.model);
  if (backend.mode === "aistudio") {
    const tokens = await countTokensAiStudio(backend.apiKey, input.model, input.formattedText);
    if (tokens != null && tokens < floor) return null;
  }

  const displayName = input.callId
    ? `postcall-${input.variant}-${input.callId}`
    : `postcall-${input.variant}-${contentHash(input.formattedText)}`;

  if (backend.mode === "aistudio") {
    return createCacheAiStudio(
      backend.apiKey,
      input.model,
      displayName,
      input.ttlSeconds,
      input.formattedText,
    );
  }
  return createCacheVertex(backend, input.model, displayName, input.ttlSeconds, input.formattedText);
}

/** Delete a cachedContents resource — errors are swallowed. */
export async function deleteTranscriptCache(env: ProviderEnv, name: string): Promise<void> {
  if (!name?.trim()) return;
  const backend = resolveBackend(env);
  if (!backend) return;

  if (backend.mode === "aistudio") {
    await deleteCacheAiStudio(backend.apiKey, name);
    return;
  }
  await deleteCacheVertex(backend, name);
}

/**
 * Global static cache keyed by content hash — amortizes rubric/KB across all users.
 * Reuses in-process handle when content hash matches and TTL not expired.
 */
export async function getStaticCache(
  env: ProviderEnv,
  input: StaticCacheInput,
): Promise<GeminiCacheHandle | null> {
  const backend = resolveBackend(env);
  if (!backend) return null;

  const hash = contentHash(input.content);
  const registryKey = `${input.cacheKey}:${hash}:${input.asSystemInstruction ? "sys" : "usr"}`;
  const existing = staticCacheRegistry.get(registryKey);
  if (existing && existing.expiresAtMs > Date.now()) {
    return existing.handle;
  }

  const floor = minCacheTokenFloor(input.model);
  if (backend.mode === "aistudio") {
    const tokens = await countTokensAiStudio(
      backend.apiKey,
      input.model,
      input.content,
      input.asSystemInstruction,
    );
    if (tokens != null && tokens < floor) return null;
  }

  const displayName = `static-${input.cacheKey}-${hash}`;

  let handle: GeminiCacheHandle | null;
  if (backend.mode === "aistudio") {
    handle = await createCacheAiStudio(
      backend.apiKey,
      input.model,
      displayName,
      input.ttlSeconds,
      input.content,
      input.asSystemInstruction,
    );
  } else {
    handle = await createCacheVertex(
      backend,
      input.model,
      displayName,
      input.ttlSeconds,
      input.content,
      input.asSystemInstruction,
    );
  }

  if (handle) {
    staticCacheRegistry.set(registryKey, {
      handle,
      expiresAtMs: Date.now() + input.ttlSeconds * 1000,
    });
  }
  return handle;
}

/** Release all handles in a post-call transcript bundle. */
export async function releasePostCallTranscriptCaches(
  env: ProviderEnv,
  bundle: PostCallTranscriptCacheBundle | null | undefined,
): Promise<void> {
  if (!bundle?.caches) return;
  const names = Object.values(bundle.caches)
    .map((h) => h?.name)
    .filter(Boolean) as string[];
  await Promise.all(names.map((name) => deleteTranscriptCache(env, name)));
}

/** True when explicit caching is available for the configured backend. */
export function geminiCachingAvailable(env: ProviderEnv): boolean {
  if (usesVertexAi(env)) return false; // Vertex stub — fall back until wired
  return !!env.GEMINI_API_KEY?.trim();
}

export { postCallCacheTtlSeconds };
