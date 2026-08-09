/**
 * Pass 2 fallback — infer screen-share / PPT / CDE facts from transcript via Gemini.
 * Used when ffmpeg is unavailable (local Windows, Cloudflare Workers) or sampling fails.
 */

import { recordLlmUsage } from "../data/llm-usage";
import type { FirestoreEnv } from "../data/firestore-admin";
import type { TimelineSegmentType, TranscriptSegmentType } from "../domain-model/video-facts";
import type { ProviderEnv } from "../providers/types";
import { parseTranscriptCues } from "../transcript";
import { buildVideoFactsDraft } from "./facts";
import { computeStrategicSampleWindows } from "./sampling";

/** Hard cap after strategic windowing (~12k tokens). */
const MAX_TRANSCRIPT_CHARS = 48_000;

/** @internal exported for unit tests */
export function selectTranscriptForVideoInfer(
  raw: string,
  durationSec?: number | null,
  maxChars = MAX_TRANSCRIPT_CHARS,
): string {
  const input = raw?.trim() || "";
  if (!input || input.length <= maxChars) return input;

  const cues = parseTranscriptCues(input);
  if (cues.length) {
    const dur =
      durationSec && durationSec > 0
        ? durationSec
        : Math.max(...cues.map((c) => c.endS ?? c.startS), 60);
    const windows = computeStrategicSampleWindows(dur);
    const selected: string[] = [];
    const seen = new Set<number>();
    for (const win of windows) {
      for (const cue of cues) {
        if (cue.startS < win.startS || cue.startS >= win.endS) continue;
        const key = Math.round(cue.startS * 10);
        if (seen.has(key)) continue;
        seen.add(key);
        const prefix = cue.speaker ? `${cue.speaker}: ` : "";
        selected.push(`${prefix}${cue.text}`);
      }
    }
    let joined = selected.join("\n");
    if (joined.length > maxChars) joined = joined.slice(0, maxChars);
    if (joined.length >= 500) {
      return `[Strategic transcript windows — ~${Math.round(dur / 60)} min call]\n\n${joined}`;
    }
  }

  const headLen = Math.floor(maxChars * 0.35);
  const tailLen = Math.floor(maxChars * 0.35);
  const midBudget = maxChars - headLen - tailLen - 120;
  const head = input.slice(0, headLen);
  const tail = input.slice(-tailLen);
  const midStart = Math.floor(input.length * 0.3);
  const mid = input.slice(midStart, midStart + Math.max(0, midBudget));
  const sampled = `[Transcript sampled — full text ${input.length} chars]\n\n${head}\n\n[... mid-call sample ...]\n\n${mid}\n\n[... closing ...]\n\n${tail}`;
  return sampled.slice(0, maxChars);
}

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
  userId?: string;
  callId?: string;
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

const TRANSCRIPT_PHASE_TYPES = new Set<TranscriptSegmentType>([
  "intro",
  "discovery",
  "demo",
  "pricing",
  "objection_handling",
  "next_steps",
]);

function normalizeSummaryPhaseType(raw: unknown): TranscriptSegmentType {
  const s = String(raw || "discovery").trim().toLowerCase();
  if (TRANSCRIPT_PHASE_TYPES.has(s as TranscriptSegmentType)) return s as TranscriptSegmentType;
  if (s.includes("intro") || s.includes("agenda")) return "intro";
  if (s.includes("discover") || s.includes("pain")) return "discovery";
  if (s.includes("demo") || s.includes("walk")) return "demo";
  if (s.includes("pric") || s.includes("budget")) return "pricing";
  if (s.includes("objection") || s.includes("concern")) return "objection_handling";
  if (s.includes("next") || s.includes("follow")) return "next_steps";
  return "discovery";
}

/** @internal exported for unit tests */
export function parseSummaryPhaseResponse(
  parsed: Record<string, unknown> | null,
  durationSec: number | null,
): Array<{
  startS: number;
  endS: number;
  segmentType: TranscriptSegmentType;
  label?: string;
  source: "summary";
}> {
  if (!parsed) return [];
  const segRaw = Array.isArray(parsed.segments) ? parsed.segments : [];
  const dur =
    durationSec && durationSec > 0
      ? durationSec
      : typeof parsed.durationSec === "number" && parsed.durationSec > 0
        ? Math.round(parsed.durationSec)
        : null;
  const segments: ReturnType<typeof parseSummaryPhaseResponse> = [];
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
      segmentType: normalizeSummaryPhaseType(r.segmentType),
      label: label || undefined,
      source: "summary",
    });
  }
  segments.sort((a, b) => a.startS - b.startS);
  return segments;
}

