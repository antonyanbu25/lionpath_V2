// Google Gemini adapter — Google AI Studio (GEMINI_API_KEY) or Vertex AI on GCP (ADC).

import { toGeminiResponseSchema } from "../gemini-schema";
import {
  fetchGeminiWithRetry,
  isGeminiSchemaErrorMessage,
  resolveGeminiTimeoutMs,
} from "./gemini-retry";
import type { Citation, LlmProvider, LlmRequest, LlmResult, LlmUsage, ProviderEnv } from "./types";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
/** Default model for AI Studio keys — GA on generativelanguage.googleapis.com since May 2026. */
const AI_STUDIO_DEFAULT_MODEL = DEFAULT_MODEL;

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiGroundingChunk {
  /** Verified against a live gemini-3.6-flash response: only uri + title are returned. */
  web?: { uri?: string; title?: string };
}

interface GeminiGroundingSupport {
  segment?: { startIndex?: number; endIndex?: number; text?: string };
  groundingChunkIndices?: number[];
}

interface GeminiGroundingMetadata {
  groundingChunks?: GeminiGroundingChunk[];
  groundingSupports?: GeminiGroundingSupport[];
  webSearchQueries?: string[];
  searchEntryPoint?: { renderedContent?: string };
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
    groundingMetadata?: GeminiGroundingMetadata;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: GeminiUsageMetadata;
  error?: { message?: string };
}

/** Max supporting-text segments joined into one citation snippet. */
const MAX_CITATION_SEGMENTS = 2;
const MAX_CITATION_SNIPPET_CHARS = 300;

/**
 * Turn groundingMetadata into citations. Pure, so it can be tested against a
 * recorded response (worker/testdata/grounding/).
 *
 * Note: Gemini does not return confidenceScores for grounding supports, so callers
 * must assign a constant confidence rather than deriving one.
 */
export function extractCitations(meta: GeminiGroundingMetadata | undefined): Citation[] {
  const chunks = meta?.groundingChunks || [];
  if (!chunks.length) return [];

  const citations: (Citation & { segments: string[] })[] = chunks.map((c) => ({
    uri: c.web?.uri || "",
    title: c.web?.title || "",
    segments: [],
  }));

  for (const support of meta?.groundingSupports || []) {
    const text = support.segment?.text?.trim();
    if (!text) continue;
    for (const idx of support.groundingChunkIndices || []) {
      const target = citations[idx];
      if (!target || target.segments.length >= MAX_CITATION_SEGMENTS) continue;
      if (target.segments.includes(text)) continue;
      target.segments.push(text);
    }
  }

  return citations
    .filter((c) => c.uri)
    .map(({ segments, ...rest }) => {
      const snippet = segments.join(" … ").slice(0, MAX_CITATION_SNIPPET_CHARS);
      return snippet ? { ...rest, snippet } : rest;
    });
}

type GeminiBackend =
  | { mode: "aistudio"; apiKey: string }
  | { mode: "vertex"; project: string; location: string };

/** Keep answer text only — thinking parts must not be concatenated into JSON output. */
function extractAnswerText(parts: GeminiPart[]): string {
  const answerParts = parts.filter((p) => p.text && p.thought !== true);
  if (answerParts.length) return answerParts.map((p) => p.text as string).join("");

  // Fallback: last part that looks like JSON (some models omit the thought flag).
  for (let i = parts.length - 1; i >= 0; i--) {
    const t = parts[i].text?.trim();
    if (t && t.startsWith("{")) return t;
  }
  return parts.map((p) => p.text || "").join("");
}

function resolveGeminiBackend(env: ProviderEnv): GeminiBackend {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (apiKey) return { mode: "aistudio", apiKey };

  const project = (env.GOOGLE_CLOUD_PROJECT || env.VERTEX_PROJECT || "").trim();
  if (project) {
    const location = (env.VERTEX_LOCATION || env.GOOGLE_CLOUD_LOCATION || "us-central1").trim();
    return { mode: "vertex", project, location };
  }

  throw new Error(
    "Gemini not configured: set GEMINI_API_KEY (Google AI Studio / local dev) or " +
      "GOOGLE_CLOUD_PROJECT + VERTEX_LOCATION (Vertex AI on GCP).",
  );
}

