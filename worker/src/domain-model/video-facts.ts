/** Pass 2 video facts — queryable per-call (POST_CALL_SPEC_V2 §10). */

export type VideoFactsStatus = "pending" | "ready" | "failed" | "unavailable";

/** Pass 2 share/scene segments — what was on screen. */
export type VideoSegmentType =
  | "slides"
  | "product"
  | "cde"
  | "customer_screen"
  | "none"
  | "scene_change";

/**
 * Conversation phases derived from transcript cue timestamps when there is no video.
 * Display only — a transcript spine never makes `call_flow` scoreable (spec §6.5).
 */
export type TranscriptSegmentType =
  | "intro"
  | "discovery"
  | "demo"
  | "pricing"
  | "objection_handling"
  | "next_steps";

export type TimelineSegmentType = VideoSegmentType | TranscriptSegmentType;

export type TimelineSource = "video" | "transcript" | "summary";

export interface KeyframeRef {
  atS: number;
  path: string;
  kind?: string | null;
}

export interface VideoFacts {
  id: string;
  callId: string;
  status: VideoFactsStatus;
  cameraOnPct: number | null;
  keyframeRefs: KeyframeRef[];
  attendeeCurveJson?: unknown | null;
  cdeCustomized?: boolean | null;
  cdeEvidence?: string | null;
  sampleIntervalS: number;
  durationSec?: number | null;
  streamKind?: string | null;
  errorMessage?: string | null;
  retentionExpiresAt: number;
  ownerId: string;
  teamId: string;
  orgId: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
}

export interface TimelineSegment {
  id: string;
  callId: string;
  /** Null on transcript-derived segments — there is no Pass 2 doc to hang them off. */
  videoFactsId: string | null;
  source: TimelineSource;
  startS: number;
  endS: number;
  segmentType: TimelineSegmentType;
  label?: string | null;
  ownerId: string;
  teamId: string;
  orgId: string;
}

/** Worker draft before dual-write persist (no owner FKs yet). */
export interface VideoFactsDraft {
  status: VideoFactsStatus;
  cameraOnPct: number | null;
  keyframeRefs: KeyframeRef[];
  sampleIntervalS: number;
  durationSec?: number | null;
  streamKind?: string | null;
  errorMessage?: string | null;
  retentionExpiresAt: number;
  cdeCustomized?: boolean | null;
  cdeEvidence?: string | null;
  shareOnPct?: number | null;
  /** Spec §12.8 — face/camera vision only when true. */
  visualAnalysisConsent?: boolean;
  /** Per-participant talk % / camera — from Pass 2 transcript or keyframe vision. */
  attendeeCurveJson?: Array<{
    name: string;
    talkPct?: number | null;
    cameraOn?: boolean | null;
    /** Estimated % of sampled call time with camera on (Pass 2 vision). */
    cameraOnPct?: number | null;
    role?: string | null;
  }> | null;
  segments: Array<{
    startS: number;
    endS: number;
    segmentType: TimelineSegmentType;
    label?: string | null;
  }>;
  /** Slides/PPT detected in sampled frames. */
  pptUsed?: boolean | null;
  pptEvidence?: string | null;
  slideDeckTailored?: boolean | null;
  slideVisualsWalked?: boolean | null;
  /** Kaia / plain-summary phase spine — display only, source summary. */
  timelineSpine?: {
    source: "summary";
    segments: Array<{
      startS: number;
      endS: number;
      segmentType: TranscriptSegmentType;
      label?: string | null;
      source?: "summary";
    }>;
    durationSec?: number | null;
  } | null;
}
