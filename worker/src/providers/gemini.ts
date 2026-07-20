// Google Gemini adapter — Google AI Studio (GEMINI_API_KEY) or Vertex AI on GCP (ADC).

import { toGeminiResponseSchema } from "../gemini-schema";
import type { LlmProvider, LlmRequest, LlmResult, ProviderEnv } from "./types";

const DEFAULT_MODEL = "gemini-2.5-flash";
/** Stable model for AI Studio keys — gemini-3.x preview ids 400 on generativelanguage.googleapis.com. */
const AI_STUDIO_STABLE_MODEL = DEFAULT_MODEL;

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
 * AI Studio (GEMINI_API_KEY) does not accept gemini-3.x preview model ids — they 400.
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

  if (isGemini3Model(trimmed)) {
    return { model: AI_STUDIO_STABLE_MODEL, remappedFrom: trimmed };
  }

  return { model: trimmed };
}

function shouldDisableThinking(req: LlmRequest): boolean {
  return (
    req.thinkingBudget === 0 ||
    !!req.jsonSchema ||
    (!req.research && req.effort === "low")
  );
}

function buildThinkingConfig(
  req: LlmRequest,
  model: string,
  backend: GeminiBackend,
): Record<string, unknown> | undefined {
  if (!shouldDisableThinking(req)) return undefined;

  // AI Studio stable models (2.x) use thinkingBudget; never send thinkingLevel there.
  if (backend.mode === "aistudio") {
    return { thinkingBudget: 0 };
  }

  // Vertex gemini-3.x rejects thinkingBudget — use thinkingLevel instead.
  if (isGemini3Model(model)) {
    return { thinkingLevel: "minimal" };
  }

  return { thinkingBudget: 0 };
}

function buildGenerationConfig(
  req: LlmRequest,
  model: string,
  backend: GeminiBackend,
): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: req.maxTokens,
    temperature: req.temperature ?? (req.research ? 0.4 : 0.2),
  };

  if (req.jsonSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = toGeminiResponseSchema(req.jsonSchema);
  }

  const thinkingConfig = buildThinkingConfig(req, model, backend);
  if (thinkingConfig) {
    generationConfig.thinkingConfig = thinkingConfig;
  }

  return generationConfig;
}

function buildRequestBody(
  req: LlmRequest,
  model: string,
  backend: GeminiBackend,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts: [{ text: req.user }] }],
    generationConfig: buildGenerationConfig(req, model, backend),
  };

  // google_search grounding — supported on gemini-2.5-flash+ with AI Studio keys.
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
): string {
  const base = `Gemini API ${status}: ${errBody.slice(0, 500)}`;
  const hints: string[] = [];

  if (status === 400 && backend.mode === "aistudio") {
    if (requestedModel !== effectiveModel) {
      hints.push(
        `MODEL=${requestedModel} is not valid on AI Studio; remapped to ${effectiveModel} — update deploy/vps/.env.`,
      );
    } else if (isGemini3Model(requestedModel)) {
      hints.push(
        `MODEL=${requestedModel} requires Vertex AI. Set MODEL=gemini-2.5-flash for GEMINI_API_KEY.`,
      );
    } else if (/INVALID_ARGUMENT/i.test(errBody)) {
      hints.push(
        "Check MODEL in deploy/vps/.env (use gemini-2.5-flash) and restart: docker compose up -d --build worker.",
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
    body: JSON.stringify(buildRequestBody(req, model, backend)),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(geminiApiErrorMessage(res.status, errBody, backend, requestedModel, model));
  }

  return parseGeminiResponse((await res.json()) as GeminiResponse);
}

async function generateViaVertex(
  project: string,
  location: string,
  model: string,
  req: LlmRequest,
  backend: GeminiBackend,
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
    body: JSON.stringify(buildRequestBody(req, model, backend)),
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
      `[gemini] MODEL=${remappedFrom} is not supported on AI Studio; using ${model}. ` +
        "Update deploy/vps/.env MODEL and POSTCALL_MODEL to gemini-2.5-flash.",
    );
  }

  return {
    async generate(req: LlmRequest): Promise<LlmResult> {
      if (backend.mode === "aistudio") {
        return generateViaAiStudio(backend.apiKey, model, req, backend, requestedModel);
      }
      return generateViaVertex(backend.project, backend.location, model, req, backend);
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