function isGemini3Model(model: string): boolean {
  return /^gemini-3/i.test(model);
}

/**
 * Legacy 2.x/1.x ids and deprecated preview names that should not be sent to AI Studio.
 * gemini-3.1-flash-lite-preview was shut down May 2026 — remap to the stable GA id.
 */
function isLegacyGeminiModel(model: string): boolean {
  if (model === "gemini-3.1-flash-lite-preview") return true;
  if (isGemini3Model(model)) return false;
  return /^gemini-/i.test(model);
}

/**
 * AI Studio (GEMINI_API_KEY): remap legacy 2.x/1.x models to gemini-3.1-flash-lite.
 * Vertex keeps the configured id. Returns the model actually sent to the API.
 */
export function normalizeGeminiModel(
  model: string,
  backend: GeminiBackend,
): { model: string; remappedFrom?: string } {
  const trimmed = (model || DEFAULT_MODEL).trim() || DEFAULT_MODEL;

  if (backend.mode === "vertex") {
    return { model: trimmed };
  }

  if (isLegacyGeminiModel(trimmed)) {
    return { model: AI_STUDIO_DEFAULT_MODEL, remappedFrom: trimmed };
  }

  return { model: trimmed };
}

function shouldReduceThinking(req: LlmRequest): boolean {
  return (
    req.thinkingBudget === 0 ||
    !!req.jsonSchema ||
    !!req.research ||
    (!req.research && req.effort === "low")
  );
}

function buildThinkingConfig(req: LlmRequest, model: string, env?: ProviderEnv): Record<string, unknown> | undefined {
  // Gemini 3.x requires explicit thinkingLevel on every request (especially with tools).
  if (isGemini3Model(model)) {
    if (req.research) {
      if (/flash-lite/i.test(model)) {
        return { thinkingLevel: "minimal" };
      }
      const level = env?.RESEARCH_THINKING_LEVEL?.trim() || "medium";
      return { thinkingLevel: level };
    }
    return { thinkingLevel: "minimal" };
  }

  if (!shouldReduceThinking(req)) return undefined;
  return { thinkingBudget: 0 };
}

function buildGenerationConfig(req: LlmRequest, model: string, env?: ProviderEnv): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: req.maxTokens,
    temperature: req.temperature ?? (req.research ? 0.4 : 0.2),
  };

  if (req.seed != null) {
    generationConfig.seed = req.seed;
  }

  if (req.jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = toGeminiResponseSchema(req.jsonSchema);
  } else if (req.jsonMimeOnly) {
    generationConfig.responseMimeType = "application/json";
  }

  const thinkingConfig = buildThinkingConfig(req, model, env);
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }

  return generationConfig;
}

function buildRequestBody(req: LlmRequest, model: string, env?: ProviderEnv): Record<string, unknown> {
  const cacheRef = req.cachedSystemContent || req.cachedContent;
  const useTranscriptCache = !!req.cachedContent && !req.cachedSystemContent;

  // Transcript cachedContent cannot coexist with systemInstruction — fold system into user.
  let userText = req.user;
  if (useTranscriptCache && req.system?.trim()) {
    userText = `${req.system.trim()}\n\n---\n\n${req.user}`;
  }

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: buildGenerationConfig(req, model, env),
  };

  if (cacheRef) {
    body.cachedContent = cacheRef;
  }

  // Rubric/static cache holds systemInstruction; plain path sends it normally.
  if (!req.cachedSystemContent && !useTranscriptCache && req.system) {
    body.systemInstruction = { parts: [{ text: req.system }] };
  }

  // google_search grounding — supported on gemini-3.x with AI Studio keys.
  if (req.research) {
    body.tools = [{ google_search: {} }];
  }

  return body;
}

