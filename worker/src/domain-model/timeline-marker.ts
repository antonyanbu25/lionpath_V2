/**
 * Timeline markers — the moments that mattered, pinned on the call spine (spec §11.4).
 *
 * Derived deterministically from timestamped evidence that other passes already produce:
 * scorecard `evidenceJson[].atS`, and gap / objection / win verbatims located back in the
 * transcript. No model call, no new prompt.
 *
 * Markers are evidence, not judgement. They never alter a score, and their presence never
 * makes a video-dependent theme applicable.
 */

import type { TimelineSource } from "./video-facts";

export type TimelineMarkerKind = "gap" | "objection" | "win" | "weak_cta";

export interface TimelineMarker {
  id: string;
  callId: string;
  atS: number;
  kind: TimelineMarkerKind;
  label: string;
  quote?: string | null;
  /** Theme the moment came from, when it originated in a scorecard line. */
  themeKey?: string | null;
  source: TimelineSource;
  ownerId: string;
  teamId: string;
  orgId: string;
  createdAt: number;
}

/** Worker draft before dual-write persist (no owner FKs yet). */
export interface TimelineMarkerDraft {
  atS: number;
  kind: TimelineMarkerKind;
  label: string;
  quote?: string | null;
  themeKey?: string | null;
  source: TimelineSource;
}
