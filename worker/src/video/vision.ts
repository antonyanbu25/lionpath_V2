/**
 * Gemini vision over Pass 2 strategic keyframes.
 * - Per-participant camera on/off from averaged strategic windows (SE, AE, Customer)
 * - PPT/slides usage detection
 * - cde_customized: product tenant looks real vs stock seed data
 * Face/camera judgement requires visualAnalysisConsent === true.
 */

import { extractJson } from "../json";
import { prepareVisionFrameBytes } from "./frame-image";
import { recordLlmUsage } from "../data/llm-usage";
import { reserveDailyTokenBudget, totalTokens } from "../data/token-budget";
import type { CostControlEnv } from "../cost-control-config";
import type { FirestoreEnv } from "../data/firestore-admin";
import { effectiveGeminiModel } from "../providers/gemini";
import { fetchGeminiWithRetry, GEMINI_TIMEOUT_MS } from "../providers/gemini-retry";
import type { ProviderEnv } from "../providers/types";
import type { SampleFrame } from "./facts";
import {
  buildAttendeeCurveFromAggregated,
  parseVisionCameraResponse,
  seCameraOnPctFromParticipants,
  type VisionIdentities,
} from "./sampling";

import { MAX_KEYFRAMES } from "./facts";

/** Match keyframe picker — vision receives pre-capped frames from pass2. */
const MAX_VISION_FRAMES = MAX_KEYFRAMES;

export type { VisionIdentities };

export interface VisionAnalysis {
  cameraOnPct: number | null;
  cdeCustomized: boolean | null;
  cdeEvidence: string | null;
  /** 0..100 rough share-of-screen estimate when detectable. */
  shareOnPct: number | null;
  /** Whether slides/PPT/deck content appeared in sampled frames. */
  pptUsed?: boolean | null;
  pptEvidence?: string | null;
  attendeeCurveJson?: Array<{
    name: string;
    talkPct?: number | null;
    cameraOn?: boolean | null;
    cameraOnPct?: number | null;
    role?: string | null;
  }> | null;
  pptSegments?: Array<{
    startS: number;
    endS: number;
    segmentType: "slides";
    label?: string;
  }>;
}

function apiKey(env: ProviderEnv): string | undefined {
  return env.GEMINI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
}

function modelId(env: ProviderEnv): string {
  return effectiveGeminiModel(env, env.POSTCALL_MODEL?.trim() || env.MODEL?.trim());
}

async function buildImageParts(
  keyframes: SampleFrame[],
): Promise<Array<Record<string, unknown>>> {
  const parts: Array<Record<string, unknown>> = [];
  for (const frame of keyframes.slice(0, MAX_VISION_FRAMES)) {
    try {
      const bytes = await prepareVisionFrameBytes(frame.path);
      const windowTag = frame.windowLabel ? ` [window=${frame.windowLabel}]` : "";
      parts.push({ text: `Frame at ${Math.round(frame.atS)}s${windowTag}:` });
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: bytes.toString("base64"),
        },
      });
    } catch {
      // skip unreadable frame
    }
  }
  return parts;
}

