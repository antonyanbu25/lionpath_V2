/**
 * Gemini Batch API — submit / poll / collect for generateContent and embedContent.
 * Uses Google AI Studio REST (GEMINI_API_KEY). Batch is ~50% cheaper than interactive calls.
 */

import { toGeminiResponseSchema } from "../gemini-schema";
import type { ProviderEnv } from "./types";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export type GeminiBatchState =
  | "JOB_STATE_PENDING"
  | "JOB_STATE_RUNNING"
  | "JOB_STATE_SUCCEEDED"
  | "JOB_STATE_FAILED"
  | "JOB_STATE_CANCELLED"
  | "JOB_STATE_EXPIRED"
  | string;

export const TERMINAL_BATCH_STATES = new Set<GeminiBatchState>([
  "JOB_STATE_SUCCEEDED",
  "JOB_STATE_FAILED",
  "JOB_STATE_CANCELLED",
  "JOB_STATE_EXPIRED",
]);

export interface BatchGenerateItem {
  key: string;
  system: string;
  user: string;
  maxTokens?: number;
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
}

export interface BatchEmbedItem {
  key: string;
  text: string;
}

export interface BatchItemResult {
  key: string;
  ok: boolean;
  text?: string;
  embedding?: number[];
  error?: string;
  usage?: {
    promptTokens: number;
    outputTokens: number;
  };
}

export interface GeminiBatchJobRef {
  name: string;
  state: GeminiBatchState;
  displayName?: string;
  error?: string;
}

function requireApiKey(env: ProviderEnv): string {
  const key = env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw Object.assign(new Error("GEMINI_API_KEY is required for Gemini Batch API."), { status: 503 });
  }
  return key;
}

function normalizeModelId(model: string): string {
  const trimmed = model.trim();
  return trimmed.startsWith("models/") ? trimmed.slice("models/".length) : trimmed;
}

async function batchFetch(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const url = `${API_BASE}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, init);
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const err = data.error as { message?: string } | undefined;
    throw new Error(err?.message || `Gemini Batch HTTP ${res.status}`);
  }
  return data;
}

function pickString(obj: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) return val;
  }
  return undefined;
}

function pickRecord(obj: Record<string, unknown> | undefined, ...keys: string[]): Record<string, unknown> | undefined {
  if (!obj) return undefined;
  for (const key of keys) {
    const val = obj[key];
    if (val && typeof val === "object" && !Array.isArray(val)) return val as Record<string, unknown>;
  }
  return undefined;
}

/** Extract batch job from create/get response (handles Operation wrapper). */
export function parseBatchJobResponse(data: Record<string, unknown>): GeminiBatchJobRef {
  const batch =
    pickRecord(data, "batch") ||
    pickRecord(data, "response") ||
    pickRecord(data, "metadata") ||
    data;

  const name = pickString(batch, "name") || pickString(data, "name");
  if (!name) {
    throw new Error("Gemini Batch response missing job name.");
  }

  const stateRaw = batch.state;
  let state: GeminiBatchState = "JOB_STATE_PENDING";
  if (typeof stateRaw === "string") {
    state = stateRaw;
  } else if (stateRaw && typeof stateRaw === "object") {
    state = pickString(stateRaw as Record<string, unknown>, "name") || state;
  }

  return {
    name,
    state,
    displayName: pickString(batch, "displayName", "display_name"),
    error: pickString(batch, "error") || pickString(pickRecord(batch, "error"), "message"),
  };
}

function buildGenerateRequest(item: BatchGenerateItem): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: item.maxTokens ?? 3500,
    temperature: item.temperature ?? 0.2,
  };
  if (item.jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = toGeminiResponseSchema(item.jsonSchema);
  }

  const parts: Record<string, unknown>[] = [];
  if (item.system.trim()) {
    parts.push({ text: item.system });
  }
  parts.push({ text: item.user });

  return {
    contents: [{ role: "user", parts }],
    generationConfig,
  };
}

function buildEmbedRequest(model: string, item: BatchEmbedItem): Record<string, unknown> {
  return {
    model: `models/${normalizeModelId(model)}`,
    content: { parts: [{ text: item.text.slice(0, 2048) }] },
  };
}

/** Submit inline generateContent batch. */
export async function submitGenerateBatch(
  env: ProviderEnv,
  model: string,
  items: BatchGenerateItem[],
  displayName: string,
): Promise<GeminiBatchJobRef> {
  const apiKey = requireApiKey(env);
  if (!items.length) throw new Error("submitGenerateBatch requires at least one item.");

  const modelId = normalizeModelId(model);
  const body = {
    batch: {
      display_name: displayName,
      input_config: {
        requests: {
          requests: items.map((item) => ({
            request: buildGenerateRequest(item),
            metadata: { key: item.key },
          })),
        },
      },
    },
  };

  const data = await batchFetch(apiKey, `/models/${encodeURIComponent(modelId)}:batchGenerateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return parseBatchJobResponse(data);
}

