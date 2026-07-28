/**
 * Canonical QIP rubric profiles v1.0 — core-four amendment applied.
 * See docs/QIP_PROFILES.md and docs/POST_CALL_SPEC_V2.md §6.
 */

export const RUBRIC_VERSION = "1.0";

/** Shared call-type vocabulary — same key selects the same rubric everywhere. */
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

/** Core-four themes present in every profile (spine composite). */
export const CORE_FOUR_THEME_KEYS = [
  "call_flow",
  "customer_engagement",
  "objections",
  "camera_on",
] as const;

export type CoreFourThemeKey = (typeof CORE_FOUR_THEME_KEYS)[number];

/**
 * Themes that require Pass 2 video. Without a recording stream they are
 * applicable:false — never inferred from transcript (spec §6.5 / QIP §Video).
 */
export const VIDEO_DEPENDENT_THEME_KEYS = [
  "camera_on",
  "cde_build",
  "call_flow",
  "customer_engagement",
] as const;

export type VideoDependentThemeKey = (typeof VIDEO_DEPENDENT_THEME_KEYS)[number];

export const VIDEO_THEME_NA_REASON =
  "No video recording — requires Pass 2 video evidence; not inferred from transcript.";

/** Drop analysis_confidence when scoring without video (scaffolding band). */
export function analysisConfidenceForVideo(videoAvailable: boolean): number {
  return videoAvailable ? 0.85 : 0.55;
}

export interface RubricThemeWeight {
  themeKey: string;
  weight: number;
}

