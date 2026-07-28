/**
 * Pure builders for Pass 2 drafts — unit-testable without ffmpeg.
 */

import type { TimelineSegmentType, VideoFactsDraft } from "../domain-model/video-facts";
import { keyframeRetentionExpiresAt } from "./retention";

export const DEFAULT_SAMPLE_INTERVAL_S = 10;
export const MAX_KEYFRAMES = 20;

export interface SampleFrame {
  atS: number;
  path: string;
  /** Mean absolute pixel delta vs previous sample (0..255-ish). */
  sceneDelta?: number;
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
}): VideoFactsDraft {
  const durationSec = opts.durationSec ?? null;
  const keyframes = opts.status === "ready" ? pickKeyframes(opts.samples) : [];
  const segments =
    opts.segments ??
    (opts.status === "ready"
      ? buildSceneSegments(opts.samples, durationSec ?? 0)
      : []);

  return {
    status: opts.status,
    cameraOnPct:
      opts.cameraOnPct == null || !Number.isFinite(opts.cameraOnPct)
        ? null
        : Math.max(0, Math.min(100, Math.round(opts.cameraOnPct))),
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
  };
}