/** Submit inline embedContent batch. */
export async function submitEmbedBatch(
  env: ProviderEnv,
  model: string,
  items: BatchEmbedItem[],
  displayName: string,
): Promise<GeminiBatchJobRef> {
  const apiKey = requireApiKey(env);
  if (!items.length) throw new Error("submitEmbedBatch requires at least one item.");

  const modelId = normalizeModelId(model);
  const body = {
    batch: {
      displayName,
      inputConfig: {
        requests: {
          requests: items.map((item) => ({
            request: buildEmbedRequest(modelId, item),
            metadata: { key: item.key },
          })),
        },
      },
    },
  };

  const data = await batchFetch(apiKey, `/models/${encodeURIComponent(modelId)}:asyncBatchEmbedContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return parseBatchJobResponse(data);
}

/** Poll batch job state. */
export async function pollBatchJob(env: ProviderEnv, jobName: string): Promise<GeminiBatchJobRef> {
  const apiKey = requireApiKey(env);
  const name = jobName.startsWith("batches/") ? jobName : `batches/${jobName}`;
  const data = await batchFetch(apiKey, `/${name}`, { method: "GET" });
  return parseBatchJobResponse(data);
}

function extractTextFromGenerateResponse(response: Record<string, unknown>): string {
  const candidates = response.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
  const parts = candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("").trim();
}

function extractUsage(response: Record<string, unknown>): { promptTokens: number; outputTokens: number } {
  const meta = response.usageMetadata as
    | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    | undefined;
  return {
    promptTokens: meta?.promptTokenCount ?? meta?.totalTokenCount ?? 0,
    outputTokens: meta?.candidatesTokenCount ?? 0,
  };
}

function inlineResponsesFromBatch(data: Record<string, unknown>): Array<Record<string, unknown>> {
  const batch = pickRecord(data, "batch") || data;
  const dest = pickRecord(batch, "dest", "output") || {};
  const inline =
    (dest.inlinedResponses as Array<Record<string, unknown>> | undefined) ||
    (dest.inlined_responses as Array<Record<string, unknown>> | undefined) ||
    [];
  return inline;
}

function inlineEmbedResponsesFromBatch(data: Record<string, unknown>): Array<Record<string, unknown>> {
  const batch = pickRecord(data, "batch") || data;
  const dest = pickRecord(batch, "dest", "output") || {};
  const inline =
    (dest.inlinedEmbedContentResponses as Array<Record<string, unknown>> | undefined) ||
    (dest.inlined_embed_content_responses as Array<Record<string, unknown>> | undefined) ||
    [];
  return inline;
}

function metadataKey(entry: Record<string, unknown>): string {
  const meta = pickRecord(entry, "metadata") || {};
  return pickString(meta, "key") || "";
}

/** Collect per-item generate results from a succeeded batch job. */
export async function collectGenerateResults(
  env: ProviderEnv,
  jobName: string,
  expectedKeys: string[],
): Promise<BatchItemResult[]> {
  const apiKey = requireApiKey(env);
  const name = jobName.startsWith("batches/") ? jobName : `batches/${jobName}`;
  const data = await batchFetch(apiKey, `/${name}`, { method: "GET" });
  const inline = inlineResponsesFromBatch(data);

  const byKey = new Map<string, BatchItemResult>();
  for (const entry of inline) {
    const key = metadataKey(entry) || pickString(entry, "key") || "";
    if (!key) continue;

    const err = pickRecord(entry, "error");
    if (err) {
      byKey.set(key, {
        key,
        ok: false,
        error: pickString(err, "message") || JSON.stringify(err).slice(0, 200),
      });
      continue;
    }

    const response = pickRecord(entry, "response");
    if (!response) {
      byKey.set(key, { key, ok: false, error: "empty response" });
      continue;
    }

    byKey.set(key, {
      key,
      ok: true,
      text: extractTextFromGenerateResponse(response),
      usage: extractUsage(response),
    });
  }

  return expectedKeys.map((key) => byKey.get(key) || { key, ok: false, error: "missing from batch output" });
}

/** Collect per-item embed results from a succeeded batch job. */
export async function collectEmbedResults(
  env: ProviderEnv,
  jobName: string,
  expectedKeys: string[],
): Promise<BatchItemResult[]> {
  const apiKey = requireApiKey(env);
  const name = jobName.startsWith("batches/") ? jobName : `batches/${jobName}`;
  const data = await batchFetch(apiKey, `/${name}`, { method: "GET" });
  const inline = inlineEmbedResponsesFromBatch(data);

  const byKey = new Map<string, BatchItemResult>();
  for (const entry of inline) {
    const key = metadataKey(entry) || pickString(entry, "key") || "";
    if (!key) continue;

    const err = pickRecord(entry, "error");
    if (err) {
      byKey.set(key, {
        key,
        ok: false,
        error: pickString(err, "message") || JSON.stringify(err).slice(0, 200),
      });
      continue;
    }

    const response = pickRecord(entry, "response");
    const embeddingObj = response?.embedding as { values?: number[] } | undefined;
    const values = embeddingObj?.values;
    if (!Array.isArray(values) || !values.length) {
      byKey.set(key, { key, ok: false, error: "empty embedding" });
      continue;
    }

    byKey.set(key, {
      key,
      ok: true,
      embedding: values,
      usage: {
        promptTokens:
          (response?.usageMetadata as { promptTokenCount?: number } | undefined)?.promptTokenCount ?? 0,
        outputTokens: 0,
      },
    });
  }

  return expectedKeys.map((key) => byKey.get(key) || { key, ok: false, error: "missing from batch output" });
}
