/**
 * Shared QIP theme labels/sections — mirrors worker/src/theme-library.ts for render.
 */

export const THEME_SECTION_LABELS = {
  preparation: "Preparation",
  discovery: "Discovery",
  delivery: "Delivery",
  value: "Value & competition",
  presence: "Presence & engagement",
  close: "Close",
  trial: "Trial setup",
  support: "Support & resolution",
  reverse: "Reverse demo",
};

export const THEME_SECTION_ORDER = [
  "preparation",
  "discovery",
  "delivery",
  "reverse",
  "trial",
  "support",
  "value",
  "presence",
  "close",
];

const THEME_META = {
  research: { label: "Research", section: "preparation" },
  research_agenda: { label: "Research & agenda", section: "preparation" },
  questions: { label: "Questions", section: "discovery" },
  slide_deck: { label: "Slide deck", section: "delivery" },
  cde_build: { label: "CDE / build", section: "delivery" },
  solutioning: { label: "Solutioning", section: "delivery" },
  storytelling: { label: "Storytelling", section: "delivery" },
  call_flow: { label: "Call flow", section: "delivery" },
  ai: { label: "AI", section: "delivery" },
  value: { label: "Value", section: "value" },
  objections: { label: "Objections", section: "value" },
  case_study: { label: "Case study", section: "value" },
  case_study_roi: { label: "Case study & ROI", section: "value" },
  comp_pitch: { label: "Comp pitch", section: "value" },
  summarise: { label: "Summarise", section: "close" },
  camera_on: { label: "Camera on", section: "presence" },
  customer_engagement: { label: "Customer engagement", section: "presence" },
  cta: { label: "CTA", section: "close" },
  technical_accuracy: { label: "Technical accuracy", section: "delivery" },
  architecture_fitment: { label: "Architecture fitment", section: "delivery" },
  incumbent_competition: { label: "Incumbent & competition", section: "discovery" },
  pain_qualification: { label: "Pain qualification", section: "discovery" },
  handover_discipline: { label: "Handover discipline", section: "reverse" },
  task_design: { label: "Task design", section: "reverse" },
  coaching_without_taking_over: { label: "Coaching without taking over", section: "reverse" },
  setup_framing: { label: "Setup & framing", section: "reverse" },
  observation_note_capture: { label: "Observation & note capture", section: "reverse" },
  exit_criteria_defined: { label: "Exit criteria defined", section: "trial" },
  success_metrics_agreed: { label: "Success metrics agreed", section: "trial" },
  admin_access_enablement: { label: "Admin & access enablement", section: "trial" },
  cadence_checkpoints: { label: "Cadence & checkpoints", section: "trial" },
  stakeholder_mapping: { label: "Stakeholder mapping", section: "trial" },
  risk_identification: { label: "Risk identification", section: "trial" },
  problem_diagnosis: { label: "Problem diagnosis", section: "support" },
  resolution_or_clear_path: { label: "Resolution or clear path", section: "support" },
  expectation_setting: { label: "Expectation setting", section: "support" },
  customer_reassurance: { label: "Customer reassurance", section: "support" },
  escalation_handling: { label: "Escalation handling", section: "support" },
  documentation_followup: { label: "Documentation & follow-up", section: "support" },
  question_handling: { label: "Question handling", section: "discovery" },
};

export function themeLabel(themeKey) {
  return THEME_META[themeKey]?.label || themeKey;
}

export function themeSection(themeKey) {
  return THEME_META[themeKey]?.section || "delivery";
}

/** Group scorecard lines by section for render. */
export function groupLinesBySection(lines) {
  const groups = new Map();
  for (const line of lines || []) {
    const section = themeSection(line.themeKey);
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(line);
  }
  return THEME_SECTION_ORDER.filter((id) => groups.has(id)).map((id) => ({
    sectionId: id,
    label: THEME_SECTION_LABELS[id] || id,
    lines: groups.get(id),
  }));
}
