/**
 * Pure builders for Pass 2 drafts — unit-testable without ffmpeg.
 */

import type { TimelineSegmentType, VideoFactsDraft } from "../domain-model/video-facts";
import { keyframeRetentionExpiresAt } from "./retention";

export const DEFAULT_SAMPLE_INTERVAL_S = 10;
/** Strategic windows (5) × ~2 frames each — enough for per-window vision without extra cost. */
export const MAX_KEYFRAMES = 10;

export interface SampleFrame {
  atS: number;
  path: string;
  /** Mean absolute pixel delta vs previous sample (0..255-ish). */
  sceneDelta?: number;
  /** Strategic window label when sampled from targeted clips. */
  windowLabel?: string;
}

const CLASSIFIED_SEGMENT_TYPES = new Set<TimelineSegmentType>([
  "slides",
  "product",
  "cde",
  "customer_screen",
]);

/** True when attendee curve rows carry camera on/off or pct. */
export function curveHasCameraData(
  curve: VideoFactsDraft["attendeeCurveJson"] | null | undefined,
): boolean {
  if (!Array.isArray(curve)) return false;
  return curve.some(
    (p) =>
      p?.cameraOn === true ||
      p?.cameraOn === false ||
      (p?.cameraOnPct != null && Number.isFinite(Number(p.cameraOnPct))),
  );
}

/**
 * Call-level camera_on_pct — prefer explicit top-level, else SE row / curve aggregate.
 * Keeps room panel and CQS camera_on on the same source.
 */
export function aggregateCameraOnPct(
  topLevel: number | null | undefined,
  curve: VideoFactsDraft["attendeeCurveJson"] | null | undefined,
  seIdentity?: string | null,
): number | null {
  if (topLevel != null && Number.isFinite(Number(topLevel))) {
    return Math.max(0, Math.min(100, Math.round(Number(topLevel))));
  }
  if (!Array.isArray(curve) || !curve.length) return null;

  const seKey = seIdentity?.trim().toLowerCase();
  const seRow =
    (seKey &&
      curve.find((p) => String(p?.name || "").trim().toLowerCase() === seKey)) ||
    curve.find((p) => String(p?.role || "").trim().toLowerCase() === "se");

  if (seRow?.cameraOnPct != null && Number.isFinite(Number(seRow.cameraOnPct))) {
    return Math.max(0, Math.min(100, Math.round(Number(seRow.cameraOnPct))));
  }

  const pcts = curve
    .map((p) => p?.cameraOnPct)
    .filter((v): v is number => v != null && Number.isFinite(Number(v)))
    .map((v) => Math.max(0, Math.min(100, Math.round(Number(v)))));
  if (pcts.length) {
    return Math.round(pcts.reduce((sum, v) => sum + v, 0) / pcts.length);
  }

  const known = curve.filter((p) => p?.cameraOn === true || p?.cameraOn === false);
  if (!known.length) return null;
  const onCount = known.filter((p) => p?.cameraOn === true).length;
  return Math.round((onCount / known.length) * 100);
}