export interface SummaryPhaseTimelineInput {
  summary: string;
  durationSec?: number | null;
  callType?: string | null;
  userId?: string;
  callId?: string;
}

/**
 * Infer conversation phases from a Kaia/plain summary (no VTT clock).
 * Display-only — reuses the transcript-infer Gemini path with phase segment types.
 */
export async function inferSummaryPhaseTimeline(
  env: ProviderEnv & FirestoreEnv,
  input: SummaryPhaseTimelineInput,
): Promise<{ segments: ReturnType<typeof parseSummaryPhaseResponse>; durationSec: number | null }> {
  const summary = input.summary?.trim() || "";
  if (!summary) return { segments: [], durationSec: null };

  const key = geminiKey(env);
  if (!key) return { segments: [], durationSec: input.durationSec ?? null };

  const durationSec = input.durationSec ?? null;
  const callType = input.callType?.trim() || "demo";
  const prompt = [
    "You analyze SE customer call AI summaries (no timestamps) and infer approximate conversation phases.",
    "Place phases on a proportional clock — intro early, demo mid-call, next steps at the end.",
    durationSec
      ? `Estimated call duration: ${Math.round(durationSec / 60)} minutes (${durationSec}s).`
      : "Estimate duration from summary length and content; default ~45 minutes if unclear.",
    `Call type: ${callType}.`,
    "Reply JSON only with segments using phase types intro|discovery|demo|pricing|objection_handling|next_steps:",
    JSON.stringify({
      durationSec: durationSec || 2700,
      segments: [
        { startS: 0, endS: 300, segmentType: "intro", label: "Intro and agenda" },
        { startS: 300, endS: 1200, segmentType: "discovery", label: "Discovery" },
        { startS: 1200, endS: 2400, segmentType: "demo", label: "Product demo" },
        { startS: 2400, endS: 2700, segmentType: "next_steps", label: "Next steps" },
      ],
    }),
    "\n\nSUMMARY:\n",
    summary.slice(0, MAX_TRANSCRIPT_CHARS),
  ].join(" ");

  const model = modelId(env);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  try {
    const started = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
        },
      }),
    });
    if (!res.ok) return { segments: [], durationSec };

    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
      };
    };
    if (input.userId) {
      recordLlmUsage(env, {
        userId: input.userId,
        callId: input.callId,
        passName: "video/summary-timeline",
        model,
        promptTokens: body.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
        cachedTokens: body.usageMetadata?.cachedContentTokenCount ?? 0,
        groundingQueries: 0,
        latencyMs: Date.now() - started,
      });
    }
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    const segments = parseSummaryPhaseResponse(parsed, durationSec);
    const dur =
      parseDurationSec(parsed?.durationSec, durationSec) ||
      (segments.length ? segments[segments.length - 1].endS : durationSec);
    return { segments, durationSec: dur };
  } catch {
    return { segments: [], durationSec: durationSec ?? null };
  }
}

export async function inferVideoFactsFromTranscript(
  env: ProviderEnv & FirestoreEnv,
  input: TranscriptInferInput,
): Promise<ReturnType<typeof buildVideoFactsDraft>> {
  const transcript =
    selectTranscriptForVideoInfer(
      input.transcript || "",
      input.durationSec ?? null,
      MAX_TRANSCRIPT_CHARS,
    ) || "";
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
      : "Set cameraOnPct to null (no face consent). Still infer talkPct per named speaker; set cameraOn to null for everyone — do NOT guess false.",
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
          cameraOn: consent ? true : null,
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
    const started = Date.now();
    const res = await fetch(url, {      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
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
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        cachedContentTokenCount?: number;
      };
    };
    if (input.userId) {
      recordLlmUsage(env, {
        userId: input.userId,
        callId: input.callId,
        passName: "video/transcript-infer",
        model,
        promptTokens: body.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
        cachedTokens: body.usageMetadata?.cachedContentTokenCount ?? 0,
        groundingQueries: 0,
        latencyMs: Date.now() - started,
      });
    }
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";    let parsed: Record<string, unknown> | null = null;
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
