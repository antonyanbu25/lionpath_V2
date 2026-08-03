/** QIP scorecards v2.1 — queryable per-call scoring (POST_CALL_SPEC_V2 §10). */

import type { CallType, CategoryKey } from "../rubric-profiles";

/** Timestamped transcript or video evidence. */
export interface ScorecardEvidence {
  atS?: number | null;
  quote?: string | null;
  source?: "transcript" | "video" | "brief" | "artifact" | string | null;
}

export interface SubParameterLine {
  score: 0 | 1 | 2;
  evidence: ScorecardEvidence[];
}

export interface ScorecardLine {
  id: string;
  scorecardId: string;
  callId: string;
  themeKey: string;
  subParameters: SubParameterLine[];
  /** Sum of five sub-parameter scores (0–10). Computed in code, not by model. */
  grade: number;
  credit: 1 | 2 | 3;
  category: CategoryKey;
  /** requires_video theme with no video — excluded from overall denominator. */
  evidenceUnavailable: boolean;
  confidence: number | null;
  coachingNote: string | null;
  /** Denormalized from scorecard for team heatmap queries without joins. */
  ownerId: string;
  teamId: string;
  orgId: string;
}

export interface Scorecard {
  id: string;
  callId: string;
  rubricId: string;
  /** Overall QIP 0–10 (Appendix B). */
  overall: number;
  /** Profile total credits (fixed denominator for the profile). */
  totalCredits: number;
  /** Credits included after evidence_unavailable exclusions. */
  includedCredits: number;
  categoryScores: Record<CategoryKey, number>;
  confidence: number | null;
  /** Shadow mode — scores compute but stay out of aggregates until calibrated. */
  provisional: boolean;
  ownerId: string;
  teamId: string;
  orgId: string;
  accountId: string;
  callType: CallType;
  rubricVersion: string;
  createdAt: number;
  updatedAt: number;
}

/** Deal risk log — incidents separate from habit themes (QIP §6). */
export type DealRiskCategory =
  | "claim_to_verify"
  | "commitment_outside_remit"
  | "missing_stakeholder"
  | "process_gap"
  | "legal_compliance";

export interface DealRiskFlag {
  id?: string;
  category: DealRiskCategory;
  description: string;
  atS?: number | null;
  quote?: string | null;
  severity?: "low" | "medium" | "high" | string | null;
}

/** Append-only human override log — calibration signal. */
export interface ScoreOverride {
  id: string;
  scorecardLineId: string;
  scorecardId: string;
  callId: string;
  /** Original theme grade 0–10. */
  original: number;
  /** Override theme grade 0–10. */
  override: number;
  userId: string;
  reason: string;
  createdAt: number;
}