export interface RubricProfileSeed {
  callType: CallType;
  version: string;
  totalPoints: number;
  active: boolean;
  provisional: boolean;
  themes: RubricThemeWeight[];
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

export const RUBRIC_PROFILES: RubricProfileSeed[] = [
  {
    callType: "demo",
    version: RUBRIC_VERSION,
    totalPoints: 100,
    active: true,
    provisional: false,
    themes: [
      { themeKey: "research_agenda", weight: 5 },
      { themeKey: "questions", weight: 5 },
      { themeKey: "slide_deck", weight: 5 },
      { themeKey: "cde_build", weight: 10 },
      { themeKey: "solutioning", weight: 5 },
      { themeKey: "storytelling", weight: 5 },
      { themeKey: "call_flow", weight: 10 },
      { themeKey: "ai", weight: 5 },
      { themeKey: "value", weight: 10 },
      { themeKey: "objections", weight: 5 },
      { themeKey: "case_study_roi", weight: 5 },
      { themeKey: "comp_pitch", weight: 5 },
      { themeKey: "summarise", weight: 5 },
      { themeKey: "camera_on", weight: 5 },
      { themeKey: "customer_engagement", weight: 10 },
      { themeKey: "cta", weight: 5 },
    ],
  },
  {
    callType: "discovery",
    version: RUBRIC_VERSION,
    totalPoints: 100,
    active: true,
    provisional: false,
    themes: [
      { themeKey: "questions", weight: 20 },
      { themeKey: "research_agenda", weight: 10 },
      { themeKey: "incumbent_competition", weight: 10 },
      { themeKey: "pain_qualification", weight: 10 },
      { themeKey: "value", weight: 10 },
      { themeKey: "call_flow", weight: 10 },
      { themeKey: "ai", weight: 5 },
      { themeKey: "objections", weight: 5 },
      { themeKey: "summarise", weight: 5 },
      { themeKey: "camera_on", weight: 5 },
      { themeKey: "customer_engagement", weight: 5 },
      { themeKey: "cta", weight: 5 },
    ],
  },
  {
    callType: "technical_deep_dive",
    version: RUBRIC_VERSION,
    totalPoints: 100,
    active: true,
    provisional: true,
    themes: [
      { themeKey: "technical_accuracy", weight: 20 },
      { themeKey: "solutioning", weight: 15 },
      { themeKey: "cde_build", weight: 15 },
      { themeKey: "architecture_fitment", weight: 10 },
      { themeKey: "questions", weight: 10 },
      { themeKey: "objections", weight: 10 },
      { themeKey: "value", weight: 5 },
      { themeKey: "call_flow", weight: 5 },
      { themeKey: "customer_engagement", weight: 5 },
      { themeKey: "camera_on", weight: 5 },
    ],
  },
  {
    callType: "reverse_demo",
    version: RUBRIC_VERSION,
    totalPoints: 100,
    active: true,
    provisional: true,
    themes: [
      { themeKey: "handover_discipline", weight: 20 },
      { themeKey: "task_design", weight: 15 },
      { themeKey: "coaching_without_taking_over", weight: 15 },
      { themeKey: "setup_framing", weight: 10 },
      { themeKey: "observation_note_capture", weight: 10 },
      { themeKey: "customer_engagement", weight: 10 },
      { themeKey: "objections", weight: 5 },
      { themeKey: "call_flow", weight: 5 },
      { themeKey: "summarise", weight: 5 },
      { themeKey: "camera_on", weight: 5 },
    ],
  },
  {
    callType: "use_case_discussion",
    version: RUBRIC_VERSION,
    totalPoints: 100,
    active: true,
    provisional: true,
    themes: [
      { themeKey: "solutioning", weight: 20 },
      { themeKey: "questions", weight: 15 },
      { themeKey: "value", weight: 15 },
      { themeKey: "research_agenda", weight: 10 },
      { themeKey: "customer_engagement", weight: 10 },
      { themeKey: "storytelling", weight: 5 },
      { themeKey: "ai", weight: 5 },
      { themeKey: "objections", weight: 5 },
      { themeKey: "call_flow", weight: 5 },
      { themeKey: "summarise", weight: 5 },
      { themeKey: "camera_on", weight: 5 },
    ],
  },
  {
    callType: "trial_setup",
    version: RUBRIC_VERSION,
    totalPoints: 100,
    active: true,
    provisional: true,
    themes: [
      { themeKey: "exit_criteria_defined", weight: 20 },
      { themeKey: "success_metrics_agreed", weight: 15 },
      { themeKey: "admin_access_enablement", weight: 10 },
      { themeKey: "stakeholder_mapping", weight: 10 },
      { themeKey: "risk_identification", weight: 10 },
      { themeKey: "customer_engagement", weight: 10 },
      { themeKey: "cadence_checkpoints", weight: 5 },
      { themeKey: "solutioning", weight: 5 },
      { themeKey: "call_flow", weight: 5 },
      { themeKey: "objections", weight: 5 },
      { themeKey: "camera_on", weight: 5 },
    ],
  },
  {
    callType: "troubleshooting",
    version: RUBRIC_VERSION,
    totalPoints: 100,
    active: true,
    provisional: true,
    themes: [
      { themeKey: "problem_diagnosis", weight: 20 },
      { themeKey: "technical_accuracy", weight: 15 },
      { themeKey: "resolution_or_clear_path", weight: 15 },
      { themeKey: "expectation_setting", weight: 10 },
      { themeKey: "customer_reassurance", weight: 10 },
      { themeKey: "escalation_handling", weight: 5 },
      { themeKey: "documentation_followup", weight: 5 },
      { themeKey: "customer_engagement", weight: 5 },
      { themeKey: "objections", weight: 5 },
      { themeKey: "call_flow", weight: 5 },
      { themeKey: "camera_on", weight: 5 },
    ],
  },
  {
    callType: "qa_session",
    version: RUBRIC_VERSION,
    totalPoints: 100,
    active: true,
    provisional: true,
    themes: [
      { themeKey: "question_handling", weight: 25 },
      { themeKey: "technical_accuracy", weight: 20 },
      { themeKey: "objections", weight: 15 },
      { themeKey: "value", weight: 10 },
      { themeKey: "customer_engagement", weight: 10 },
      { themeKey: "call_flow", weight: 10 },
      { themeKey: "summarise", weight: 5 },
      { themeKey: "camera_on", weight: 5 },
    ],
  },
];

/** Validate profile invariants — weights sum to totalPoints and core-four are present. */
export function validateRubricProfiles(profiles = RUBRIC_PROFILES): string[] {
  const errors: string[] = [];
  for (const profile of profiles) {
    const sum = profile.themes.reduce((acc, t) => acc + t.weight, 0);
    if (sum !== profile.totalPoints) {
      errors.push(`${profile.callType}: theme weights sum to ${sum}, expected ${profile.totalPoints}`);
    }
    for (const key of CORE_FOUR_THEME_KEYS) {
      if (!profile.themes.some((t) => t.themeKey === key)) {
        errors.push(`${profile.callType}: missing core-four theme ${key}`);
      }
    }
    const keys = profile.themes.map((t) => t.themeKey);
    if (new Set(keys).size !== keys.length) {
      errors.push(`${profile.callType}: duplicate theme keys`);
    }
  }
  return errors;
}