async function callGeminiJson(
  env: ProviderEnv & FirestoreEnv & CostControlEnv,
  textPrompt: string,
  imageParts: Array<Record<string, unknown>>,
  opts?: { userId?: string; callId?: string },
): Promise<Record<string, unknown> | null> {
  const key = apiKey(env);
  if (!key || !imageParts.length) return null;

  const model = modelId(env);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const started = Date.now();

  const settleBudget = await reserveDailyTokenBudget(env, opts?.userId);
  try {
    const { response: res, retryCount } = await fetchGeminiWithRetry(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: textPrompt }, ...imageParts] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
          },
        }),
      },
      { timeoutMs: GEMINI_TIMEOUT_MS.vision, step: "video/vision" },
    );

    if (!res.ok) {
      console.warn("[video/vision] Gemini", res.status, (await res.text()).slice(0, 200));
      await settleBudget(0);
      return null;
    }

    const body = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        groundingMetadata?: { webSearchQueries?: string[] };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
      };
    };
    const promptTokens = body.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = body.usageMetadata?.candidatesTokenCount ?? 0;
    await settleBudget(totalTokens(promptTokens, outputTokens));

    if (opts?.userId) {
      recordLlmUsage(env, {
        userId: opts.userId,
        callId: opts.callId,
        passName: "video/vision",
        model,
        promptTokens,
        outputTokens,
        cachedTokens: body.usageMetadata?.cachedContentTokenCount ?? 0,
        groundingQueries: body.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length ?? 0,
        latencyMs: Date.now() - started,
        retryCount,
      });
    }
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (!text.trim()) return null;
    try {
      return extractJson<Record<string, unknown>>(text);
    } catch (err) {
      console.warn(
        "[video/vision] JSON parse failed:",
        err instanceof Error ? err.message : err,
        text.slice(0, 200),
      );
      return null;
    }
  } catch (err) {
    await settleBudget(0);
    console.warn("[video/vision] Gemini call failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Full Pass 2 vision with strategic-window participant camera aggregation.
 */
export async function analyzeKeyframes(
  env: ProviderEnv & FirestoreEnv & CostControlEnv,
  keyframes: SampleFrame[],
  opts?: {
    visualAnalysisConsent?: boolean;
    identities?: VisionIdentities;
    durationSec?: number | null;
    userId?: string;
    callId?: string;
  },
): Promise<VisionAnalysis> {
  const empty: VisionAnalysis = {
    cameraOnPct: null,
    cdeCustomized: null,
    cdeEvidence: null,
    shareOnPct: null,
    pptUsed: null,
    pptEvidence: null,
    attendeeCurveJson: null,
  };
  if (!keyframes.length) return empty;

  const imageParts = await buildImageParts(keyframes);
  if (!imageParts.length) return empty;

  const consent = !!opts?.visualAnalysisConsent;
  const identities = opts?.identities || {};
  const seName = identities.seIdentity?.trim() || "SE";
  const aeName = identities.aeIdentity?.trim() || "AE";
  const customers = (identities.customerIdentities || []).filter(Boolean);
  const customerList = customers.length ? customers.join(", ") : "customer attendees";

  const windowExample = {
    label: "opening_10pct",
    windowSeconds: 15,
    participants: {
      [seName]: { secondsOn: 12, secondsOff: 3, cameraOn: true },
      [aeName]: { secondsOn: 0, secondsOff: 15, cameraOn: false },
    },
  };
  if (customers[0]) {
    (windowExample.participants as Record<string, unknown>)[customers[0]] = {
      secondsOn: 8,
      secondsOff: 7,
      cameraOn: true,
    };
  }

  const prompt = consent
    ? [
        "You analyze SE demo/call recording keyframes sampled at strategic windows:",
        "opening (first 10%), 30%, 60%, 90%, and closing minute.",
        "Each frame is tagged with [window=...] — group your analysis by those windows.",
        "Track camera/video tiles for these participants only (use these exact display names):",
        `- SE: ${seName}`,
        `- AE: ${aeName}`,
        `- Customer(s): ${customerList}`,
        "For EVERY window and EVERY listed participant, estimate seconds camera ON vs OFF",
        "(~15s per window except closing_1min which is 60s).",
        "A participant with a visible face or live video tile counts as camera ON.",
        "Also detect slides/PPT/deck usage and whether product CDE/tenant looks customized vs stock demo (Acme Corp, demo@, placeholders).",
        "Reply JSON only with a windows array covering all sampled windows:",
        JSON.stringify({
          windows: [windowExample, { label: "pct_30", windowSeconds: 15, participants: {} }],
          pptUsed: true,
          pptEvidence: "Slide deck visible in opening window",
          shareOnPct: 70,
          cdeCustomized: true,
          cdeEvidence: "Tenant branded for customer",
        }),
      ].join(" ")
    : [
        "You analyze SE call screenshare keyframes. DO NOT identify or describe faces.",
        "Judge screen content only: slides/PPT/deck usage, share presence, CDE customization vs stock demo.",
        "Set camera fields to null / omit participant camera states (no face consent).",
        "Reply JSON only:",
        JSON.stringify({
          pptUsed: true,
          pptEvidence: "Deck visible",
          shareOnPct: 70,
          cdeCustomized: null,
          cdeEvidence: null,
        }),
      ].join(" ");

  const parsed = await callGeminiJson(env, prompt, imageParts, {
    userId: opts?.userId,
    callId: opts?.callId,
  });
  if (!parsed) return empty;

  const shareRaw = parsed.shareOnPct;
  const cde = parsed.cdeCustomized;
  const evidence =
    typeof parsed.cdeEvidence === "string" ? parsed.cdeEvidence.trim().slice(0, 160) : null;
  const pptUsed = typeof parsed.pptUsed === "boolean" ? parsed.pptUsed : null;
  const pptEvidence =
    typeof parsed.pptEvidence === "string" ? parsed.pptEvidence.trim().slice(0, 160) : null;

  let cameraOnPct: number | null = null;
  let attendeeCurveJson: VisionAnalysis["attendeeCurveJson"] = null;

  if (consent) {
    const aggregated = parseVisionCameraResponse(parsed, identities);
    if (aggregated.length) {
      attendeeCurveJson = buildAttendeeCurveFromAggregated(aggregated, identities);
      cameraOnPct = seCameraOnPctFromParticipants(aggregated, identities.seIdentity);
      console.info("[video/vision] camera aggregates", {
        participants: aggregated.length,
        seCameraOnPct: cameraOnPct,
        curveRows: attendeeCurveJson?.length ?? 0,
      });
    } else {
      console.warn("[video/vision] consent=true but no participant camera windows parsed");
      const cameraRaw = parsed.cameraOnPct;
      if (typeof cameraRaw === "number" && Number.isFinite(cameraRaw)) {
        cameraOnPct = Math.max(0, Math.min(100, Math.round(cameraRaw)));
      }
    }
  }

  const segmentsFromPpt =
    pptUsed === true
      ? [
          {
            startS: 0,
            endS: Math.max(1, Math.round(opts?.durationSec ?? 60)),
            segmentType: "slides" as const,
            label: pptEvidence || "Slides/PPT",
          },
        ]
      : undefined;

  return {
    cameraOnPct,
    shareOnPct:
      typeof shareRaw === "number" && Number.isFinite(shareRaw)
        ? Math.max(0, Math.min(100, Math.round(shareRaw)))
        : null,
    cdeCustomized: typeof cde === "boolean" ? cde : null,
    cdeEvidence: evidence || null,
    pptUsed,
    pptEvidence,
    attendeeCurveJson,
    pptSegments: segmentsFromPpt,
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
