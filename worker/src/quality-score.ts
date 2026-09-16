// QIP v2.1 scoring — Appendix B score_call. Mirrored in web/quality-score.js.

import type { PostCallAnalysis } from "./postcall-schema";
import type { CallType, CategoryKey, QipProfile } from "./rubric-profiles";
import { CATEGORY_KEYS, canonicalizeSeMotion, profileFor } from "./rubric-profiles";

/** Spec §9 — only high-confidence calls feed the coaching queue. Mirrored in web. */
export const HIGH_CONFIDENCE_THRESHOLD = 0.7;

/**
 * v2.2 leadership cap — an overall above this bar is only ever rendered as-is once the
 * adversarial verifier (worker/src/postcall/scorecard-verify.ts) has confirmed every
 * sub-parameter still scored 2. Mirrored in web/quality-score.js.
 */
export const LEADERSHIP_CAP_THRESHOLD = 8.0;

type QualityCoach = PostCallAnalysis["qualityCoach"];
type QualityCoachInput = Omit<QualityCoach, "overallScore" | "overallLabel"> & {
  overallScore?: number;
  overallLabel?: string;
};

export type SubParameterValue = 0 | 1 | 2;

export interface SubParameterScore {
  score: SubParameterValue;
  evidence?: Array<{ atS?: number | null; quote?: string | null; source?: string | null }>;
}

export interface ThemeScoreInput {
  themeKey: string;
  /** Five sub-parameter scores — each 0, 1, or 2. */
  subParameters: SubParameterScore[];
  /** requires_video theme with no video — excluded from denominator. */
  evidenceUnavailable?: boolean;
  modelOmitted?: boolean;
}

export interface ThemeScoreResult {
  themeKey: string;
  grade: number;
  credit: number;
  category: CategoryKey;
  contribution: number;
  evidenceUnavailable: boolean;
  includedInDenominator: boolean;
}

export interface ScoreCallResult {
  overall: number;
  totalCredits: number;
  includedCredits: number;
  /** Empty-denom categories (every theme evidenceUnavailable) are `null`, not 0. */
  categoryScores: Record<CategoryKey, number | null>;
  themes: ThemeScoreResult[];
}

export interface ScorecardLineForScore {
  themeKey: string;
  grade: number;
  credit: number;
  category: CategoryKey;
  evidenceUnavailable?: boolean;
}

export interface ScorecardForAggregate {
  callType: CallType | string;
  seMotion?: string;
  rubricVersion: string;
  overall?: number;
  lines: ScorecardLineForScore[];
  provisional?: boolean;
  confidence?: number | null;
}

export interface AggregateEligibility {
  provisional?: boolean;
  confidence?: number | null;
}

export interface AggregateOpts {
  /** Skip provisional / confidence filters — for per-call display only. */
  includeIneligible?: boolean;
  /** Spec §9 — coaching queue and dashboard aggregates. */
  requireHighConfidence?: boolean;
  /** When set, only scorecards with this SE motion. */
  seMotion?: string;
}

/**
 * Shadow + confidence gate for averages, coaching queue, and heatmap.
 */
export function isEligibleForAggregate(
  scorecard: AggregateEligibility,
  opts?: { minConfidence?: number; requireHighConfidence?: boolean },
): boolean {
  if (scorecard.provisional) return false;
  const min =
    opts?.minConfidence ??
    (opts?.requireHighConfidence ? HIGH_CONFIDENCE_THRESHOLD : undefined);
  if (min != null && (scorecard.confidence == null || scorecard.confidence < min)) {
    return false;
  }
  return true;
}

