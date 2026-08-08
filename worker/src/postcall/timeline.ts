/**
 * Call timeline from a timestamped transcript — the spine and the moments on it.
 *
 * Deterministic and model-free, like the ARR price book. Every output traces to a cue
 * timestamp that exists in the transcript, so a marker can always be defended by playing
 * the call at that second.
 *
 * Boundary (spec §6.5): this is display evidence, never scoring input. A transcript spine
 * does not make `call_flow`, `camera_on`, `cde_build` or `customer_engagement` applicable —
 * those still require Pass 2 video. Nothing here touches a score.
 */

import { parseTranscriptCues, type TranscriptCue } from "../transcript";
import type { TimelineMarkerDraft } from "../domain-model/timeline-marker";
import type { TranscriptSegmentType } from "../domain-model/video-facts";

export interface TranscriptSegmentDraft {
  startS: number;
  endS: number;
  segmentType: TranscriptSegmentType;
  label?: string | null;
  source: "transcript";
}

export interface CallTimelineDraft {
  source: "transcript";
  segments: TranscriptSegmentDraft[];
  markers: TimelineMarkerDraft[];
  /** False when the transcript carried no clock — the card must say so, not show an empty axis. */
  hasTimestamps: boolean;
  durationSec: number | null;
}

/** Phase lexicons. Ordered by specificity — pricing/next-steps beat generic discovery. */
const PHASE_CUES: Array<{ phase: TranscriptSegmentType; weight: number; terms: string[] }> = [
  {
    phase: "intro",
    weight: 1,
    terms: [
      "thanks for joining", "thank you for joining", "introduce", "introductions",
      "agenda for today", "agenda is", "kick off", "kicking off", "housekeeping",
      "is being recorded", "quick round", "who's on the call", "who is on the call",
    ],
  },
  {
    phase: "discovery",
    weight: 1,
    terms: [
      "how do you currently", "how are you currently", "today you", "what's your process",
      "what is your process", "tell me about", "walk me through your", "challenge",
      "pain point", "the problem", "how many agents", "team size", "ticket volume",
      "use case", "workflow", "why now", "what triggered", "what does success look like",
    ],
  },
  {
    phase: "demo",
    weight: 1,
    terms: [
      "let me show you", "share my screen", "sharing my screen", "can you see my screen",
      "you can see here", "if i click", "let's click", "navigate to", "over here on the",
      "this dashboard", "walk you through the", "let's look at", "in the product",
      "as you can see", "this screen",
    ],
  },
  {
    phase: "pricing",
    weight: 2,
    terms: [
      "pricing", "the price", "cost per", "per agent per", "per user per", "list price",
      "discount", "budget", "quote", "commercials", "commercial terms", "subscription",
      "annual contract", "licence", "license cost", "arr",
    ],
  },
  {
    phase: "objection_handling",
    weight: 2,
    terms: [
      "my concern", "our concern", "worried about", "the issue is", "the problem with that",
      "not sure that", "pushback", "we already have", "compared to", "competitor",
      "security review", "compliance", "that won't work", "that will not work",
      "deal breaker", "hesitation",
    ],
  },
  {
    phase: "next_steps",
    weight: 3,
    terms: [
      "next steps", "next step is", "follow up", "follow-up", "i'll send", "we'll send",
      "circle back", "action item", "by when", "let's schedule", "set up a call",
      "get back to you", "who will own", "i will share", "recap",
    ],
  },
];

/** Below this a phase run is noise — merge it into the neighbour. */
const MIN_SEGMENT_S = 45;

/**
 * Agenda-setting names the phases that are coming — "then we'll cover pricing and next
 * steps" is intro, not pricing. A plan marker pins the cue to intro whatever else it hits.
 */
