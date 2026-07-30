/**
 * QIP rubric profiles — mirrors worker/src/rubric-profiles.ts for web aggregates.
 */

export const RUBRIC_VERSION = "1.0";

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

/** Core-four themes. spine composite and default heatmap columns. */
export const CORE_FOUR_THEME_KEYS = [
  "call_flow",
  "customer_engagement",
  "objections",
  "camera_on",
];

/** @type {{ callType: string, provisional: boolean, themes: { themeKey: string }[] }[]} */
export const RUBRIC_PROFILES = [
  {
    callType: "demo",
    provisional: false,
    themes: [
      "research_agenda",
      "questions",
      "slide_deck",
      "cde_build",
      "solutioning",
      "storytelling",
      "call_flow",
      "ai",
      "value",
      "objections",
      "case_study_roi",
      "comp_pitch",
      "summarise",
      "camera_on",
      "customer_engagement",
      "cta",
    ].map((themeKey) => ({ themeKey })),
  },
  {
    callType: "discovery",
    provisional: false,
    themes: [
      "questions",
      "research_agenda",
      "incumbent_competition",
      "pain_qualification",
      "value",
      "call_flow",
      "ai",
      "objections",
      "summarise",
      "camera_on",
      "customer_engagement",
      "cta",
    ].map((themeKey) => ({ themeKey })),
  },
  {
    callType: "technical_deep_dive",
    provisional: true,
    themes: [
      "technical_accuracy",
      "solutioning",
      "cde_build",
      "architecture_fitment",
      "questions",
      "objections",
      "value",
      "call_flow",
      "customer_engagement",
      "camera_on",
    ].map((themeKey) => ({ themeKey })),
  },
  {
    callType: "reverse_demo",
    provisional: true,
    themes: [
      "handover_discipline",
      "task_design",
      "coaching_without_taking_over",
      "setup_framing",
      "observation_note_capture",
      "customer_engagement",
      "objections",
      "call_flow",
      "summarise",
      "camera_on",
    ].map((themeKey) => ({ themeKey })),
  },
  {
    callType: "use_case_discussion",
    provisional: true,
    themes: [
      "solutioning",
      "questions",
      "value",
      "research_agenda",
      "customer_engagement",
      "storytelling",
      "ai",
      "objections",
      "call_flow",
      "summarise",
      "camera_on",
    ].map((themeKey) => ({ themeKey })),
  },
  {
    callType: "trial_setup",
    provisional: true,
    themes: [
      "exit_criteria_defined",
      "success_metrics_agreed",
      "admin_access_enablement",
      "stakeholder_mapping",
      "risk_identification",
      "customer_engagement",
      "cadence_checkpoints",
      "solutioning",
      "call_flow",
      "objections",
      "camera_on",
    ].map((themeKey) => ({ themeKey })),
  },
  {
    callType: "troubleshooting",
    provisional: true,
    themes: [
      "problem_diagnosis",
      "technical_accuracy",
      "resolution_or_clear_path",
      "expectation_setting",
      "customer_reassurance",
      "escalation_handling",
      "documentation_followup",
      "customer_engagement",
      "objections",
      "call_flow",
      "camera_on",
    ].map((themeKey) => ({ themeKey })),
  },
  {
    callType: "qa_session",
    provisional: true,
    themes: [
      "question_handling",
      "technical_accuracy",
      "objections",
      "value",
      "customer_engagement",
      "call_flow",
      "summarise",
      "camera_on",
    ].map((themeKey) => ({ themeKey })),
  },
];

export function profileForCallType(callType) {
  return RUBRIC_PROFILES.find((p) => p.callType === callType) || null;
}

export function isProvisionalCallType(callType) {
  return profileForCallType(callType)?.provisional ?? true;
}

/** Theme columns for the heatmap given the active filter (`spine` or a call type). */
export function heatmapThemeKeys(filter) {
  if (!filter || filter === "spine") return [...CORE_FOUR_THEME_KEYS];
  const profile = profileForCallType(filter);
  return profile ? profile.themes.map((t) => t.themeKey) : [...CORE_FOUR_THEME_KEYS];
}