function mergeAdjacentSegments(
  segments: VideoFactsDraft["segments"],
): VideoFactsDraft["segments"] {
  if (!segments.length) return [];
  const sorted = segments.slice().sort((a, b) => a.startS - b.startS);
  const out: VideoFactsDraft["segments"] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = out[out.length - 1];
    const cur = sorted[i];
    if (prev.segmentType === cur.segmentType && prev.endS >= cur.startS - 1) {
      prev.endS = Math.max(prev.endS, cur.endS);
      if (!prev.label && cur.label) prev.label = cur.label;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * One timeline builder per call — prefer vision-classified share segments;
 * fall back to honest scene_change/none when classification is absent.
 */
export function buildPass2TimelineSegments(
  sceneSegments: VideoFactsDraft["segments"],
  classifiedSegments: VideoFactsDraft["segments"] | null | undefined,
): VideoFactsDraft["segments"] {
  const classified = (classifiedSegments || []).filter((s) =>
    CLASSIFIED_SEGMENT_TYPES.has(s.segmentType),
  );
  if (classified.length) return mergeAdjacentSegments(classified);
  return sceneSegments?.length ? sceneSegments : [];
}

/** Collapse high-delta samples into coarse scene_change segments. */
export function buildSceneSegments(
  samples: SampleFrame[],
  durationSec: number,
  deltaThreshold = 18,
): VideoFactsDraft["segments"] {
  if (!samples.length) return [];
  const segments: VideoFactsDraft["segments"] = [];
  let segStart = samples[0].atS;
  let inChange = (samples[0].sceneDelta ?? 0) >= deltaThreshold;

  for (let i = 1; i < samples.length; i++) {
    const hot = (samples[i].sceneDelta ?? 0) >= deltaThreshold;
    if (hot !== inChange) {
      const endS = samples[i].atS;
      if (endS > segStart) {
        segments.push({
          startS: segStart,
          endS,
          segmentType: inChange ? "scene_change" : "none",
          label: inChange ? "Scene / share change" : "Stable view",
        });
      }
      segStart = samples[i].atS;
      inChange = hot;
    }
  }
  const endS = Math.max(durationSec || 0, samples[samples.length - 1].atS + DEFAULT_SAMPLE_INTERVAL_S);
  if (endS > segStart) {
    segments.push({
      startS: segStart,
      endS,
      segmentType: (inChange ? "scene_change" : "none") as TimelineSegmentType,
      label: inChange ? "Scene / share change" : "Stable view",
    });
  }
  return segments;
}

/**
 * Pick frames for Gemini vision — at least one frame per strategic window.
 * Scene-delta pickKeyframes drops window coverage and breaks per-window camera aggregation.
 */
export function pickVisionKeyframes(samples: SampleFrame[], max = MAX_KEYFRAMES): SampleFrame[] {
  if (!samples.length) return [];
  const byWindow = new Map<string, SampleFrame[]>();
  for (const s of samples) {
    const label = s.windowLabel || "";
    if (!label) continue;
    const arr = byWindow.get(label) || [];
    arr.push(s);
    byWindow.set(label, arr);
  }
  if (!byWindow.size) return pickKeyframes(samples, max);

  const windows = [...byWindow.entries()].sort((a, b) => a[1][0].atS - b[1][0].atS);
  const chosen: SampleFrame[] = [];
  const pickedIdx = new Map<string, Set<number>>();

  // Phase 1 — one frame per window (midpoint) so camera aggregation never loses a window.
  for (const [label, frames] of windows) {
    if (chosen.length >= max) break;
    const idx = Math.floor((frames.length - 1) / 2);
    chosen.push(frames[idx]);
    pickedIdx.set(label, new Set([idx]));
  }

  // Phase 2 — spend remaining budget evenly across windows (first, last, stride).
  const windowCount = windows.length;
  const perWindowExtra = Math.max(1, Math.floor((max - chosen.length) / windowCount));
  for (const [label, frames] of windows) {
    if (chosen.length >= max) break;
    const local = pickedIdx.get(label) || new Set<number>();
    const extras = new Set<number>([0, frames.length - 1]);
    const stride = Math.max(1, Math.floor(frames.length / (perWindowExtra + 1)));
    for (let i = 0; i < frames.length && extras.size < perWindowExtra + 2; i += stride) {
      extras.add(i);
    }
    for (const idx of [...extras].sort((a, b) => a - b)) {
      if (chosen.length >= max) break;
      if (local.has(idx)) continue;
      local.add(idx);
      chosen.push(frames[idx]);
    }
    pickedIdx.set(label, local);
  }

  return chosen.sort((a, b) => a.atS - b.atS).slice(0, max);
}

/** Prefer high scene-delta frames, spaced out, capped at MAX_KEYFRAMES. */
export function pickKeyframes(samples: SampleFrame[], max = MAX_KEYFRAMES): SampleFrame[] {
  if (!samples.length) return [];
  if (samples.length <= max) return samples.slice();

  const ranked = samples
    .map((s, i) => ({ s, i, score: s.sceneDelta ?? 0 }))
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const chosen = new Set<number>();
  chosen.add(0);
  chosen.add(samples.length - 1);

  for (const row of ranked) {
    if (chosen.size >= max) break;
    // Prefer spacing ≥ 30s from already chosen
    const at = row.s.atS;
    const tooClose = [...chosen].some((idx) => Math.abs(samples[idx].atS - at) < 30);
    if (tooClose && chosen.size > 2) continue;
    chosen.add(row.i);
  }

  // Fill remaining by even stride
  if (chosen.size < max) {
    const stride = Math.max(1, Math.floor(samples.length / max));
    for (let i = 0; i < samples.length && chosen.size < max; i += stride) {
      chosen.add(i);
    }
  }

  return [...chosen]
    .sort((a, b) => a - b)
    .slice(0, max)
    .map((i) => samples[i]);
}

export function buildVideoFactsDraft(opts: {
  status: VideoFactsDraft["status"];
  samples: SampleFrame[];
  durationSec?: number | null;
  streamKind?: string | null;
  cameraOnPct?: number | null;
  cdeCustomized?: boolean | null;
  cdeEvidence?: string | null;
  shareOnPct?: number | null;
  visualAnalysisConsent?: boolean;
  errorMessage?: string | null;
  sampleIntervalS?: number;
  nowMs?: number;
  /** When set (e.g. Gemini transcript inference), skip scene-delta segment builder. */
  segments?: VideoFactsDraft["segments"];
  attendeeCurveJson?: VideoFactsDraft["attendeeCurveJson"];
  pptUsed?: boolean | null;
  pptEvidence?: string | null;
  slideDeckTailored?: boolean | null;
  slideVisualsWalked?: boolean | null;
  timelineSpine?: VideoFactsDraft["timelineSpine"];
}): VideoFactsDraft {
  const durationSec = opts.durationSec ?? null;
  const keyframes = opts.status === "ready" ? pickKeyframes(opts.samples) : [];
  const segments =
    opts.segments ??
    (opts.status === "ready"
      ? buildSceneSegments(opts.samples, durationSec ?? 0)
      : []);

  const cameraOnPct = aggregateCameraOnPct(opts.cameraOnPct, opts.attendeeCurveJson);

  return {
    status: opts.status,
    cameraOnPct,
    keyframeRefs: keyframes.map((k) => ({
      atS: k.atS,
      path: k.path,
      kind: "sample",
    })),
    sampleIntervalS: opts.sampleIntervalS ?? DEFAULT_SAMPLE_INTERVAL_S,
    durationSec,
    streamKind: opts.streamKind ?? null,
    errorMessage: opts.errorMessage ?? null,
    retentionExpiresAt: keyframeRetentionExpiresAt(opts.nowMs),
    cdeCustomized: typeof opts.cdeCustomized === "boolean" ? opts.cdeCustomized : null,
    cdeEvidence: opts.cdeEvidence?.trim() || null,
    shareOnPct:
      opts.shareOnPct == null || !Number.isFinite(opts.shareOnPct)
        ? null
        : Math.max(0, Math.min(100, Math.round(opts.shareOnPct))),
    visualAnalysisConsent: !!opts.visualAnalysisConsent,
    attendeeCurveJson: opts.attendeeCurveJson ?? null,
    segments,
    pptUsed: typeof opts.pptUsed === "boolean" ? opts.pptUsed : null,
    pptEvidence: opts.pptEvidence?.trim() || null,
    slideDeckTailored: typeof opts.slideDeckTailored === "boolean" ? opts.slideDeckTailored : null,
    slideVisualsWalked: typeof opts.slideVisualsWalked === "boolean" ? opts.slideVisualsWalked : null,
    timelineSpine: opts.timelineSpine ?? null,
  };
}
