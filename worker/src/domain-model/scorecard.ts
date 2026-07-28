/** QIP scorecards — queryable per-call scoring (POST_CALL_SPEC_V2 §10). */

import type { CallType } from "../rubric-profiles";

/** Timestamped transcript or video evidence for one scorecard line. */
export interface ScorecardEvidence {
  atS?: number | null;
  quote?: string | null;
  source?: "transcript" | "video" | "brief" | "artifact" | string | null;
}

export interface Scorecard {
  id: string;
  callId: string;
  rubricId: string;
  rawScore: number;
  denominator: number;
  confidence: number | null;
  /** Shadow mode — scores compute but stay out of aggregates until calibrated (§6.6). */
  provisional: boolean;
  /** Denormalized from PostCall for queries and RBAC. */
  ownerId: string;
  teamId: string;
  orgId: string;
  accountId: string;
  callType: CallType;
  rubricVersion: string;
  createdAt: number;
  updatedAt: number;
}

export interface ScorecardLine {
  id: string;
  scorecardId: string;
  callId: string;
  themeKey: string;
  score: number;
  maxScore: number;
  applicable: boolean;
  /** Why the theme was marked not applicable — render greyed with this reason, never as zero. */
  notApplicableReason?: string | null;
  confidence: number | null;
  evidenceJson: ScorecardEvidence[];
  coachingNote: string | null;
  /** Rubric weight at score time — denormalized for composite + heatmap queries. */
  weight: number;
  /** Denormalized from scorecard for team heatmap queries without joins. */
  ownerId: string;
  teamId: string;
  orgId: string;
}

/** Append-only human override log — the calibration signal (§6.5, QIP_PROFILES §5). */
export interface ScoreOverride {
  id: string;
  scorecardLineId: string;
  scorecardId: string;
  callId: string;
  original: number;
  override: number;
  userId: string;
  reason: string;
  createdAt: number;
}
