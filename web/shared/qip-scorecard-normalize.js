/**
 * Shared QIP scorecard normalization — consumed by web/postcall.js and worker scorecard pass.
 * modelOmitted / evidenceUnavailable lines are excluded from averages, heatmap, insights, and star.
 */
import { profileFor, effectiveRubricVersion } from "../rubric-profiles.js";
import { scoreCall } from "../quality-score.js";
import { canonicalCallType } from "../call-type-labels.js";

/** Firestore / legacy blobs sometimes store lines as `{ "0": {...}, "1": {...} }`. */
export function coerceScorecardLines(lines) {
  if (!lines) return [];
  if (Array.isArray(lines)) return lines;
  if (typeof lines === "object") {
    const numericKeys = Object.keys(lines)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    if (numericKeys.length) {
      return numericKeys.map((k) => lines[k]).filter((row) => row && typeof row === "object");
    }
    return Object.values(lines).filter((row) => row && typeof row === "object" && !Array.isArray(row));
  }
  return [];
}

/** Coerce sub-parameter rows stored as object maps. */
export function coerceSubParameters(subParameters) {
  if (!subParameters) return [];
  if (Array.isArray(subParameters)) return subParameters;
  if (typeof subParameters === "object") {
    const numericKeys = Object.keys(subParameters)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b));
    if (numericKeys.length) {
      return numericKeys.map((k) => subParameters[k]).filter((row) => row && typeof row === "object");
    }
  }
  return [];
}

export const MODEL_OMITTED_THEME_REASON =
  "Model omitted this theme from the scorecard response — not scored.";
export const MODEL_OMITTED_CONFIDENCE = 0.25;

export const RESEARCH_NOT_EVIDENCED_REASON =
  "No pre-call research or account context referenced on this call.";

export const TRANSCRIPT_THEME_NOT_EVIDENCED_REASON =
  "Not enough evidence to score this theme from the transcript and materials on file.";

/** User-facing coaching note when a transcript-scorable theme has no evidence on the call. */
export function themeNotEvidencedReason(themeKey) {
  if (themeKey === "research") return RESEARCH_NOT_EVIDENCED_REASON;
  return TRANSCRIPT_THEME_NOT_EVIDENCED_REASON;
}

/** @param {object|null|undefined} line */
export function isThemeExcludedFromAggregate(line) {
  if (!line) return true;
  if (line.evidenceUnavailable) return true;
  if (line.modelOmitted) return true;
  if (line.applicable === false) return true;
  return false;
}

/** @param {{ key: string, category: string, credit: number, requiresVideo?: boolean }} theme */
export function createModelOmittedLine(theme) {
  if (theme.requiresVideo) {
    return {
      themeKey: theme.key,
      category: theme.category,
      credit: theme.credit,
      grade: null,
      subParameters: Array.from({ length: 5 }, () => ({ score: 0, evidence: [] })),
      evidenceUnavailable: true,
      modelOmitted: true,
      confidence: MODEL_OMITTED_CONFIDENCE,
      coachingNote: MODEL_OMITTED_THEME_REASON,
    };
  }
  return {
    themeKey: theme.key,
    category: theme.category,
    credit: theme.credit,
    grade: 0,
    subParameters: Array.from({ length: 5 }, () => ({ score: 0, evidence: [] })),
    evidenceUnavailable: false,
    modelOmitted: false,
    confidence: 0.35,
    coachingNote: themeNotEvidencedReason(theme.key),
  };
}

/**
 * Fill missing profile themes as model-omitted placeholders (excluded from aggregates).
 * @param {object[]} lines
 * @param {{ themes?: object[] }|null} profile
 */
export function ensureProfileThemeLines(lines, profile) {
  if (!profile?.themes?.length) return lines || [];
  const byKey = new Map((lines || []).map((l) => [l.themeKey, l]));
  const merged = [...(lines || [])];
  for (const theme of profile.themes) {
    if (byKey.has(theme.key)) continue;
    merged.push(createModelOmittedLine(theme));
  }
  return merged;
}