const PLAN_MARKERS = [
  "agenda for today", "agenda is", "agenda today", "before we start", "before we dive in",
  "we'll cover", "we will cover", "plan for today", "to start with", "first we'll",
  "then we'll", "and then we can", "what i'd like to do today",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phaseForCue(cue: TranscriptCue): TranscriptSegmentType | null {
  const text = normalize(cue.text);
  if (!text) return null;
  if (PLAN_MARKERS.some((marker) => text.includes(normalize(marker)))) return "intro";

  let best: { phase: TranscriptSegmentType; score: number } | null = null;
  for (const { phase, weight, terms } of PHASE_CUES) {
    let score = 0;
    for (const term of terms) {
      if (text.includes(normalize(term))) score += weight;
    }
    if (score > 0 && (!best || score > best.score)) best = { phase, score };
  }
  return best?.phase ?? null;
}

/**
 * Assign every cue a phase, carrying the previous phase through silence, then merge runs.
 * Phases are contiguous and non-overlapping — a call has one shape, not competing labels.
 */
export function derivePhaseSpine(cues: TranscriptCue[]): TranscriptSegmentDraft[] {
  if (!cues.length) return [];

  const ordered = [...cues].sort((a, b) => a.startS - b.startS);
  const endOfCall = ordered.reduce(
    (max, c) => Math.max(max, c.endS ?? c.startS),
    ordered[0].startS,
  );

  const labelled: Array<{ startS: number; endS: number; phase: TranscriptSegmentType }> = [];
  let current: TranscriptSegmentType = "intro";
  for (let i = 0; i < ordered.length; i += 1) {
    const cue = ordered[i];
    current = phaseForCue(cue) ?? current;
    const endS = cue.endS ?? ordered[i + 1]?.startS ?? endOfCall;
    labelled.push({ startS: cue.startS, endS: Math.max(endS, cue.startS), phase: current });
  }

  const merged: TranscriptSegmentDraft[] = [];
  for (const item of labelled) {
    const last = merged[merged.length - 1];
    if (last && last.segmentType === item.phase) {
      last.endS = Math.max(last.endS, item.endS);
      continue;
    }
    merged.push({
      startS: item.startS,
      endS: item.endS,
      segmentType: item.phase,
      label: PHASE_LABELS[item.phase],
      source: "transcript",
    });
  }

  return collapseShortRuns(merged);
}

const PHASE_LABELS: Record<TranscriptSegmentType, string> = {
  intro: "Intro and agenda",
  discovery: "Discovery",
  demo: "Demo",
  pricing: "Pricing and commercials",
  objection_handling: "Objection handling",
  next_steps: "Next steps",
};

function collapseShortRuns(segments: TranscriptSegmentDraft[]): TranscriptSegmentDraft[] {
  if (segments.length <= 1) return segments;
  const out: TranscriptSegmentDraft[] = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    const tooShort = seg.endS - seg.startS < MIN_SEGMENT_S;
    if (last && tooShort) {
      last.endS = Math.max(last.endS, seg.endS);
      continue;
    }
    if (last && last.segmentType === seg.segmentType) {
      last.endS = Math.max(last.endS, seg.endS);
      continue;
    }
    out.push({ ...seg });
  }
  return out;
}

/**
 * Find when a quote was said by matching its opening words against the cue stream.
 * Falls back to progressively shorter prefixes because models paraphrase tails.
 * Returns null rather than guessing — an unplaced marker is better than a wrong one.
 */
export function locateQuoteAtS(quote: string, cues: TranscriptCue[]): number | null {
  const needleWords = normalize(quote).split(" ").filter(Boolean);
  if (needleWords.length < 3 || !cues.length) return null;

  const haystack = cues.map((cue) => ({ startS: cue.startS, text: normalize(cue.text) }));

  for (const len of [12, 8, 6, 4, 3]) {
    if (needleWords.length < len) continue;
    const probe = needleWords.slice(0, len).join(" ");
    const hit = haystack.find((cue) => cue.text.includes(probe));
    if (hit) return hit.startS;
  }
  return null;
}

export interface TimelineMarkerSources {
  gaps?: Array<{
    verbatim?: string | null;
    productArea?: string | null;
    subArea?: string | null;
    headline?: string | null;
    atS?: number | null;
  }>;
  whatWorks?: Array<{
    verbatim?: string | null;
    productArea?: string | null;
    subArea?: string | null;
    headline?: string | null;
    atS?: number | null;
  }>;
  objections?: Array<{
    objectionText?: string | null;
    theme?: string | null;
    landed?: boolean;
    atS?: number | null;
  }>;
  scorecardLines?: Array<{
    themeKey: string;
    score: number;
    maxScore: number;
    applicable: boolean;
    evidence?: Array<{ atS?: number | null; quote?: string | null }>;
  }>;
}

