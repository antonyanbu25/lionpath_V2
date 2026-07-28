/**
 * Gemini vision over Pass 2 keyframes.
 * - camera_on_pct: never inferred from transcript
 * - cde_customized: product tenant looks real vs stock seed data
 * Face/camera judgement requires visualAnalysisConsent === true.
 */

import { readFile } from "node:fs/promises";
import type { ProviderEnv } from "../providers/types";
import type { SampleFrame } from "./facts";

const MAX_VISION_FRAMES = 16;

export interface VisionAnalysis {
  cameraOnPct: number | null;
  cdeCustomized: boolean | null;
  cdeEvidence: string | null;
  /** 0..100 rough share-of-screen estimate when detectable. */
  shareOnPct: number | null;
}

function apiKey(env: ProviderEnv): string | undefined {
  return env.GEMINI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
}

function modelId(env: ProviderEnv): string {
  return (
    env.POSTCALL_MODEL?.trim() ||
    env.MODEL?.trim() ||
    process.env.POSTCALL_MODEL?.trim() ||
    "gemini-3.1-flash-lite"
  );
}

async function buildImageParts(keyframes: SampleFrame[]): Promise<Array<Record<string, unknown>>> {
  const parts: Array<Record<string, unknown>> = [];
  for (const frame of keyframes.slice(0, MAX_VISION_FRAMES)) {
    try {
      const bytes = await readFile(frame.path);
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: bytes.toString("base64"),
        },
      });
    } catch {
      // skip
    }
  }
  return parts;
}

async function callGeminiJson(
  env: ProviderEnv,
  textPrompt: string,
  imageParts: Array<Record<string, unknown>>,
): Promise<Record<string, unknown> | null> {
  const key = apiKey(env);
  if (!key || !imageParts.length) return null;

  const model = modelId(env);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: textPrompt }, ...imageParts] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    console.warn("[video/vision] Gemini", res.status, (await res.text()).slice(0, 200));
    return null;
  }

  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Full Pass 2 vision. When consent is false, skips face/camera judgement;
 * still attempts CDE/share cues from screen content only.
 */
export async function analyzeKeyframes(
  env: ProviderEnv,
  keyframes: SampleFrame[],
  opts?: { visualAnalysisConsent?: boolean },
): Promise<VisionAnalysis> {
  const empty: VisionAnalysis = {
    cameraOnPct: null,
    cdeCustomized: null,
    cdeEvidence: null,
    shareOnPct: null,
  };
  if (!keyframes.length) return empty;

  const imageParts = await buildImageParts(keyframes);
  if (!imageParts.length) return empty;

  const consent = !!opts?.visualAnalysisConsent;
  const prompt = consent
    ? [
        "You are analyzing SE demo/call recording keyframes for coaching scorecards.",
        "For each image consider: (1) human camera tile visible, (2) screen share region,",
        "(3) whether a product CDE/tenant looks customized for a real customer vs stock seed data",
        '(Acme Corp, demo@, placeholder logos, "Your Company").',
        "Reply JSON only:",
        JSON.stringify({
          cameraOnCount: "<int>",
          total: "<int>",
          cameraOnPct: "<0-100 int>",
          shareOnPct: "<0-100 int estimated frames with screenshare>",
          cdeCustomized: "<boolean|null if cannot tell>",
          cdeEvidence: "<max 25 words or null>",
        }),
      ].join(" ")
    : [
        "You are analyzing SE call screenshare keyframes. DO NOT identify or describe faces.",
        "Judge only screen content: share-of-screen presence and whether a product CDE/tenant",
        "looks customized for a real customer vs stock seed data (Acme Corp, demo@, placeholders).",
        "Set cameraOnPct to null (consent not granted for face analysis).",
        "Reply JSON only:",
        JSON.stringify({
          cameraOnPct: null,
          shareOnPct: "<0-100 int>",
          cdeCustomized: "<boolean|null>",
          cdeEvidence: "<max 25 words or null>",
        }),
      ].join(" ");

  const parsed = await callGeminiJson(env, prompt, imageParts);
  if (!parsed) return empty;

  const cameraRaw = parsed.cameraOnPct;
  const shareRaw = parsed.shareOnPct;
  const cde = parsed.cdeCustomized;
  const evidence =
    typeof parsed.cdeEvidence === "string" ? parsed.cdeEvidence.trim().slice(0, 160) : null;

  return {
    cameraOnPct:
      consent && typeof cameraRaw === "number" && Number.isFinite(cameraRaw)
        ? Math.max(0, Math.min(100, Math.round(cameraRaw)))
        : null,
    shareOnPct:
      typeof shareRaw === "number" && Number.isFinite(shareRaw)
        ? Math.max(0, Math.min(100, Math.round(shareRaw)))
        : null,
    cdeCustomized: typeof cde === "boolean" ? cde : null,
    cdeEvidence: evidence || null,
  };
}

/** @deprecated use analyzeKeyframes */
export async function estimateCameraOnPct(
  env: ProviderEnv,
  keyframes: SampleFrame[],
): Promise<number | null> {
  const r = await analyzeKeyframes(env, keyframes, { visualAnalysisConsent: true });
  return r.cameraOnPct;
}
