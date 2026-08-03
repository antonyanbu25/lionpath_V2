/**
 * Deterministic transcript cues for targeted Pass 2 frame seeks.
 * Reuses parseTranscriptCues — no Gemini required.
 */

import { parseTranscriptCues, type TranscriptCue } from "../transcript";

export type SamplingCueKind = "share" | "slide" | "demo" | "screen";

export interface TranscriptSamplingCue {
  startS: number;
  endS: number | null;
  kind: SamplingCueKind;
  text: string;
}

const SHARE_RE =
  /\b(share(?:d|ing)?|screen\s*share|let me share|i['']?ll share|sharing my screen|start(?:ed)? sharing)\b/i;
const SLIDE_RE = /\b(slide(?:s|\s+\d+|\s+one|\s+two|\s+three)?|deck|ppt|powerpoint|presentation)\b/i;
const DEMO_RE =
  /\b(demo(?:nstrat(?:e|ion|ing))?|walk(?:ing)? through|live tenant|product ui|in the (?:app|portal|console))\b/i;
const SCREEN_RE =
  /\b(as you can see on (?:my )?screen|on (?:my )?screen|what you(?:'re| are) seeing|screenshare)\b/i;
const CDE_RE = /\b(cde|tenant|sandbox|custom(?:ized|er) (?:tenant|instance))\b/i;

function classifyCueText(text: string): SamplingCueKind | null {
  const t = text.trim();
  if (!t) return null;
  if (SLIDE_RE.test(t)) return "slide";
  if (SHARE_RE.test(t) || SCREEN_RE.test(t)) return "share";
  if (DEMO_RE.test(t) || CDE_RE.test(t)) return "demo";
  if (/\bscreen\b/i.test(t) && /\b(show|see|look)\b/i.test(t)) return "screen";
  return null;
}

function cueEndS(cue: TranscriptCue, durationSec: number | null | undefined): number {
  if (cue.endS != null && Number.isFinite(cue.endS) && cue.endS > cue.startS) {
    return cue.endS;
  }
  if (durationSec != null && durationSec > cue.startS) {
    return Math.min(durationSec, cue.startS + 30);
  }
  return cue.startS + 15;
}

/** Merge adjacent cues of the same kind within 5s. */
function mergeAdjacentCues(cues: TranscriptSamplingCue[]): TranscriptSamplingCue[] {
  if (!cues.length) return [];
  const sorted = [...cues].sort((a, b) => a.startS - b.startS);
  const out: TranscriptSamplingCue[] = [];
  let cur = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next.kind === cur.kind && next.startS - (cur.endS ?? cur.startS) <= 5) {
      cur.endS = Math.max(cur.endS ?? cur.startS, next.endS ?? next.startS);
      cur.text = `${cur.text} | ${next.text}`.slice(0, 240);
    } else {
      out.push(cur);
      cur = { ...next };
    }
  }
  out.push(cur);
  return out;
}

/**
 * Extract share/slide/demo/screen timestamps from VTT or bracketed transcript text.
 */
export function extractTranscriptSamplingCues(
  transcript: string,
  durationSec?: number | null,
): TranscriptSamplingCue[] {
  const raw = (transcript || "").trim();
  if (!raw) return [];

  const cues: TranscriptSamplingCue[] = [];
  for (const cue of parseTranscriptCues(raw)) {
    const kind = classifyCueText(cue.text);
    if (!kind) continue;
    cues.push({
      startS: cue.startS,
      endS: cueEndS(cue, durationSec),
      kind,
      text: cue.text.slice(0, 200),
    });
  }

  return mergeAdjacentCues(cues);
}

/** Offsets (seconds) within a cue window for 1–3 JPEG seeks. */
export function seekOffsetsForCue(cue: TranscriptSamplingCue): number[] {
  const span = Math.max(1, (cue.endS ?? cue.startS + 10) - cue.startS);
  if (span <= 4) return [cue.startS];
  if (span <= 12) return [cue.startS, cue.startS + Math.round(span / 2)];
  return [
    cue.startS,
    cue.startS + Math.min(4, Math.round(span / 3)),
    cue.startS + Math.min(8, Math.round((2 * span) / 3)),
  ];
}