function truncateLabel(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** Snake_case taxonomy keys → Title Case UI labels. */
export function formatTaxonomyLabel(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s
    .split("_")
    .filter(Boolean)
    .map((word) => {
      const w = word.toLowerCase();
      if (w === "ai") return "AI";
      if (w === "cde") return "CDE";
      if (w === "sso") return "SSO";
      if (w === "api") return "API";
      if (w === "ui") return "UI";
      if (w === "ux") return "UX";
      if (w === "itsm") return "ITSM";
      if (w === "crm") return "CRM";
      if (w === "ppm") return "PPM";
      if (w === "tco") return "TCO";
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export function formatProductAreaLabel(
  productArea: string | null | undefined,
  subArea?: string | null,
): string {
  const area = formatTaxonomyLabel(productArea || "other");
  const sub = String(subArea || "").trim();
  if (!sub || sub === "other") return area;
  return `${area} · ${formatTaxonomyLabel(sub)}`;
}

function resolveMarkerAtS(
  explicit: number | null | undefined,
  quote: string | null | undefined,
  cues: TranscriptCue[],
): number | null {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit >= 0) {
    return Math.round(explicit);
  }
  if (quote) return locateQuoteAtS(quote, cues);
  return null;
}

function stripObjectionFraming(text: string): string {
  return String(text || "")
    .replace(
      /^(?:Customer|Prospect|The customer|The prospect)\s+(?:expressed(?:\s+concern(?:\s+that)?|\s+that|\s+a concern about)?|raised|asked|noted|said|mentioned|was concerned(?:\s+that)?|pushed back(?:\s+on)?|questioned)\s+/i,
      "",
    )
    .trim();
}

/** A CTA line scoring under half its ceiling is the "weak close" moment. */
function weakCtaMarker(
  sources: TimelineMarkerSources,
  cues: TranscriptCue[],
): TimelineMarkerDraft | null {
  const line = sources.scorecardLines?.find((l) => l.themeKey === "cta");
  if (!line || !line.applicable || !line.maxScore) return null;
  if (line.score / line.maxScore >= 0.5) return null;

  const evidence = (line.evidence || []).find((e) => e.atS != null || e.quote);
  const atS =
    evidence?.atS ??
    (evidence?.quote ? locateQuoteAtS(evidence.quote, cues) : null) ??
    null;
  if (atS == null) return null;

  return {
    atS,
    kind: "weak_cta",
    label: evidence?.quote ? truncateLabel(evidence.quote) : "Weak close",
    quote: evidence?.quote ?? null,
    themeKey: "cta",
    source: "transcript",
  };
}

/**
 * Pin gaps, wins, objections and a weak close onto the transcript clock.
 * Anything whose words cannot be found in the transcript is dropped, not approximated.
 */
export function deriveMarkers(
  cues: TranscriptCue[],
  sources: TimelineMarkerSources = {},
): TimelineMarkerDraft[] {
  if (!cues.length) return [];
  const markers: TimelineMarkerDraft[] = [];

  for (const gap of sources.gaps || []) {
    if (!gap.verbatim && gap.atS == null) continue;
    const atS = resolveMarkerAtS(gap.atS, gap.verbatim, cues);
    if (atS == null) continue;
    const headline = gap.headline?.trim();
    const label = headline
      ? truncateLabel(headline, 48)
      : formatProductAreaLabel(gap.productArea, gap.subArea) ||
        truncateLabel(gap.verbatim || "Product gap", 48);
    markers.push({
      atS,
      kind: "gap",
      label,
      quote: gap.verbatim ?? null,
      source: "transcript",
    });
  }

  for (const win of sources.whatWorks || []) {
    if (!win.verbatim && win.atS == null) continue;
    const atS = resolveMarkerAtS(win.atS, win.verbatim, cues);
    if (atS == null) continue;
    const headline = win.headline?.trim();
    const label = headline
      ? truncateLabel(headline, 48)
      : formatProductAreaLabel(win.productArea, win.subArea) ||
        truncateLabel(win.verbatim || "What landed", 48);
    markers.push({
      atS,
      kind: "win",
      label,
      quote: win.verbatim ?? null,
      source: "transcript",
    });
  }

  for (const objection of sources.objections || []) {
    if (!objection.objectionText && objection.atS == null) continue;
    const atS = resolveMarkerAtS(objection.atS, objection.objectionText, cues);
    if (atS == null) continue;
    const themeLabel = objection.theme ? formatTaxonomyLabel(objection.theme) : "";
    const label = themeLabel
      ? truncateLabel(themeLabel, 48)
      : truncateLabel(stripObjectionFraming(objection.objectionText || ""), 48);
    markers.push({
      atS,
      kind: "objection",
      label: label || "Objection",
      quote: objection.objectionText ?? null,
      source: "transcript",
    });
  }

  const weak = weakCtaMarker(sources, cues);
  if (weak) markers.push(weak);

  return dedupeMarkers(markers);
}

/** Two markers of one kind within 5s are the same moment described twice. */
function dedupeMarkers(markers: TimelineMarkerDraft[]): TimelineMarkerDraft[] {
  const seen = new Set<string>();
  return markers
    .slice()
    .sort((a, b) => a.atS - b.atS)
    .filter((m) => {
      const key = `${m.kind}:${Math.round(m.atS / 5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function deriveCallTimeline(
  transcript: string,
  sources: TimelineMarkerSources = {},
): CallTimelineDraft {
  const cues = parseTranscriptCues(transcript);
  if (!cues.length) {
    return {
      source: "transcript",
      segments: [],
      markers: [],
      hasTimestamps: false,
      durationSec: null,
    };
  }

  const durationSec = cues.reduce((max, c) => Math.max(max, c.endS ?? c.startS), 0);
  return {
    source: "transcript",
    segments: derivePhaseSpine(cues),
    markers: deriveMarkers(cues, sources),
    hasTimestamps: true,
    durationSec: durationSec > 0 ? Math.round(durationSec) : null,
  };
}
