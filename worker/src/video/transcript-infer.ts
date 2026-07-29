/**
 * Pass 2 fallback — infer screen-share / PPT / CDE facts from transcript via Gemini.
 * Used when ffmpeg is unavailable (local Windows, Cloudflare Workers) or sampling fails.
 */

import type { TimelineSegmentType } from "../domain-model/video-facts";
import type { ProviderEnv } from "../providers/types";
import { buildVideoFactsDraft } from "./facts";

const MAX_TRANSCRIPT_CHARS = 120_000;

const VIDEO_SEGMENT_TYPES = new Set<TimelineSegmentType>([
  "slides",
  "product",
  "cde",
  "customer_screen",
  "none",
  "scene_change",
]);

export interface ParticipantInferRow {
  name: string;
  talkPct?: number | null;
  cameraOn?: boolean | null;
  role?: string | null;
}

export interface TranscriptInferInput {
  transcript: string;
  durationSec?: number | null;
  callType?: string | null;
  /** Spec §12.8 — omit camera_on_pct when false. */
  visualAnalysisConsent?: boolean;
}

function geminiKey(env: ProviderEnv): string | undefined {
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

function parseDurationSec(raw: unknown, fallback: number | null): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.round(raw);
  return fallback;
}

function normalizeSegmentType(raw: unknown): TimelineSegmentType {
  const s = String(raw || "none").trim().toLowerCase();
  if (VIDEO_SEGMENT_TYPES.has(s as TimelineSegmentType)) return s as TimelineSegmentType;
  if (s.includes("slide") || s.includes("ppt") || s.includes("deck")) return "slides";
  if (s.includes("cde") || s.includes("tenant")) return "cde";
  if (s.includes("customer")) return "customer_screen";
  if (s.includes("product") || s.includes("demo")) return "product";
  return "none";
}

/** @internal exported for unit tests */
export function parseInferResponse(
  parsed: Record<string, unknown> | null,
  durationSec: number | null,
  consent: boolean,
): {
  cameraOnPct: number | null;
  cdeCustomized: boolean | null;
  cdeEvidence: string | null;
  shareOnPct: number | null;
  segments: Array<{ startS: number; endS: number; segmentType: TimelineSegmentType; label?: string }>;
  participants: ParticipantInferRow[];
} {
  const empty = {
    cameraOnPct: null as number | null,
    cdeCustomized: null as boolean | null,
    cdeEvidence: null as string | null,
    shareOnPct: null as number | null,
    segments: [] as Array<{
      startS: number;
      endS: number;
      segmentType: TimelineSegmentType;
      label?: string;
    }>,
    participants: [] as ParticipantInferRow[],
  };
  if (!parsed) return empty;

  const cameraRaw = parsed.cameraOnPct;
  const shareRaw = parsed.shareOnPct;
  const cde = parsed.cdeCustomized;
  const evidence =
    typeof parsed.cdeEvidence === "string" ? parsed.cdeEvidence.trim().slice(0, 160) : null;

  const segRaw = Array.isArray(parsed.segments) ? parsed.segments : [];
  const dur = durationSec && durationSec > 0 ? durationSec : null;
  const segments: typeof empty.segments = [];

  for (const row of segRaw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    let startS = Number(r.startS);
    let endS = Number(r.endS);
    if (!Number.isFinite(startS) || startS < 0) startS = 0;
    if (!Number.isFinite(endS) || endS <= startS) continue;
    if (dur != null) {
      startS = Math.min(startS, dur);
      endS = Math.min(endS, dur);
      if (endS <= startS) continue;
    }
    const label = typeof r.label === "string" ? r.label.trim().slice(0, 80) : undefined;
    segments.push({
      startS: Math.round(startS),
      endS: Math.round(endS),
      segmentType: normalizeSegmentType(r.segmentType),
      label: label || undefined,
    });
  }

  segments.sort((a, b) => a.startS - b.startS);

  const partRaw = Array.isArray(parsed.participants) ? parsed.participants : [];
  const participants: ParticipantInferRow[] = [];
  const seenNames = new Set<string>();
  for (const row of partRaw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 80) : "";
    if (!name) continue;
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) continue;
    seenNames.add(nameKey);
    const talkRaw = r.talkPct ?? r.talkSharePct;
    const talkPct =
      typeof talkRaw === "number" && Number.isFinite(talkRaw)
        ? Math.max(0, Math.min(100, Math.round(talkRaw)))
        : null;
    const camRaw = r.cameraOn ?? r.camOn;
    let cameraOn: boolean | null = null;
    if (typeof camRaw === "boolean") cameraOn = camRaw;
    else if (typeof camRaw === "string") {
      const s = camRaw.toLowerCase();
      if (s === "on" || s === "off") cameraOn = s === "on";
    }
    participants.push({
      name,
      talkPct,
      cameraOn,
      role: typeof r.role === "string" ? r.role.trim().slice(0, 40) : null,
    });
  }

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
    segments,
    participants,
  };
}