function buildUsage(
  model: string,
  usageMetadata: GeminiUsageMetadata | undefined,
  groundingMetadata: GeminiGroundingMetadata | undefined,
  latencyMs: number,
  retryCount = 0,
): LlmUsage {
  return {
    model,
    promptTokens: usageMetadata?.promptTokenCount ?? 0,
    outputTokens: usageMetadata?.candidatesTokenCount ?? 0,
    cachedTokens: usageMetadata?.cachedContentTokenCount ?? 0,
    groundingQueries: groundingMetadata?.webSearchQueries?.length ?? 0,
    latencyMs,
    retryCount,
  };
}

function parseGeminiResponse(
  data: GeminiResponse,
  model: string,
  latencyMs: number,
  retryCount = 0,
): LlmResult {
  if (data.error?.message) throw new Error(data.error.message);

  const cand = data.candidates?.[0];
  if (!cand) {
    const blocked = data.promptFeedback?.blockReason;
    throw new Error(`Gemini returned no candidates${blocked ? ` (blocked: ${blocked})` : ""}.`);
  }

  const parts = cand.content?.parts || [];
  const text = extractAnswerText(parts);
  if (!text) {
    throw new Error(
      `Gemini produced no text (finishReason: ${cand.finishReason ?? "unknown"}). ` +
        `If "MAX_TOKENS", raise maxTokens; if "SAFETY"/"RECITATION", the query was filtered.`,
    );
  }

  // LlmResult.citations / .searchQueries are declared but were never populated, so every
  // consumer of grounded provenance read undefined — the source table, the citation
  // numbering and the confidence gates all degraded silently rather than failing.
  const out: LlmResult = { text };
  const meta = cand.groundingMetadata;
  const citations = extractCitations(meta);
  if (citations.length) out.citations = citations;
  if (meta?.webSearchQueries?.length) out.searchQueries = meta.webSearchQueries;
  const entryPoint = meta?.searchEntryPoint?.renderedContent;
  if (entryPoint) out.searchEntryPointHtml = entryPoint;
  out.usage = buildUsage(model, data.usageMetadata, meta, latencyMs, retryCount);
  return out;
}

function geminiApiErrorMessage(
  status: number,
  errBody: string,
  backend: GeminiBackend,
  requestedModel: string,
  effectiveModel: string,
  step?: string,
): string {
  const stepPrefix = step ? `[${step}] ` : "";
  const base = `${stepPrefix}Gemini API ${status}: ${errBody}`;
  const hints: string[] = [];

  if ((status === 400 || status === 404) && backend.mode === "aistudio") {
    if (requestedModel !== effectiveModel) {
      hints.push(
        `MODEL=${requestedModel} is deprecated on AI Studio; remapped to ${effectiveModel} — update deploy/vps/.env.`,
      );
    } else if (/INVALID_ARGUMENT/i.test(errBody) && /thinking/i.test(errBody)) {
      hints.push(
        "Gemini 3 requires thinkingLevel minimal (not thinkingBudget). Ensure MODEL=gemini-3.1-flash-lite.",
      );
    } else if (/INVALID_ARGUMENT/i.test(errBody) && /google.?search|grounding|tool/i.test(errBody)) {
      hints.push(
        "Google Search grounding failed — confirm MODEL=gemini-3.1-flash-lite supports google_search on your API key.",
      );
    } else if (/INVALID_ARGUMENT/i.test(errBody) && /schema|responseSchema|response_schema/i.test(errBody)) {
      hints.push("Structured output schema rejected — check prep extract/synthesize JSON schema.");
    } else if (/INVALID_ARGUMENT/i.test(errBody)) {
      hints.push(
        "Check MODEL in deploy/vps/.env (use gemini-3.1-flash-lite) and restart: docker compose up -d --build worker.",
      );
    }
  }

  return hints.length ? `${base} ${hints.join(" ")}` : base;
}

async function getVertexAccessToken(): Promise<string> {
  if (typeof process === "undefined" || !process.versions?.node) {
    throw new Error(
      "Vertex AI requires Node.js (Cloud Run / VPS). Use GEMINI_API_KEY for Cloudflare Workers / wrangler dev.",
    );
  }

  const { GoogleAuth } = await import("google-auth-library");
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  if (!tokenResponse.token) {
    throw new Error("Failed to obtain Vertex AI access token from Application Default Credentials.");
  }
  return tokenResponse.token;
}

