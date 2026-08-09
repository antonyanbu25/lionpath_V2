/** QIP v2.1 scoring — mirrors worker/src/quality-score.ts */

import { CATEGORY_KEYS, profileFor, CORE_FOUR_THEME_KEYS } from "./rubric-profiles.js";

export const HIGH_CONFIDENCE_THRESHOLD = 0.7;

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

function filterEligibleScorecards(scorecards, opts = {}) {
  if (opts.includeIneligible) return scorecards || [];
  return (scorecards || []).filter((sc) =>
    isEligibleForAggregate(sc, { requireHighConfidence: opts.requireHighConfidence }),
  );
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function emptyCategoryScores() {
  return Object.fromEntries(CATEGORY_KEYS.map((k) => [k, 0]));
}

export function computeThemeGrade(subParameters) {
  const values =
    subParameters?.length && typeof subParameters[0] === "object"
      ? subParameters.map((sp) => sp.score)
      : subParameters || [];
  if (values.length !== 5) return 0;
  return values.reduce((acc, v) => acc + (v ?? 0), 0);
}

export function scoreCall(profile, themeScores) {
  const byKey = new Map((themeScores || []).map((t) => [t.themeKey, t]));
  const themes = [];
  const categoryTotals = {};
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

export function profileAverage(scorecards, callType, opts = {}) {
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
  const profile = profileFor(callType);
  return {
    score: count > 0 ? round2(sum / count) : null,
    callCount: count,
    includedCredits: profile.totalCredits,
    rubricVersion: pool[0].rubricVersion || "2.1",
    callType: callType || pool[0].callType || "",
  };
}

/** Resolves one line's grade on the 0-10 scale — /10 `grade` field, or legacy /100 `score`. */
function lineGrade(sc, themeKey) {
  const line = (sc.lines || []).find(
    (l) => l.themeKey === themeKey && !l.evidenceUnavailable && !l.modelOmitted,
  );
  if (!line) return null;
  return line.grade ?? (line.maxScore === 100 ? (line.score ?? 0) / 10 : line.score ?? 0);
}

export function themeAverage(scorecards, themeKey, callTypeFilter = null, opts = {}) {
  const eligible = filterEligibleScorecards(scorecards, opts).filter(
    (sc) => !callTypeFilter || sc.callType === callTypeFilter,
  );
  let gradeSum = 0;
  let count = 0;
  for (const sc of eligible) {
    const grade = lineGrade(sc, themeKey);
    if (grade == null) continue;
    gradeSum += grade;
    count += 1;
  }
  return {
    score: count > 0 ? round2(gradeSum / count) : null,
    count,
    themeKey,
    callTypeFilter,
  };
}

export function formatProfileAverage(result) {
  const score = result.score ?? 0;
  return `${score} / 10 (${result.callType} v${result.rubricVersion})`;
}

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
  return round2((ratioSum / count) * 10);
}

export function overallLabelFromScore(score) {
  if (score >= 9) return "Excellent";
  if (score >= 7) return "Strong";
  if (score >= 5.5) return "Good";
  if (score >= 4) return "Developing";
  return "Needs focus";
}

export function qipScoreBand(score) {
  if (score >= 9) return "excellent";
  if (score >= 7) return "strong";
  if (score >= 5.5) return "good";
  if (score >= 4) return "developing";
  return "needsFocus";
}

/** Legacy quality-coach band (0–10 scale). */
export function scoreBand(score) {
  return qipScoreBand(score);
}

export function normalizeQualityCoach(qc) {
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

/** @deprecated v2.1 — use profileAverage */
export function typeComposite(scorecards, callType, opts = {}) {
  const mapped = (scorecards || []).map((sc) => ({
    ...sc,
    overall: sc.overall ?? (typeof sc.rawScore === "number" ? sc.rawScore / 10 : undefined),
    lines: (sc.lines || []).map((l) => ({
      themeKey: l.themeKey,
      grade: l.grade ?? (l.maxScore === 100 ? (l.score ?? 0) / 10 : l.score ?? 0),
      credit: l.credit ?? l.weight ?? 1,
      category: l.category ?? "discovery_qualification",
      evidenceUnavailable: l.evidenceUnavailable ?? !l.applicable,
    })),
  }));
  const result = profileAverage(mapped, callType, opts);
  return {
    score: result.score,
    applicableWeight: result.includedCredits,
    totalWeight: result.includedCredits,
    applicableCount: result.callCount,
    rubricVersion: result.rubricVersion,
    callType: result.callType,
  };
}

/**
 * "Shared spine" composite — call_flow / customer_engagement / objections / camera_on,
 * the four themes every call type scores (§ coaching-spine-note: "not your overall
 * grade"). Unlike profileAverage/typeComposite this deliberately spans every call
 * type, so it's the one number comparable across a whole history regardless of mix.
 * Per call: average of whichever of the four core themes that call has data for.
 * Overall: average of those per-call spine scores across all eligible calls.
 */
export function spineComposite(scorecards, opts = {}) {
  const pool = filterEligibleScorecards(scorecards, opts);
  const themesWithData = new Set();
  let scoreSum = 0;
  let scoredCallCount = 0;

  for (const sc of pool) {
    let sum = 0;
    let count = 0;
    for (const key of CORE_FOUR_THEME_KEYS) {
      const grade = lineGrade(sc, key);
      if (grade == null) continue;
      themesWithData.add(key);
      sum += grade;
      count += 1;
    }
    if (count > 0) {
      scoreSum += sum / count;
      scoredCallCount += 1;
    }
  }

  return {
    score: scoredCallCount > 0 ? round2(scoreSum / scoredCallCount) : null,
    themeCount: themesWithData.size,
    callCount: scoredCallCount,
    coverage: pool.length > 0 ? round2(scoredCallCount / pool.length) : 0,
  };
}

/** @deprecated v2.1 — use formatProfileAverage */
export function formatTypeComposite(result) {
  return formatProfileAverage({
    score: result.score,
    callType: result.callType,
    rubricVersion: result.rubricVersion,
  });
}

/** Mirrors worker/src/video/facts.ts — room panel + camera_on CQS share one source. */
export function curveHasCameraData(curve) {
  if (!Array.isArray(curve)) return false;
  return curve.some(
    (p) =>
      p?.cameraOn === true ||
      p?.cameraOn === false ||
      (p?.cameraOnPct != null && Number.isFinite(Number(p.cameraOnPct))),
  );
}

export function aggregateCameraOnPct(topLevel, curve, seIdentity) {
  if (topLevel != null && Number.isFinite(Number(topLevel))) {
    return Math.max(0, Math.min(100, Math.round(Number(topLevel))));
  }
  if (!Array.isArray(curve) || !curve.length) return null;

  const seKey = seIdentity?.trim().toLowerCase();
  const seRow =
    (seKey && curve.find((p) => String(p?.name || "").trim().toLowerCase() === seKey)) ||
    curve.find((p) => String(p?.role || "").trim().toLowerCase() === "se");

  if (seRow?.cameraOnPct != null && Number.isFinite(Number(seRow.cameraOnPct))) {
    return Math.max(0, Math.min(100, Math.round(Number(seRow.cameraOnPct))));
  }

  const pcts = curve
    .map((p) => p?.cameraOnPct)
    .filter((v) => v != null && Number.isFinite(Number(v)))
    .map((v) => Math.max(0, Math.min(100, Math.round(Number(v)))));
  if (pcts.length) {
    return Math.round(pcts.reduce((sum, v) => sum + v, 0) / pcts.length);
  }

  const known = curve.filter((p) => p?.cameraOn === true || p?.cameraOn === false);
  if (!known.length) return null;
  const onCount = known.filter((p) => p?.cameraOn === true).length;
  return Math.round((onCount / known.length) * 100);
}
