/**
 * Coach module — general instructions, sub-parameter-anchored guidance,
 * and calibration from ScoreOverride log (spec §4, §11).
 */

import { profileFor, type CallType, type QipTheme } from "../rubric-profiles";
import { newId } from "../domain-model/id";
import type { ScoreOverride } from "../domain-model/scorecard";
import { COACH_GENERAL_INSTRUCTIONS } from "./config";
import type {
  CoachAudience,
  CoachBuildInput,
  CoachGeneralInstructions,
  CoachOutput,
  CoachScorecardLineInput,
  ResolveDisputeInput,
  ResolveDisputeResult,
  ScoreDisputeEntry,
  SubParameterCoachNote,
  SubParameterLine,
  ThemeCoachGuidance,
} from "./types";

export { COACH_GENERAL_INSTRUCTIONS } from "./config";
export type * from "./types";

const THEME_LABEL_OVERRIDES: Record<string, string> = {
  cde_build: "CDE build",
  ai: "AI demo",
  camera_on: "Camera on",
};

export function themeDisplayLabel(themeKey: string): string {
  if (THEME_LABEL_OVERRIDES[themeKey]) return THEME_LABEL_OVERRIDES[themeKey];
  return themeKey
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Format seconds as mm:ss for coaching notes. */
export function formatCoachTimestamp(atS: number | null | undefined): string | null {
  if (atS == null || !Number.isFinite(atS)) return null;
  const s = Math.max(0, Math.floor(atS));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function primaryEvidence(sp: SubParameterLine): { atS?: number | null; quote?: string | null } | null {
  const hit = (sp.evidence || []).find((e) => e?.quote && String(e.quote).trim());
  return hit || (sp.evidence?.[0] ?? null);
}

function truncateQuote(quote: string, max = 55): string {
  const cleaned = String(quote || "")
    .trim()
    .replace(/\s+/g, " ");
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function nextTimeAction(spLabel: string, score: 0 | 1): string {
  const lower = spLabel.charAt(0).toLowerCase() + spLabel.slice(1);
  if (score === 0) return `On your next call, ${lower}.`;
  return `Push further — ${lower} with a concrete example or timestamp.`;
}

function formatCalibrationNote(override: ScoreOverride, audience: CoachAudience): string {
  const date = new Date(override.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (audience === "se") {
    const direction =
      override.override > override.original
        ? "Your manager raised this score"
        : override.override < override.original
          ? "Your manager adjusted this score"
          : "Your manager reviewed this score";
    return `${direction} on ${date}.`;
  }
  return `Manager calibrated on ${date}: ${override.reason}`;
}

function adaptationHint(override: ScoreOverride, audience: CoachAudience): string | null {
  const delta = override.override - override.original;
  if (delta === 0) {
    return audience === "se"
      ? "Your dispute was reviewed; the score stands."
      : "Dispute upheld — original score retained.";
  }
  if (delta > 0) {
    return audience === "se"
      ? "Calibration note: the rubric was too harsh here — keep disputing when evidence supports you."
      : "Calibration: model scored harsh; reinforce fair-credit expectations with the SE.";
  }
  return audience === "se"
    ? "Calibration note: your manager agreed this needed more weight — focus here next call."
    : "Calibration: model was generous; double down on this sub-parameter in 1:1.";
}

function buildSubParameterCoachNote(
  themeKey: string,
  spIndex: number,
  spLabel: string,
  sp: SubParameterLine,
  override: ScoreOverride | null,
  audience: CoachAudience,
): SubParameterCoachNote | null {
  const score = sp.score ?? 0;
  if (score >= 2) return null;

  const ev = primaryEvidence(sp);
  const ts = formatCoachTimestamp(ev?.atS);
  const quote = ev?.quote ? truncateQuote(String(ev.quote)) : null;
  const themeLabel = themeDisplayLabel(themeKey);
  const action = nextTimeAction(spLabel, score as 0 | 1);

  const seEvidence = quote ? `you said "${quote}"` : "this wasn't clear on the call";
  const mgrEvidence = quote ? `the SE said "${quote}"` : "the transcript lacks clear evidence";

  const seFacing = ts
    ? `At ${ts}, ${seEvidence}. ${action}`
    : `${action.charAt(0).toUpperCase()}${action.slice(1)}`;
  const managerFacing = ts
    ? `At ${ts}, ${mgrEvidence}. Coach on "${spLabel}" under ${themeLabel} — ${action.replace(/^On the next call, /, "next call: ").replace(/^You started this — next time /, "sharpen: ")}`
    : `Under ${themeLabel}, "${spLabel}" needs work: ${mgrEvidence}. ${action.replace(/^On the next call, /, "1:1 focus: ")}`;

  let calibrationNote: string | undefined;
  if (override) {
    calibrationNote = [formatCalibrationNote(override, audience), adaptationHint(override, audience)]
      .filter(Boolean)
      .join(" ");
  }

  return {
    themeKey,
    subParameterIndex: spIndex,
    subParameterLabel: spLabel,
    score: score as 0 | 1,
    evidenceAtS: ev?.atS ?? null,
    evidenceQuote: quote,
    seFacing,
    managerFacing,
    calibrationNote,
  };
}

function themeGrade(line: CoachScorecardLineInput): number {
  if (line.evidenceUnavailable || line.applicable === false) return -1;
  if (typeof line.grade === "number") return line.grade;
  const subs = line.subParameters || [];
  if (subs.length === 5) return subs.reduce((acc, sp) => acc + (sp.score ?? 0), 0);
  return 0;
}

function overrideForLine(overrides: ScoreOverride[], line: CoachScorecardLineInput): ScoreOverride | null {
  if (!line.id || !overrides?.length) return null;
  const matches = overrides
    .filter((o) => o.scorecardLineId === line.id)
    .sort((a, b) => b.createdAt - a.createdAt);
  return matches[0] ?? null;
}

function buildThemeCoachGuidance(
  line: CoachScorecardLineInput,
  profileTheme: QipTheme | undefined,
  overrides: ScoreOverride[],
  audience: CoachAudience,
): ThemeCoachGuidance | null {
  if (line.evidenceUnavailable || line.applicable === false) return null;
  const grade = themeGrade(line);
  if (grade < 0) return null;

  const subLabels = profileTheme?.subParameters || [];
  const subParams =
    line.subParameters?.length === 5
      ? line.subParameters
      : Array.from({ length: 5 }, (_, i) => ({ score: 0 as const, evidence: [] }));

  const override = overrideForLine(overrides, line);
  const subParameterNotes = subParams
    .map((sp, i) =>
      buildSubParameterCoachNote(
        line.themeKey,
        i,
        subLabels[i] || `Sub-parameter ${i + 1}`,
        sp,
        override,
        audience,
      ),
    )
    .filter((n): n is SubParameterCoachNote => n != null);

  const lostPoints = grade < 10;
  if (!lostPoints && !subParameterNotes.length) return null;

  const themeLabel = themeDisplayLabel(line.themeKey);
  let themeSummary: ThemeCoachGuidance["themeSummary"];

  if (lostPoints) {
    const weakCount = subParameterNotes.length;
    const seFacing =
      weakCount > 0
        ? `${themeLabel} lost ${10 - grade} point${10 - grade === 1 ? "" : "s"} — ${weakCount} sub-parameter${weakCount === 1 ? "" : "s"} to tighten.`
        : line.coachingNote?.trim() ||
          `${themeLabel} has room to grow (${grade}/10). Review sub-parameters below.`;
    const managerFacing =
      weakCount > 0
        ? `${themeLabel} at ${grade}/10 — focus 1:1 on ${weakCount} weak sub-parameter${weakCount === 1 ? "" : "s"}.`
        : `${themeLabel} at ${grade}/10 — open with evidence from the weakest sub-parameter.`;
    themeSummary = { seFacing, managerFacing };
  }

  return {
    themeKey: line.themeKey,
    themeLabel,
    grade,
    lostPoints,
    subParameterNotes,
    themeSummary,
  };
}

/** Build full Coach output for a scorecard. */
export function buildCoachOutput(input: CoachBuildInput): CoachOutput {
  const audience = input.audience ?? "se";
  const instructions = input.instructions ?? COACH_GENERAL_INSTRUCTIONS;
  const profile = profileFor(input.callType);
  const overrides = input.overrides ?? [];

  const themes = (input.lines || [])
    .map((line) => {
      const profileTheme = profile.themes.find((t) => t.key === line.themeKey);
      return buildThemeCoachGuidance(line, profileTheme, overrides, audience);
    })
    .filter((t): t is ThemeCoachGuidance => t != null);

  return {
    configVersion: instructions.version,
    callId: input.callId,
    callType: input.callType,
    audience,
    generalInstructions: instructions,
    themes,
  };
}

/** Lookup rendered coach text for one sub-parameter row. */
export function coachTextForSubParameter(
  output: CoachOutput | null | undefined,
  themeKey: string,
  subParameterIndex: number,
): string | null {
  const theme = output?.themes.find((t) => t.themeKey === themeKey);
  const note = theme?.subParameterNotes.find((n) => n.subParameterIndex === subParameterIndex);
  if (!note) return null;
  const base = output?.audience === "manager" ? note.managerFacing : note.seFacing;
  return note.calibrationNote ? `${base} ${note.calibrationNote}` : base;
}

/** Manager resolves a dispute — append-only ScoreOverride when adjusted. */
export function resolveScoreDispute(input: ResolveDisputeInput): ResolveDisputeResult {
  const { dispute, ruling, managerId, overrideGrade, reason } = input;
  const now = new Date().toISOString();

  if (ruling === "uphold") {
    return {
      dispute: {
        ...dispute,
        status: "upheld",
        resolvedAt: now,
        resolvedBy: managerId,
        ruling: "uphold",
        rulingReason: reason || dispute.note,
      },
    };
  }

  const original = dispute.grade ?? dispute.score ?? 0;
  const override = Math.max(0, Math.min(10, overrideGrade ?? original));
  const overrideEntry: ScoreOverride = {
    id: newId("scoreOverride"),
    scorecardLineId: dispute.scorecardLineId || `scl_dispute_${dispute.id}`,
    scorecardId: dispute.scorecardId || `scr_dispute_${dispute.callId || dispute.id}`,
    callId: dispute.callId || "",
    original,
    override,
    userId: managerId,
    reason: reason || dispute.note,
    createdAt: Date.now(),
  };

  return {
    dispute: {
      ...dispute,
      status: "adjusted",
      resolvedAt: now,
      resolvedBy: managerId,
      ruling: "adjust",
      rulingReason: reason || dispute.note,
      overrideId: overrideEntry.id,
    },
    override: overrideEntry,
  };
}

/** Find the latest override for a theme on a call. */
export function overridesForCall(overrides: ScoreOverride[], callId: string): ScoreOverride[] {
  return (overrides || []).filter((o) => o.callId === callId);
}

/** @deprecated use buildCoachOutput */
export function buildCoachForScorecard(input: CoachBuildInput): CoachOutput {
  return buildCoachOutput(input);
}

export function coachNoteForSubParameter(
  output: CoachOutput | null | undefined,
  themeKey: string,
  subParameterIndex: number,
): string | null {
  return coachTextForSubParameter(output, themeKey, subParameterIndex);
}

export type { CallType };
