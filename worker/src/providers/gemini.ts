// Google Gemini adapter — Google AI Studio (GEMINI_API_KEY) or Vertex AI on GCP (ADC).

import { toGeminiResponseSchema } from "../gemini-schema";
import type { LlmProvider, LlmRequest, LlmResult, ProviderEnv } from "./types";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
/** Default model for AI Studio keys — GA on generativelanguage.googleapis.com since May 2026. */
const AI_STUDIO_DEFAULT_MODEL = DEFAULT_MODEL;

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
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

function buildThinkingConfig(req: LlmRequest, model: string): Record<string, unknown> | undefined {
  // Gemini 3.x requires explicit thinkingLevel on every request (especially with tools).
  // Flash-Lite on AI Studio: always minimal — same as post-call (thinkingBudget:0).
  // Omitting thinkingLevel 400s with google_search; thinkingLevel "low" also 400s there.
  if (isGemini3Model(model)) {
    return { thinkingLevel: "minimal" };
  }

  if (!shouldReduceThinking(req)) return undefined;
  return { thinkingBudget: 0 };
}

function buildGenerationConfig(req: LlmRequest, model: string): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: req.maxTokens,
    temperature: req.temperature ?? (req.research ? 0.4 : 0.2),
  };

  if (req.jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = toGeminiResponseSchema(req.jsonSchema);
  } else if (req.jsonMimeOnly) {
    generationConfig.responseMimeType = "application/json";
  }

  const thinkingConfig = buildThinkingConfig(req, model);
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }

  return generationConfig;
}

function buildRequestBody(req: LlmRequest, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts: [{ text: req.user }] }],
    generationConfig: buildGenerationConfig(req, model),
  };

  // google_search grounding — supported on gemini-3.x with AI Studio keys.
  if (req.research) {
    body.tools = [{ google_search: {} }];
  }

  return body;
}

function parseGeminiResponse(data: GeminiResponse): LlmResult {
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
  return { text };
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
  const base = `${stepPrefix}Gemini API ${status}: ${errBody.slice(0, 500)}`;
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

async function generateViaAiStudio(
  apiKey: string,
  model: string,
  req: LlmRequest,
  backend: GeminiBackend,
  requestedModel: string,
): Promise<LlmResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildRequestBody(req, model)),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(
      geminiApiErrorMessage(res.status, errBody, backend, requestedModel, model, req.step),
    );
  }

  return parseGeminiResponse((await res.json()) as GeminiResponse);
}

async function generateViaVertex(
  project: string,
  location: string,
  model: string,
  req: LlmRequest,
): Promise<LlmResult> {
  const token = await getVertexAccessToken();
  const url =
    `https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}` +
    `/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(buildRequestBody(req, model)),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Vertex AI Gemini ${res.status}: ${errBody.slice(0, 500)}`);
  }

  return parseGeminiResponse((await res.json()) as GeminiResponse);
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

  return {
    async generate(req: LlmRequest): Promise<LlmResult> {
      if (backend.mode === "aistudio") {
        return generateViaAiStudio(backend.apiKey, model, req, backend, requestedModel);
      }
      return generateViaVertex(backend.project, backend.location, model, req);
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
