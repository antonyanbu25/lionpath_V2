/**
 * QIP rubric profiles v2.1 — mirrors worker/src/rubric-profiles.ts
 */

import { GENERATED_QIP_PROFILES } from "./rubric-profiles.generated.js";

export const RUBRIC_VERSION = "2.1";

export const SE_MOTIONS = ["new_business", "expansion"];

export const NB_CALL_TYPES = [
  "demo",
  "discovery",
  "technical_deep_dive",
  "reverse_demo",
  "use_case_discussion",
  "trial_setup",
  "troubleshooting",
  "qa_session",
];

export const EXPANSION_CALL_TYPES = [
  "demo_plan_upgrade",
  "demo_cross_sell",
  "discovery",
  "technical_deep_dive",
  "reverse_demo",
  "use_case_discussion",
  "trial_setup",
  "troubleshooting",
  "qa_session",
  "churn_mitigation",
  "ai_vision_demo",
];

export const CALL_TYPES = [
  ...NB_CALL_TYPES,
  "demo_plan_upgrade",
  "demo_cross_sell",
  "churn_mitigation",
  "ai_vision_demo",
];

export function canonicalizeSeMotion(raw) {
  return raw === "expansion" ? "expansion" : "new_business";
}

export function callTypesForMotion(seMotion) {
  return canonicalizeSeMotion(seMotion) === "expansion"
    ? [...EXPANSION_CALL_TYPES]
    : [...NB_CALL_TYPES];
}

/** Map a call type into the catalog for `seMotion` (confirm-gate motion flip). */
export function remapCallTypeForMotion(callType, seMotion) {
  const motion = canonicalizeSeMotion(seMotion);
  const types = callTypesForMotion(motion);
  const raw = String(callType || "").trim();
  if (raw && types.includes(raw)) return raw;
  if (motion === "expansion") {
    if (raw === "demo") return "demo_plan_upgrade";
    return "discovery";
  }
  if (raw === "demo_plan_upgrade" || raw === "demo_cross_sell" || raw === "ai_vision_demo") {
    return "demo";
  }
  if (raw === "churn_mitigation") return "troubleshooting";
  return types.includes(raw) ? raw : "discovery";
}

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

export function rubricIdFor(callType, version = RUBRIC_VERSION, seMotion) {
  const versionSlug = version.replace(/\./g, "_");
  if (canonicalizeSeMotion(seMotion) === "expansion") {
    return `rub_${callType}_expansion_${versionSlug}`;
  }
  return `rub_${callType}_${versionSlug}`;
}

export function rubricThemeDocId(rubricId, themeKey) {
  return `${rubricId}__${themeKey}`;
}

export function profileFor(callType, seMotion) {
  const motion =
    seMotion == null || seMotion === "" ? null : canonicalizeSeMotion(seMotion);
  const matches = QIP_PROFILES.filter((p) => p.key === callType);
  if (motion) {
    const hit = matches.find((p) => p.motion === motion);
    if (hit) return hit;
  }
  if (matches.length === 1) return matches[0];
  const nb = matches.find((p) => p.motion === "new_business");
  if (nb) return nb;
  if (matches[0]) return matches[0];
  throw new Error(`Unknown call type: ${callType}`);
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
export function heatmapThemeKeys(filter, seMotion) {
  if (filter === "spine") return [...CORE_FOUR_THEME_KEYS];
  try {
    const profile = profileFor(filter, seMotion);
    return profile.themes.map((t) => t.key);
  } catch {
    return [...CORE_FOUR_THEME_KEYS];
  }
}

export function isProvisionalCallType(callType, seMotion) {
  try {
    return profileFor(callType, seMotion)?.provisional ?? false;
  } catch {
    return false;
  }
}

export function validateRubricProfiles(profiles = QIP_PROFILES) {
  const errors = [];
  for (const profile of profiles) {
    const sum = profile.themes.reduce((acc, t) => acc + t.credit, 0);
    if (sum !== profile.totalCredits) {
      errors.push(`${profile.motion || "new_business"}:${profile.key}: theme credits sum to ${sum}, expected ${profile.totalCredits}`);
    }
    for (const theme of profile.themes) {
      if (theme.subParameters.length !== 5) {
        errors.push(`${profile.motion || "new_business"}:${profile.key}/${theme.key}: expected 5 sub-parameters`);
      }
    }
    const keys = profile.themes.map((t) => t.key);
    if (new Set(keys).size !== keys.length) {
      errors.push(`${profile.motion || "new_business"}:${profile.key}: duplicate theme keys`);
    }
  }
  const ids = profiles.map((p) => `${p.motion || "new_business"}:${p.key}`);
  if (new Set(ids).size !== ids.length) {
    errors.push("duplicate (motion, key) profiles");
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