async function fetchGemini(
  url: string,
  init: RequestInit,
  req: LlmRequest,
): Promise<{ response: Response; retryCount: number }> {
  return fetchGeminiWithRetry(url, init, {
    timeoutMs: resolveGeminiTimeoutMs(req),
    step: req.step ?? req.passName,
  });
}

async function generateViaAiStudio(
  apiKey: string,
  model: string,
  req: LlmRequest,
  backend: GeminiBackend,
  requestedModel: string,
  env: ProviderEnv,
): Promise<LlmResult> {
  const started = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const { response: res, retryCount } = await fetchGemini(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildRequestBody(req, model, env)),
    },
    req,
  );
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(
      geminiApiErrorMessage(res.status, errBody, backend, requestedModel, model, req.step),
    );
  }

  return parseGeminiResponse(
    (await res.json()) as GeminiResponse,
    model,
    Date.now() - started,
    retryCount,
  );
}

async function generateViaVertex(
  project: string,
  location: string,
  model: string,
  req: LlmRequest,
  env: ProviderEnv,
): Promise<LlmResult> {
  const started = Date.now();
  const token = await getVertexAccessToken();
  const url =
    `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}` +
    `/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

  const { response: res, retryCount } = await fetchGemini(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(buildRequestBody(req, model, env)),
    },
    req,
  );
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Vertex AI Gemini ${res.status}: ${errBody.slice(0, 500)}`);
  }

  return parseGeminiResponse(
    (await res.json()) as GeminiResponse,
    model,
    Date.now() - started,
    retryCount,
  );
}

export function geminiProvider(env: ProviderEnv, modelOverride?: string): LlmProvider {
  const requestedModel = modelOverride || env.MODEL || DEFAULT_MODEL;
  const backend = resolveGeminiBackend(env);
  const { model, remappedFrom } = normalizeGeminiModel(requestedModel, backend);

  if (remappedFrom) {
    console.warn(
      `[gemini] MODEL=${remappedFrom} is deprecated on AI Studio; using ${model}. ` +
        "Update deploy/vps/.env MODEL and POSTCALL_MODEL to gemini-3.1-flash-lite.",
    );
  }

  const generateWithModel = async (useModel: string, req: LlmRequest): Promise<LlmResult> => {
    if (backend.mode === "aistudio") {
      return generateViaAiStudio(backend.apiKey, useModel, req, backend, requestedModel, env);
    }
    return generateViaVertex(backend.project, backend.location, useModel, req, env);
  };

  return {
    async generate(req: LlmRequest): Promise<LlmResult> {
      try {
        return await generateWithModel(model, req);
      } catch (err) {
        const msg = (err as Error).message;
        if (isGeminiSchemaErrorMessage(msg)) throw err;
        if (
          req.research &&
          /MALFORMED_FUNCTION_CALL/.test(msg) &&
          model !== DEFAULT_MODEL
        ) {
          console.warn(
            `[gemini] ${req.step ?? "research"}: MALFORMED_FUNCTION_CALL on ${model}; ` +
              `retrying once with ${DEFAULT_MODEL}`,
          );
          return generateWithModel(DEFAULT_MODEL, req);
        }
        throw err;
      }
    },
  };
}

/** Model id actually sent to the Gemini API after AI Studio remapping. */
export function effectiveGeminiModel(env: ProviderEnv, modelOverride?: string): string {
  const requested = modelOverride || env.MODEL || DEFAULT_MODEL;
  try {
    const backend = resolveGeminiBackend(env);
    return normalizeGeminiModel(requested, backend).model;
  } catch {
    return requested;
  }
}

/** True when Vertex AI (GCP ADC) is active instead of AI Studio API key. */
export function usesVertexAi(env: ProviderEnv): boolean {
  return !env.GEMINI_API_KEY?.trim() && !!(env.GOOGLE_CLOUD_PROJECT || env.VERTEX_PROJECT)?.trim();
}