export async function inferVideoFactsFromTranscript(
  env: ProviderEnv,
  input: TranscriptInferInput,
): Promise<ReturnType<typeof buildVideoFactsDraft>> {
  const transcript = input.transcript?.trim().slice(0, MAX_TRANSCRIPT_CHARS) || "";
  if (!transcript) {
    return buildVideoFactsDraft({
      status: "unavailable",
      samples: [],
      errorMessage: "No transcript for Pass 2 inference",
    });
  }

  const key = geminiKey(env);
  if (!key) {
    return buildVideoFactsDraft({
      status: "unavailable",
      samples: [],
      errorMessage: "GEMINI_API_KEY required for Pass 2 (transcript inference)",
    });
  }

  const consent = !!input.visualAnalysisConsent;
  const durationSec = input.durationSec ?? null;
  const callType = input.callType?.trim() || "demo";

  const prompt = [
    "You analyze SE customer call transcripts to infer what was on screen during a demo.",
    "Detect when the SE used slides/PPT/deck, showed the product UI, a customized CDE/tenant, or the customer's screen.",
    "Use transcript cues: 'as you can see on my screen', 'let me share', 'this slide', product names, demo narration, etc.",
    durationSec
      ? `Call duration is about ${Math.round(durationSec / 60)} minutes (${durationSec}s). Place segments on that clock.`
      : "Estimate timestamps in seconds from context (intro ~0, demo mid-call).",
    `Call type: ${callType}.`,
    consent
      ? "You may estimate camera_on_pct from whether the SE references being on camera. Infer per-participant talkPct and cameraOn when names appear in the transcript."
      : "Set cameraOnPct to null (no face consent). Still infer talkPct per named speaker; set cameraOn false for everyone.",
    "Reply JSON only:",
    JSON.stringify({
      shareOnPct: "<0-100 int — estimated % of call with screenshare>",
      cameraOnPct: consent ? "<0-100 int or null>" : null,
      cdeCustomized: "<boolean|null — product tenant looks customer-specific vs stock demo>",
      cdeEvidence: "<max 25 words or null>",
      participants: [
        {
          name: "First Last",
          talkPct: 24,
          cameraOn: consent ? true : false,
          role: "se|customer|ae",
        },
      ],
      segments: [
        {
          startS: 0,
          endS: 300,
          segmentType: "slides|product|cde|customer_screen|none",
          label: "short label",
        },
      ],
    }),
    "\n\nTRANSCRIPT:\n",
    transcript,
  ].join(" ");

  const model = modelId(env);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.15,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const errText = (await res.text()).slice(0, 300);
      return buildVideoFactsDraft({
        status: "failed",
        samples: [],
        durationSec,
        errorMessage: `Gemini Pass 2 failed (${res.status}): ${errText}`,
        visualAnalysisConsent: consent,
      });
    }

    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = null;
    }

    const inferred = parseInferResponse(parsed, durationSec, consent);
    const dur =
      parseDurationSec(parsed?.durationSec, durationSec) ||
      (inferred.segments.length
        ? inferred.segments[inferred.segments.length - 1].endS
        : durationSec);

    if (!inferred.segments.length && inferred.shareOnPct == null && inferred.cdeCustomized == null) {
      return buildVideoFactsDraft({
        status: "failed",
        samples: [],
        durationSec: dur,
        errorMessage: "Gemini returned no usable Pass 2 signals",
        visualAnalysisConsent: consent,
      });
    }

    return buildVideoFactsDraft({
      status: "ready",
      samples: [],
      durationSec: dur,
      streamKind: "transcript_infer",
      cameraOnPct: inferred.cameraOnPct,
      cdeCustomized: inferred.cdeCustomized,
      cdeEvidence: inferred.cdeEvidence,
      shareOnPct: inferred.shareOnPct,
      visualAnalysisConsent: consent,
      attendeeCurveJson: inferred.participants.length ? inferred.participants : null,
      segments: inferred.segments,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Pass 2 transcript inference failed";
    return buildVideoFactsDraft({
      status: "failed",
      samples: [],
      durationSec,
      errorMessage: msg.slice(0, 500),
      visualAnalysisConsent: consent,
    });
  }
}
