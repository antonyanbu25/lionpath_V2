/**
 * Gemini vision over Pass 2 strategic keyframes.
 * - Per-participant camera on/off from averaged strategic windows (SE, AE, Customer)
 * - PPT/slides usage detection
 * - cde_customized: product tenant looks real vs stock seed data
 * Face/camera judgement requires visualAnalysisConsent === true.
 */

import { readFile } from "node:fs/promises";
import { effectiveGeminiModel } from "../providers/gemini";
import type { ProviderEnv } from "../providers/types";
import type { SampleFrame } from "./facts";
import {
  aggregateParticipantCamera,
  seCameraOnPctFromParticipants,
  type ParticipantCameraAggregate,
} from "./sampling";

const MAX_VISION_FRAMES = 24;

export interface VisionIdentities {
  seIdentity?: string | null;
  aeIdentity?: string | null;
  customerIdentities?: string[] | null;
}

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
      const bytes = await readFile(frame.path);
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
        thinkingConfig: { thinkingLevel: "minimal" },
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

function roleForName(name: string, identities: VisionIdentities): string | null {
  const key = name.trim().toLowerCase();
  if (identities.seIdentity && identities.seIdentity.trim().toLowerCase() === key) return "se";
  if (identities.aeIdentity && identities.aeIdentity.trim().toLowerCase() === key) return "ae";
  if (
    (identities.customerIdentities || []).some((c) => c.trim().toLowerCase() === key)
  ) {
    return "customer";
  }
  return null;
}

function parseWindowParticipantRows(
  parsed: Record<string, unknown>,
  identities: VisionIdentities,
): ParticipantCameraAggregate[] {
  const rows: Array<{
    name: string;
    role?: string | null;
    secondsOn: number;
    secondsOff: number;
  }> = [];

  const windows = Array.isArray(parsed.windows) ? parsed.windows : [];
  for (const win of windows) {
    if (!win || typeof win !== "object") continue;
    const w = win as Record<string, unknown>;
    const windowDur =
      typeof w.windowSeconds === "number" && Number.isFinite(w.windowSeconds)
        ? Math.max(1, Math.round(w.windowSeconds))
        : 15;
    const participants = w.participants;
    if (!participants || typeof participants !== "object") continue;

    for (const [rawName, rawState] of Object.entries(participants as Record<string, unknown>)) {
      const name = String(rawName || "").trim();
      if (!name) continue;
      let secondsOn = 0;
      let secondsOff = 0;
      if (typeof rawState === "boolean") {
        secondsOn = rawState ? windowDur : 0;
        secondsOff = rawState ? 0 : windowDur;
      } else if (rawState && typeof rawState === "object") {
        const st = rawState as Record<string, unknown>;
        if (typeof st.secondsOn === "number" && Number.isFinite(st.secondsOn)) {
          secondsOn = Math.max(0, st.secondsOn);
        }
        if (typeof st.secondsOff === "number" && Number.isFinite(st.secondsOff)) {
          secondsOff = Math.max(0, st.secondsOff);
        }
        if (!secondsOn && !secondsOff && typeof st.cameraOn === "boolean") {
          secondsOn = st.cameraOn ? windowDur : 0;
          secondsOff = st.cameraOn ? 0 : windowDur;
        }
      }
      rows.push({
        name,
        role: roleForName(name, identities),
        secondsOn,
        secondsOff,
      });
    }
  }

  return aggregateParticipantCamera(rows);
}

/**
 * Full Pass 2 vision with strategic-window participant camera aggregation.
 */
export async function analyzeKeyframes(
  env: ProviderEnv,
  keyframes: SampleFrame[],
  opts?: {
    visualAnalysisConsent?: boolean;
    identities?: VisionIdentities;
    durationSec?: number | null;
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

  const prompt = consent
    ? [
        "You analyze SE demo/call recording keyframes sampled at strategic windows:",
        "opening (first 10%), 30%, 60%, 90%, and closing minute.",
        "Track camera/video tiles for these participants only:",
        `- SE: ${seName}`,
        `- AE: ${aeName}`,
        `- Customer(s): ${customerList}`,
        "For each participant in each window, estimate seconds camera ON vs OFF (out of ~15s per window, 60s for closing).",
        "Also detect slides/PPT/deck usage and whether product CDE/tenant looks customized vs stock demo (Acme Corp, demo@, placeholders).",
        "Reply JSON only:",
        JSON.stringify({
          windows: [
            {
              label: "opening_10pct",
              windowSeconds: 15,
              participants: {
                [seName]: { secondsOn: 12, secondsOff: 3, cameraOn: true },
              },
            },
          ],
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

  const parsed = await callGeminiJson(env, prompt, imageParts);
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
    const aggregated = parseWindowParticipantRows(parsed, identities);
    if (aggregated.length) {
      attendeeCurveJson = aggregated.map((p) => ({
        name: p.name,
        cameraOn: p.cameraOn,
        role: p.role,
        talkPct: null,
      }));
      cameraOnPct = seCameraOnPctFromParticipants(aggregated, identities.seIdentity);
    } else {
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
