/** Coach module types — QIP v2.1 coaching guidance (spec §4, §11). */

import type { CallType } from "../rubric-profiles";
import type { ScoreOverride, ScorecardEvidence, SubParameterLine } from "../domain-model/scorecard";

/** Versioned general coaching instructions — editable independently of per-call output. */
export interface CoachGeneralInstructions {
  version: string;
  voice: string;
  rules: string[];
}

export type CoachAudience = "se" | "manager";

export type DisputeStatus = "pending" | "upheld" | "adjusted";

export type DisputeRuling = "uphold" | "adjust";

/** SE-submitted score dispute — precursor to ScoreOverride when manager adjusts. */
export interface ScoreDisputeEntry {
  id: string;
  createdAt: string;
  category: string;
  categoryLabel: string;
  note: string;
  callId?: string;
  themeKey?: string;
  /** Theme grade 0–10 when available. */
  grade?: number | null;
  score?: number | null;
  company?: string;
  scorecardId?: string;
  scorecardLineId?: string;
  status: DisputeStatus;
  resolvedAt?: string;
  resolvedBy?: string;
  ruling?: DisputeRuling;
  rulingReason?: string;
  overrideId?: string;
}

export interface SubParameterCoachNote {
  themeKey: string;
  subParameterIndex: number;
  subParameterLabel: string;
  score: 0 | 1 | 2;
  evidenceAtS?: number | null;
  evidenceQuote?: string | null;
  seFacing: string;
  managerFacing: string;
  /** Present when a manager ScoreOverride applies to this theme line. */
  calibrationNote?: string;
}

export interface ThemeCoachGuidance {
  themeKey: string;
  themeLabel: string;
  grade: number;
  /** Theme lost at least one sub-parameter point. */
  lostPoints: boolean;
  subParameterNotes: SubParameterCoachNote[];
  /** Theme-level summary when the theme lost points. */
  themeSummary?: { seFacing: string; managerFacing: string };
}

export interface CoachBuildInput {
  callId?: string;
  callType: CallType;
  lines: CoachScorecardLineInput[];
  overrides?: ScoreOverride[];
  audience?: CoachAudience;
  instructions?: CoachGeneralInstructions;
}

/** Minimal scorecard line shape for coach generation. */
export interface CoachScorecardLineInput {
  id?: string;
  themeKey: string;
  grade?: number | null;
  coachingNote?: string | null;
  evidenceUnavailable?: boolean;
  applicable?: boolean;
  subParameters?: SubParameterLine[];
}

export interface CoachOutput {
  configVersion: string;
  callId?: string;
  callType: CallType;
  audience: CoachAudience;
  generalInstructions: CoachGeneralInstructions;
  themes: ThemeCoachGuidance[];
}

export interface ResolveDisputeInput {
  dispute: ScoreDisputeEntry;
  ruling: DisputeRuling;
  managerId: string;
  /** Required when ruling is adjust — override theme grade 0–10. */
  overrideGrade?: number;
  reason?: string;
}

export interface ResolveDisputeResult {
  dispute: ScoreDisputeEntry;
  override?: ScoreOverride;
}

export type { ScoreOverride, ScorecardEvidence, SubParameterLine };
