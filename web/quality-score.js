/** Deterministic overall score + label from dimension scores (matches worker/src/quality-score.ts). */

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
