/** Deterministic overall score + label from dimension scores (matches worker/src/quality-score.ts). */

/** @typedef {{ themeKey: string, score: number, maxScore: number, applicable: boolean, weight: number }} ScorecardLineForComposite */
/** @typedef {{ callType: string, rubricVersion: string, lines: ScorecardLineForComposite[], provisional?: boolean, confidence?: number|null }} ScorecardForTypeComposite */
/** @typedef {{ score: number|null, applicableWeight: number, totalWeight: number, applicableCount: number, rubricVersion: string, callType: string }} TypeCompositeResult */
/** @typedef {{ themeKey: string, score: number, maxScore: number, applicable: boolean }} ScorecardLineForSpine */
/** @typedef {{ callType?: string, lines: ScorecardLineForSpine[], provisional?: boolean, confidence?: number|null }} ScorecardForSpineComposite */
/** @typedef {{ score: number|null, themeCount: number, callCount: number, coverage: number }} SpineCompositeResult */
/** @typedef {{ score: number|null, count: number, themeKey: string, maxScore: number, callTypeFilter: string|null }} ThemeAverageResult */
/** @typedef {{ requireHighConfidence?: boolean, includeIneligible?: boolean }} AggregateOpts */

const CORE_FOUR_THEME_KEYS = ["call_flow", "customer_engagement", "objections", "camera_on"];

/** Spec §9 — only high-confidence calls feed the coaching queue. */
export const HIGH_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Shadow + confidence gate for averages, coaching queue, spine, and heatmap (§6.6 / §9).
 * @param {{ provisional?: boolean, confidence?: number|null }} scorecard
 * @param {{ minConfidence?: number, requireHighConfidence?: boolean }} [opts]
 */
export function isEligibleForAggregate(scorecard, opts = {}) {
  if (scorecard?.provisional) return false;
  const min =
    opts.minConfidence ??
    (opts.requireHighConfidence ? HIGH_CONFIDENCE_THRESHOLD : undefined);
  if (min != null && (scorecard?.confidence == null || scorecard.confidence < min)) {
    return false;
  }
  return true;
}

/**
 * @param {ScorecardForTypeComposite[]} scorecards
 * @param {AggregateOpts} [opts]
 */
function filterEligibleScorecards(scorecards, opts = {}) {
  if (opts.includeIneligible) return scorecards || [];
  return (scorecards || []).filter((sc) =>
    isEligibleForAggregate(sc, { requireHighConfidence: opts.requireHighConfidence }),
  );
}

/**
 * Weighted composite within one call type.
 * sum(score × weight) over applicable lines ÷ sum(weight) over applicable lines.
 * @param {ScorecardForTypeComposite[]} scorecards
 * @param {string} callType
 * @param {AggregateOpts} [opts]
 * @returns {TypeCompositeResult}
 */
export function typeComposite(scorecards, callType, opts = {}) {
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
      totalWeight += line.weight;
      if (!line.applicable) continue;
      applicableCount += 1;
      applicableWeight += line.weight;
      const max = line.maxScore > 0 ? line.maxScore : 100;
      const normalized = Math.min(1, Math.max(0, line.score / max));
      earnedSum += normalized * line.weight;
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

/** @param {TypeCompositeResult} result */
export function formatTypeComposite(result) {
  const score = result.score ?? 0;
  const denom = result.applicableWeight > 0 ? 100 : 0;
  return `${score} / ${denom} (${result.callType} v${result.rubricVersion})`;
}

/**
 * Cross-type spine composite — unweighted mean over core-four themes only.
 * @param {ScorecardForSpineComposite[]} scorecards
 * @param {AggregateOpts} [opts]
 * @returns {SpineCompositeResult}
 */
export function spineComposite(scorecards, opts = {}) {
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
 * @param {ScorecardForSpineComposite[]} scorecards
 * @param {string} themeKey
 * @param {string|null} [callTypeFilter]
 * @param {AggregateOpts} [opts]
 * @returns {ThemeAverageResult}
 */
export function themeAverage(scorecards, themeKey, callTypeFilter = null, opts = {}) {
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

/** @param {{ score: number, maxScore: number }[]} dimensions */
export function computeOverallScore(dimensions) {
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

/** @param {number} score — 0–10 (strict MVP calibration) */
export function overallLabelFromScore(score) {
  if (score >= 9) return "Excellent";
  if (score >= 7) return "Strong";
  if (score >= 5.5) return "Good";
  if (score >= 4) return "Developing";
  return "Needs focus";
}

/** @param {object} qc */
export function normalizeQualityCoach(qc) {
  if (!qc) {
    return {
      overallScore: 0,
      overallLabel: overallLabelFromScore(0),
      dimensions: [],
      strengths: [],
      improvements: [],
      missedOpportunities: [],
    };
  }
  const dimensions = qc.dimensions || [];
  const computed = computeOverallScore(dimensions);
  const overallScore = computed ?? (typeof qc.overallScore === "number" ? qc.overallScore : 0);
  return {
    ...qc,
    overallScore,
    overallLabel: overallLabelFromScore(overallScore),
  };
}

/** @param {number} overall — 0–10 */
export function scoreBand(overall) {
  if (overall >= 9) return "excellent";
  if (overall >= 7) return "strong";
  if (overall >= 5.5) return "good";
  if (overall >= 4) return "developing";
  return "needsFocus";
}

/** @param {number} score — 0–100 QIP raw / composite scale */
export function qipScoreBand(score) {
  if (score >= 90) return "excellent";
  if (score >= 70) return "strong";
  if (score >= 55) return "good";
  if (score >= 40) return "developing";
  return "needsFocus";
}
