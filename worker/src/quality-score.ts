// QIP v2.1 scoring — Appendix B score_call. Mirrored in web/quality-score.js.

import type { PostCallAnalysis } from "./postcall-schema";
import type { CallType, CategoryKey, QipProfile } from "./rubric-profiles";
import { CATEGORY_KEYS, profileFor } from "./rubric-profiles";

/** Spec §9 — only high-confidence calls feed the coaching queue. Mirrored in web. */
export const HIGH_CONFIDENCE_THRESHOLD = 0.7;

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
  categoryScores: Record<CategoryKey, number>;
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

function emptyCategoryScores(): Record<CategoryKey, number> {
  return Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 0])) as Record<CategoryKey, number>;
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
 * Non-applicable (no evidence): grade 0, stays in denominator.
 * evidence_unavailable: excluded from denominator, lowers confidence separately.
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
    categoryScores[cat] = pair && pair[1] > 0 ? round2(pair[0] / pair[1]) : 0;
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
}

/** Mean overall QIP for one call type across eligible scorecards. */
export function profileAverage(
  scorecards: ScorecardForAggregate[],
  callType: CallType | string,
  opts: AggregateOpts = {},
): ProfileAverageResult {
  const pool = filterEligibleScorecards(scorecards, opts).filter(
    (sc) => !callType || sc.callType === callType,
  );
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
  const profile = profileFor(callType as CallType);
  return {
    score: count > 0 ? round2(sum / count) : null,
    callCount: count,
    includedCredits: profile.totalCredits,
    rubricVersion: pool[0].rubricVersion || "2.1",
    callType: callType || pool[0].callType || "",
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
  const eligible = filterEligibleScorecards(scorecards, opts).filter(
    (sc) => !callTypeFilter || sc.callType === callTypeFilter,
  );
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

export function normalizeQualityCoach(qc: QualityCoachInput): QualityCoach {
  const dimensions = qc.dimensions || [];
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
