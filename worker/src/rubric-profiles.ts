/**
 * QIP rubric profiles v2.1 — credits + sub-parameters per theme.
 * Source: docs/QIP_SCORING_V2_1.md (generated via worker/scripts/generate-rubric-profiles.mjs)
 */

import { GENERATED_QIP_PROFILES } from "./rubric-profiles.generated";

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
] as const;

export type CallType = (typeof CALL_TYPES)[number];

export const CATEGORY_KEYS = [
  "discovery_qualification",
  "solution_technical_fit",
  "business_value",
  "credibility_objections",
  "communication_control",
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  discovery_qualification: "Discovery and qualification",
  solution_technical_fit: "Solution demonstration and technical fit",
  business_value: "Business value and outcome articulation",
  credibility_objections: "Technical credibility and objection handling",
  communication_control: "Communication, engagement and call control",
};

export type SubParameterTuple = [string, string, string, string, string];

export interface QipTheme {
  key: string;
  credit: 1 | 2 | 3;
  category: CategoryKey;
  requiresVideo?: boolean;
  subParameters: SubParameterTuple;
}

export interface QipProfile {
  key: CallType;
  name: string;
  version: "2.1";
  totalCredits: number;
  /** Shadow mode — scores store but stay out of aggregates until calibrated. */
  provisional: boolean;
  active: boolean;
  themes: QipTheme[];
}

export const VIDEO_THEME_NA_REASON =
  "No video recording — this theme requires visual evidence from the recording and cannot be scored from transcript alone.";

/** Themes in a profile that require video evidence. */
export function videoDependentThemeKeys(profile: QipProfile): string[] {
  return profile.themes.filter((t) => t.requiresVideo).map((t) => t.key);
}

/** Drop analysis_confidence when scoring without video (scaffolding band). */
export function analysisConfidenceForVideo(videoAvailable: boolean): number {
  return videoAvailable ? 0.85 : 0.55;
}

/** Stable rubric id: rub_{callType}_{versionSlug} */
export function rubricIdFor(callType: CallType, version = RUBRIC_VERSION): string {
  const versionSlug = version.replace(/\./g, "_");
  return `rub_${callType}_${versionSlug}`;
}

/** Firestore doc id for a theme row: {rubricId}__{themeKey} */
export function rubricThemeDocId(rubricId: string, themeKey: string): string {
  return `${rubricId}__${themeKey}`;
}

export function profileFor(callType: CallType): QipProfile {
  const profile = QIP_PROFILES.find((p) => p.key === callType);
  if (!profile) {
    throw Object.assign(new Error(`Unknown call type: ${callType}`), { status: 400 });
  }
  return profile;
}

export const QIP_PROFILES = GENERATED_QIP_PROFILES as QipProfile[];

/** All theme keys requiring video across every profile. */
export const VIDEO_DEPENDENT_THEME_KEYS = [
  ...new Set(QIP_PROFILES.flatMap((p) => p.themes.filter((t) => t.requiresVideo).map((t) => t.key))),
] as const;

/** @deprecated v2.1 — core-four removed; categories replace cross-type spine. */
export const CORE_FOUR_THEME_KEYS = ["call_flow", "customer_engagement", "objections", "camera_on"] as const;

/** @deprecated v2.1 — use QIP_PROFILES */
export const RUBRIC_PROFILES = QIP_PROFILES;

/** Validate profile invariants — credit totals and uniqueness. */
export function validateRubricProfiles(profiles: QipProfile[] = QIP_PROFILES): string[] {
  const errors: string[] = [];
  for (const profile of profiles) {
    const sum = profile.themes.reduce((acc, t) => acc + t.credit, 0);
    if (sum !== profile.totalCredits) {
      errors.push(`${profile.key}: theme credits sum to ${sum}, expected ${profile.totalCredits}`);
    }
    for (const theme of profile.themes) {
      if (theme.subParameters.length !== 5) {
        errors.push(`${profile.key}/${theme.key}: expected 5 sub-parameters`);
      }
      if (!CATEGORY_KEYS.includes(theme.category)) {
        errors.push(`${profile.key}/${theme.key}: unknown category ${theme.category}`);
      }
    }
    const keys = profile.themes.map((t) => t.key);
    if (new Set(keys).size !== keys.length) {
      errors.push(`${profile.key}: duplicate theme keys`);
    }
  }
  return errors;
}