/** @param {object} line */
export function lineGradeForDisplay(line) {
  if (isThemeExcludedFromAggregate(line)) return null;
  if (typeof line.grade === "number") return line.grade;
  if (typeof line.score === "number" && line.maxScore === 100) {
    return Math.round((line.score / 100) * 10 * 10) / 10;
  }
  if (typeof line.score === "number") return line.score;
  return 0;
}

/** @param {object} line */
export function legacySubParametersFromLine(line) {
  const grade = lineGradeForDisplay(line) ?? 0;
  const target = Math.max(0, Math.min(10, Math.round(grade)));
  const base = Math.floor(target / 5);
  const extra = target % 5;
  return Array.from({ length: 5 }, (_, i) => ({
    score: Math.min(2, base + (i < extra ? 1 : 0)),
    evidence: i === 0 && line.evidence?.length ? line.evidence : [],
  }));
}

/**
 * Normalize scorecard for display and downstream aggregates.
 * @param {object} scorecard
 * @param {object} [analysisMeta]
 */
export function stableScorecardLineId(callId, themeKey) {
  if (!callId || !themeKey) return null;
  const safeCall = String(callId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `scl_${safeCall}_${themeKey}`;
}

/**
 * Apply manager score overrides to line grades (heatmap / aggregates).
 * @param {object} scorecard
 * @param {object[]} overrides
 */
export function applyScoreOverridesToScorecard(scorecard, overrides = []) {
  if (!scorecard?.lines?.length || !overrides?.length) return scorecard;
  const byLineId = new Map(overrides.map((o) => [o.scorecardLineId, o]));
  const lines = scorecard.lines.map((line) => {
    const hit =
      (line.id && byLineId.get(line.id)) ||
      overrides.find((o) => o.callId === scorecard.callId && o.themeKey === line.themeKey);
    if (!hit) return line;
    return { ...line, grade: hit.override, overrideApplied: true };
  });
  return { ...scorecard, lines };
}

export function normalizeQipScorecard(scorecard, analysisMeta = {}) {
  const callType = canonicalCallType(scorecard.callType || analysisMeta.callType || "demo");
  let lines = coerceScorecardLines(scorecard.lines);
  let overall = scorecard.overall;
  let categoryScores = scorecard.categoryScores;

  try {
    const profile = profileFor(callType);
    lines = ensureProfileThemeLines(lines, profile);
  } catch {
    /* profile unavailable */
  }

  if (overall == null || !categoryScores) {
    try {
      const profile = profileFor(callType);
      const themeScores = lines.map((line) => ({
        themeKey: line.themeKey,
        subParameters: (() => {
          const coerced = coerceSubParameters(line.subParameters);
          return coerced.length ? coerced : legacySubParametersFromLine(line);
        })(),
        evidenceUnavailable: isThemeExcludedFromAggregate(line),
        modelOmitted: !!line.modelOmitted,
      }));
      const scored = scoreCall(profile, themeScores);
      overall = overall ?? scored.overall;
      categoryScores = categoryScores ?? scored.categoryScores;
    } catch {
      overall = overall ?? null;
      categoryScores = categoryScores ?? {};
    }
  }

  return {
    callType,
    rubricVersion: effectiveRubricVersion(scorecard, analysisMeta),
    provisional: !!(scorecard.provisional ?? analysisMeta.provisional),
    confidence: scorecard.confidence ?? analysisMeta.analysisConfidence,
    overall,
    categoryScores: categoryScores || {},
    callId: scorecard.callId || analysisMeta.callId || null,
    // v2.2 leadership cap — additive passthrough, see worker/src/postcall/scorecard.ts
    // ScorecardDraft.leadershipShareable / verifierJustifications and applyLeadershipCap()
    // in ../quality-score.js.
    leadershipShareable: !!scorecard.leadershipShareable,
    verifierJustifications: scorecard.verifierJustifications || [],
    lines: lines.map((line) => ({
      ...line,
      id: line.id || stableScorecardLineId(scorecard.callId || analysisMeta.callId, line.themeKey),
    })),
  };
}
