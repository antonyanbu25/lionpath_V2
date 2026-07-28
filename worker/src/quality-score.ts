// Deterministic overall score + label from dimension scores (model outputs dimensions only).
// QIP type and spine composites — mirrored in web/quality-score.js.

import type { PostCallAnalysis } from "./postcall-schema";
import { CORE_FOUR_THEME_KEYS, type CallType } from "./rubric-profiles";

/** Spec §9 — only high-confidence calls feed the coaching queue. Mirrored in web. */
export const HIGH_CONFIDENCE_THRESHOLD = 0.7;

type QualityCoach = PostCallAnalysis["qualityCoach"];
type QualityCoachInput = Omit<QualityCoach, "overallScore" | "overallLabel"> & {
  overallScore?: number;
  overallLabel?: string;
};

/** Line input for typeComposite — weight comes from the rubric at score time. */
export interface ScorecardLineForComposite {
  themeKey: string;
  score: number;
  maxScore: number;
  applicable: boolean;
  weight: number;
}

/** Scorecard + lines passed to typeComposite. */
export interface ScorecardForTypeComposite {
  callType: CallType;
  rubricVersion: string;
  lines: ScorecardLineForComposite[];
  provisional?: boolean;
  confidence?: number | null;
}

export interface TypeCompositeResult {
  score: number | null;
  applicableWeight: number;
  totalWeight: number;
  applicableCount: number;
  rubricVersion: string;
  callType: CallType | string;
}

/** Line input for spineComposite — core-four themes only. */
export interface ScorecardLineForSpine {
  themeKey: string;
  score: number;
  maxScore: number;
  applicable: boolean;
  weight?: number;
}

export interface ScorecardForSpineComposite {
  callType?: CallType;
  lines: ScorecardLineForSpine[];
  /** Shadow mode — exclude from spine when true (§6.6). */
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
 * Shadow + confidence gate for averages, coaching queue, spine, and heatmap.
 * One boolean (provisional) plus exclusion in every aggregation query (§6.6 / §9).
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

export interface SpineCompositeResult {
  score: number | null;
  themeCount: number;
  callCount: number;
  coverage: number;
}

export interface ThemeAverageResult {
  score: number | null;
  count: number;
  themeKey: string;
  maxScore: number;
  callTypeFilter: CallType | string | null;
}

/**
 * Weighted composite within one call type.
 * sum(score × weight) over applicable lines ÷ sum(weight) over applicable lines.
 * Score is 0..maxScore per line (typically 0..100); normalized before weighting.
 */
export function typeComposite(
  scorecards: ScorecardForTypeComposite[],
  callType: CallType | string,
  opts: AggregateOpts = {},
): TypeCompositeResult {
  const pool = filterEligibleScorecards(scorecards, opts).filter(
    (sc) => !callType || sc.callType === callType,
  );

  if (!pool.length) {
    return {
      score: null,
      applicableWeight: 0,
      totalWeight: 0,
      applicableCount: 0,
      rubricVersion: "",
      callType: callType || "",
    };
  }

  let earnedSum = 0;
  let applicableWeight = 0;
  let totalWeight = 0;
  let applicableCount = 0;
  const rubricVersion = pool[0].rubricVersion || "1.0";
  const resolvedCallType = callType || pool[0].callType || "";

  for (const scorecard of pool) {
    for (const line of scorecard.lines || []) {
      const weight = line.weight ?? 0;
      totalWeight += weight;
      if (!line.applicable) continue;
      applicableCount += 1;
      applicableWeight += weight;
      const max = line.maxScore > 0 ? line.maxScore : 100;
      const normalized = Math.min(1, Math.max(0, line.score / max));
      earnedSum += normalized * weight;
    }
  }

  const score =
    applicableWeight > 0 ? Math.round((earnedSum / applicableWeight) * 100 * 10) / 10 : null;

  return {
    score,
    applicableWeight,
    totalWeight,
    applicableCount,
    rubricVersion,
    callType: resolvedCallType,
  };
}

/** Display string for a type composite — e.g. "86 / 100 (demo v1.0)". */
export function formatTypeComposite(result: TypeCompositeResult): string {
  const score = result.score ?? 0;
  const denom = result.applicableWeight > 0 ? 100 : 0;
  return `${score} / ${denom} (${result.callType} v${result.rubricVersion})`;
}

/**
 * Cross-type spine composite over the core four only — unweighted mean of raw theme scores.
 * Never blend weighted type composites across call types (spec §6.1).
 */
export function spineComposite(
  scorecards: ScorecardForSpineComposite[],
  opts: AggregateOpts = {},
): SpineCompositeResult {
  const eligible = filterEligibleScorecards(scorecards, opts);
  const callCount = eligible.length;
  if (!callCount) {
    return { score: null, themeCount: 0, callCount: 0, coverage: 0 };
  }

  let scoreSum = 0;
  let themeCount = 0;
  let fullCoverageCount = 0;

  for (const sc of eligible) {
    const lineMap = new Map((sc.lines || []).map((l) => [l.themeKey, l]));
    let allFourApplicable = true;

    for (const key of CORE_FOUR_THEME_KEYS) {
      const line = lineMap.get(key);
      if (!line?.applicable) {
        allFourApplicable = false;
        continue;
      }
      scoreSum += line.score;
      themeCount += 1;
    }

    if (allFourApplicable) fullCoverageCount += 1;
  }

  return {
    score: themeCount > 0 ? Math.round((scoreSum / themeCount) * 10) / 10 : null,
    themeCount,
    callCount,
    coverage: fullCoverageCount / callCount,
  };
}

/**
 * Mean raw score for one theme across scorecards.
 * callTypeFilter null — average across every type the theme appears in.
 */
export function themeAverage(
  scorecards: ScorecardForSpineComposite[],
  themeKey: string,
  callTypeFilter: CallType | string | null = null,
  opts: AggregateOpts = {},
): ThemeAverageResult {
  const eligible = filterEligibleScorecards(scorecards, opts).filter(
    (sc) => !callTypeFilter || sc.callType === callTypeFilter,
  );

  let scoreSum = 0;
  let count = 0;
  let maxScore = 100;

  for (const sc of eligible) {
    const line = (sc.lines || []).find((l) => l.themeKey === themeKey && l.applicable);
    if (!line) continue;
    scoreSum += line.score;
    count += 1;
    if (line.maxScore > 0) maxScore = line.maxScore;
  }

  return {
    score: count > 0 ? Math.round((scoreSum / count) * 10) / 10 : null,
    count,
    themeKey,
    maxScore,
    callTypeFilter,
  };
}

/** Average dimension performance scaled to 0–10 (e.g. 4.5/5 → 9.0). */
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

  return Math.round((ratioSum / count) * 10 * 10) / 10;
}

/** Map 0–10 overall score to a coaching label (strict MVP calibration). */
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
