// Deterministic overall score + label from dimension scores (model outputs dimensions only).

import type { PostCallAnalysis } from "./postcall-schema";

type QualityCoach = PostCallAnalysis["qualityCoach"];
type QualityCoachInput = Omit<QualityCoach, "overallScore" | "overallLabel"> & {
  overallScore?: number;
  overallLabel?: string;
};

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
