/**
 * QIP rubric profiles v2.1 — mirrors worker/src/rubric-profiles.ts
 */

import { GENERATED_QIP_PROFILES } from "./rubric-profiles.generated.js";

export const RUBRIC_VERSION = "2.1";

export const CALL_TYPES = [
  "demo",
  "discovery",
  "technical_deep_dive",
  "reverse_demo",
  "use_case_discussion",
  "trial_setup",
  "troubleshooting",
  "qa_session",
];

export const CATEGORY_KEYS = [
  "discovery_qualification",
  "solution_technical_fit",
  "business_value",
  "credibility_objections",
  "communication_control",
];

export const CATEGORY_LABELS = {
  discovery_qualification: "Discovery and qualification",
  solution_technical_fit: "Solution demonstration and technical fit",
  business_value: "Business value and outcome articulation",
  credibility_objections: "Technical credibility and objection handling",
  communication_control: "Communication, engagement and call control",
};

export const VIDEO_THEME_NA_REASON =
  "No video recording — this theme requires visual evidence from the recording and cannot be scored from transcript alone.";

export function videoDependentThemeKeys(profile) {
  return (profile.themes || []).filter((t) => t.requiresVideo).map((t) => t.key);
}

export function analysisConfidenceForVideo(videoAvailable) {
  return videoAvailable ? 0.85 : 0.55;
}

export function rubricIdFor(callType, version = RUBRIC_VERSION) {
  const versionSlug = version.replace(/\./g, "_");
  return `rub_${callType}_${versionSlug}`;
}

export function rubricThemeDocId(rubricId, themeKey) {
  return `${rubricId}__${themeKey}`;
}

export function profileFor(callType) {
  const profile = QIP_PROFILES.find((p) => p.key === callType);
  if (!profile) throw new Error(`Unknown call type: ${callType}`);
  return profile;
}

export const QIP_PROFILES = GENERATED_QIP_PROFILES;

export const VIDEO_DEPENDENT_THEME_KEYS = [
  ...new Set(QIP_PROFILES.flatMap((p) => p.themes.filter((t) => t.requiresVideo).map((t) => t.key))),
];

/** @deprecated v2.1 */
export const CORE_FOUR_THEME_KEYS = ["call_flow", "customer_engagement", "objections", "camera_on"];
export const RUBRIC_PROFILES = QIP_PROFILES;

/** Short radar axis labels (two lines) — cross-type category comparison. */
export const QIP_RADAR_LABELS = {
  discovery_qualification: "Discovery &\nqualification",
  solution_technical_fit: "Solutioning &\ntechnical fit",
  business_value: "Business value &\narticulation",
  credibility_objections: "Objections &\ncredibility",
  communication_control: "Communication &\nengagement",
};

/** Theme keys for manager heatmap — spine uses legacy core four; call types use full profile. */
export function heatmapThemeKeys(filter) {
  if (filter === "spine") return [...CORE_FOUR_THEME_KEYS];
  const profile = QIP_PROFILES.find((p) => p.key === filter);
  if (profile) return profile.themes.map((t) => t.key);
  return [...CORE_FOUR_THEME_KEYS];
}

export function isProvisionalCallType(callType) {
  const profile = QIP_PROFILES.find((p) => p.key === callType);
  return profile?.provisional ?? false;
}

export function validateRubricProfiles(profiles = QIP_PROFILES) {
  const errors = [];
  for (const profile of profiles) {
    const sum = profile.themes.reduce((acc, t) => acc + t.credit, 0);
    if (sum !== profile.totalCredits) {
      errors.push(`${profile.key}: theme credits sum to ${sum}, expected ${profile.totalCredits}`);
    }
    for (const theme of profile.themes) {
      if (theme.subParameters.length !== 5) {
        errors.push(`${profile.key}/${theme.key}: expected 5 sub-parameters`);
      }
    }
    const keys = profile.themes.map((t) => t.key);
    if (new Set(keys).size !== keys.length) {
      errors.push(`${profile.key}: duplicate theme keys`);
    }
  }
  return errors;
}

/** Prefer v2.1 when scorecard shape matches QIP v2.1 even if legacy meta says 1.0. */
export function effectiveRubricVersion(scorecard, analysisMeta = {}) {
  const v = scorecard?.rubricVersion || analysisMeta?.rubricVersion || RUBRIC_VERSION;
  const lines = Array.isArray(scorecard?.lines)
    ? scorecard.lines
    : scorecard?.lines && typeof scorecard.lines === "object"
      ? Object.values(scorecard.lines).filter((l) => l && typeof l === "object")
      : [];
  if (String(v).startsWith("1")) {
    if (lines.some((l) => Array.isArray(l.subParameters) && l.subParameters.length)) {
      return RUBRIC_VERSION;
    }
    if (typeof scorecard?.overall === "number" && scorecard.overall <= 10) return RUBRIC_VERSION;
    if (
      scorecard?.categoryScores &&
      Object.values(scorecard.categoryScores).some((n) => Number(n) > 0)
    ) {
      return RUBRIC_VERSION;
    }
  }
  return v;
}