function filterEligibleScorecards<T extends AggregateEligibility>(
  scorecards: T[],
  opts: AggregateOpts = {},
): T[] {
  if (opts.includeIneligible) return scorecards || [];
  return (scorecards || []).filter((sc) =>
    isEligibleForAggregate(sc, { requireHighConfidence: opts.requireHighConfidence }),
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyCategoryScores(): Record<CategoryKey, number | null> {
  return Object.fromEntries(CATEGORY_KEYS.map((k) => [k, null])) as Record<CategoryKey, number | null>;
}

/** Sum five 0/1/2 sub-parameters → theme grade 0..10. */
export function computeThemeGrade(subParameters: SubParameterScore[] | SubParameterValue[]): number {
  let values: number[];
  if (subParameters.length && typeof subParameters[0] === "object") {
    values = (subParameters as SubParameterScore[]).map((sp) => sp.score);
  } else {
    values = subParameters as SubParameterValue[];
  }
  if (values.length !== 5) return 0;
  return values.reduce((acc, v) => acc + (v ?? 0), 0);
}

/**
 * Appendix B score_call — deterministic overall + category scores.
 * Habit themes with no evidence: grade 0, stays in denominator.
 * evidence_unavailable: excluded from denominator (video gaps, and discovery
 * incident themes that never occurred — see discovery-incident-applicability.ts).
 * A category with zero included credits is `null` (UI N/A), not 0. Overall
 * already omits those credits via includedCredits — do not average a fake 0.
 */
export function scoreCall(profile: QipProfile, themeScores: ThemeScoreInput[]): ScoreCallResult {
  const byKey = new Map(themeScores.map((t) => [t.themeKey, t]));
  const themes: ThemeScoreResult[] = [];
  const categoryTotals: Record<string, [number, number]> = {};
  let totalGp = 0;
  let includedCredits = 0;

  for (const theme of profile.themes) {
    const input = byKey.get(theme.key);
    const evidenceUnavailable = !!input?.evidenceUnavailable || !!input?.modelOmitted;
    const subParams = input?.subParameters ?? [];
    const grade = evidenceUnavailable ? 0 : computeThemeGrade(subParams);
    const contribution = grade * theme.credit;
    const includedInDenominator = !evidenceUnavailable;

    themes.push({
      themeKey: theme.key,
      grade,
      credit: theme.credit,
      category: theme.category,
      contribution,
      evidenceUnavailable,
      includedInDenominator,
    });

    if (includedInDenominator) {
      if (!categoryTotals[theme.category]) categoryTotals[theme.category] = [0, 0];
      categoryTotals[theme.category][0] += contribution;
      categoryTotals[theme.category][1] += theme.credit;
      totalGp += contribution;
      includedCredits += theme.credit;
    }
  }

  const categoryScores = emptyCategoryScores();
  for (const cat of CATEGORY_KEYS) {
    const pair = categoryTotals[cat];
    categoryScores[cat] = pair && pair[1] > 0 ? round2(pair[0] / pair[1]) : null;
  }

  const overall = includedCredits > 0 ? round2(totalGp / includedCredits) : 0;

  return {
    overall,
    totalCredits: profile.totalCredits,
    includedCredits,
    categoryScores,
    themes,
  };
}

export interface ProfileAverageResult {
  score: number | null;
  callCount: number;
  includedCredits: number;
  callType: CallType | string;
  rubricVersion: string;
  seMotion?: string;
}

/** Mean overall QIP for one call type across eligible scorecards. */
export function profileAverage(
  scorecards: ScorecardForAggregate[],
  callType: CallType | string,
  opts: AggregateOpts = {},
): ProfileAverageResult {
  const motionFilter = opts.seMotion ? canonicalizeSeMotion(opts.seMotion) : null;
  const pool = filterEligibleScorecards(scorecards, opts).filter((sc) => {
    if (callType && sc.callType !== callType) return false;
    if (motionFilter && canonicalizeSeMotion(sc.seMotion) !== motionFilter) return false;
    return true;
  });
  if (!pool.length) {
    return { score: null, callCount: 0, includedCredits: 0, rubricVersion: "", callType: callType || "" };
  }
  let sum = 0;
  let count = 0;
  for (const sc of pool) {
    if (typeof sc.overall === "number" && Number.isFinite(sc.overall)) {
      sum += sc.overall;
      count += 1;
    }
  }
  const profile = profileFor(callType || pool[0].callType, motionFilter || pool[0].seMotion);
  return {
    score: count > 0 ? round2(sum / count) : null,
    callCount: count,
    includedCredits: profile.totalCredits,
    rubricVersion: pool[0].rubricVersion || "2.1",
    callType: callType || pool[0].callType || "",
    seMotion: motionFilter || pool[0].seMotion || "new_business",
  };
}

export interface ThemeAverageResult {
  score: number | null;
  count: number;
  themeKey: string;
  callTypeFilter: CallType | string | null;
}

/** Mean theme grade (0–10) across scorecards. */
export function themeAverage(
  scorecards: ScorecardForAggregate[],
  themeKey: string,
  callTypeFilter: CallType | string | null = null,
  opts: AggregateOpts = {},
): ThemeAverageResult {
  const motionFilter = opts.seMotion ? canonicalizeSeMotion(opts.seMotion) : null;
  const eligible = filterEligibleScorecards(scorecards, opts).filter((sc) => {
    if (callTypeFilter && sc.callType !== callTypeFilter) return false;
    if (motionFilter && canonicalizeSeMotion(sc.seMotion) !== motionFilter) return false;
    return true;
  });
  let gradeSum = 0;
  let count = 0;
  for (const sc of eligible) {
    const line = (sc.lines || []).find(
      (l) => l.themeKey === themeKey && !l.evidenceUnavailable && !(l as { modelOmitted?: boolean }).modelOmitted,
    );
    if (!line) continue;
    gradeSum += line.grade;
    count += 1;
  }
  return {
    score: count > 0 ? round2(gradeSum / count) : null,
    count,
    themeKey,
    callTypeFilter,
  };
}

/** Display string for profile average — e.g. "7.29 / 10 (demo v2.1)". */
export function formatProfileAverage(result: ProfileAverageResult): string {
  const score = result.score ?? 0;
  return `${score} / 10 (${result.callType} v${result.rubricVersion})`;
}

/** Average dimension performance scaled to 0–10 (legacy quality coach dimensions). */
export function computeOverallScore(dimensions: { score: number; maxScore: number }[]): number | null {
  if (!dimensions?.length) return null;
  let ratioSum = 0;
  let count = 0;
  for (const d of dimensions) {
    const max = d.maxScore > 0 ? d.maxScore : 5;
    if (typeof d.score === "number" && Number.isFinite(d.score)) {
      ratioSum += Math.min(1, Math.max(0, d.score / max));
      count += 1;
    }
  }
  if (!count) return null;
  return round2((ratioSum / count) * 10);
}

/** Map 0–10 overall score to a coaching label. */
export function overallLabelFromScore(score: number): string {
  if (score >= 9) return "Excellent";
  if (score >= 7) return "Strong";
  if (score >= 5.5) return "Good";
  if (score >= 4) return "Developing";
  return "Needs focus";
}

export interface LeadershipCapResult {
  /** Number to render — clamped to LEADERSHIP_CAP_THRESHOLD unless `verified` is true. */
  overall: number;
  /** True when the true overall was pulled down to the cap for display. */
  capped: boolean;
}

/**
 * v2.2 — an overall above LEADERSHIP_CAP_THRESHOLD is only shown as-is once the adversarial
 * verifier has confirmed every sub-parameter still scored 2 (`verified`). Otherwise the
 * rendered number is clamped to the cap so an unverified high score is never treated as
 * leadership-shareable. Pure display transform — never mutates the stored scorecard `overall`.
 * Mirrored in web/quality-score.js so both render identically.
 */
export function applyLeadershipCap(overall: number, verified: boolean): LeadershipCapResult {
  if (typeof overall !== "number" || !Number.isFinite(overall)) {
    return { overall: 0, capped: false };
  }
  if (overall > LEADERSHIP_CAP_THRESHOLD && !verified) {
    return { overall: LEADERSHIP_CAP_THRESHOLD, capped: true };
  }
  return { overall, capped: false };
}

/**
 * Deterministic downgrade (v2.3, mirrors the sub-parameter rule in scorecard.ts): a dimension
 * scored 5 with no specific evidence quoted is not trustworthy at face value — pull it down to
 * 4. This runs before the leadership-cap verifier, so only genuinely-evidenced 5s ever reach
 * that pass.
 */
/**
 * Clamp a dimension score into the range POSTCALL_SCHEMA declares
 * (postcall-schema.ts:139 — minimum 1, maximum 5) and that `maxScore: 5`
 * already asserts alongside it.
 *
 * The bound used to be SCHEMA-ONLY, and two post-call paths drop the schema:
 * `gaps`' jsonMimeOnly fallback and `commit`'s continuation attempt. So a
 * model returning `score: 99` produced `{ score: 99, maxScore: 5 }` — a
 * self-contradicting dimension rendered as-is. Every other numeric field in
 * the post-call output is re-derived server-side; this was the exception
 * (prompt-injection-assessment.md §3.6, R5).
 *
 * Not rounded: the schema says `type: "number"`, so a fractional score is
 * legitimate and rounding would change well-formed output.
 */
function clampDimensionScore(score: unknown): number {
  if (typeof score !== "number" || !Number.isFinite(score)) return 3;
  return Math.min(5, Math.max(1, score));
}

function downgradeUnevidencedFives<T extends { score: number; evidence?: string | null }>(
  dimensions: T[],
): T[] {
  return dimensions.map((d) => (d.score === 5 && !d.evidence?.trim() ? { ...d, score: 4 } : d));
}

export function normalizeQualityCoach(qc: QualityCoachInput): QualityCoach {
  // CLAMP BEFORE DOWNGRADE, and the order is load-bearing.
  //
  // downgradeUnevidencedFives tests `d.score === 5`, an exact match, so an
  // unevidenced score of 99 sailed straight past the very check meant to stop
  // an unevidenced top mark — the downgrade was trivially bypassed by
  // returning a number out of range. Clamping first turns 99 into 5, which the
  // downgrade then takes to 4. Clamping afterwards would leave the bypass
  // intact.
  const clamped = (qc.dimensions || []).map((d) => ({ ...d, score: clampDimensionScore(d.score) }));
  const dimensions = downgradeUnevidencedFives(clamped);
  const computed = computeOverallScore(dimensions);
  const overallScore = computed ?? (typeof qc.overallScore === "number" ? qc.overallScore : 0);
  return {
    ...qc,
    dimensions,
    overallScore,
    overallLabel: overallLabelFromScore(overallScore),
    strengths: qc.strengths || [],
    improvements: qc.improvements || [],
    missedOpportunities: qc.missedOpportunities || [],
  };
}
