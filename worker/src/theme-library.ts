/**
 * Shared QIP theme vocabulary — definitions, labels, and render sections.
 * See docs/QIP_PROFILES.md §3 and POST_CALL_SPEC_V2 §6.3.
 */

export type ThemeSectionId =
  | "preparation"
  | "discovery"
  | "delivery"
  | "value"
  | "presence"
  | "close"
  | "trial"
  | "support"
  | "reverse";

export interface ThemeDefinition {
  key: string;
  label: string;
  definition: string;
  /** Preferred render section when the theme appears in a profile. */
  section: ThemeSectionId;
  source: "transcript" | "video" | "brief" | "proxy" | "share_track";
}

export const THEME_SECTION_LABELS: Record<ThemeSectionId, string> = {
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

/** Section display order within a scorecard. */
export const THEME_SECTION_ORDER: ThemeSectionId[] = [
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

export const THEME_LIBRARY: Record<string, ThemeDefinition> = {
  research_agenda: {
    key: "research_agenda",
    label: "Research & agenda",
    definition: "Preparation, customer context, structured flow — prefer diff vs pre-call brief",
    section: "preparation",
    source: "brief",
  },
  questions: {
    key: "questions",
    label: "Questions",
    definition: "Quality of discovery questions uncovering needs and pain",
    section: "discovery",
    source: "transcript",
  },
  slide_deck: {
    key: "slide_deck",
    label: "Slide deck",
    definition: "Concise, engaging, aligned to customer priorities — proxies only; low confidence",
    section: "delivery",
    source: "proxy",
  },
  cde_build: {
    key: "cde_build",
    label: "CDE / build",
    definition: "Customer data/environment simulating real scenarios — requires video",
    section: "delivery",
    source: "video",
  },
  solutioning: {
    key: "solutioning",
    label: "Solutioning",
    definition: "Mapping features to specific customer challenges",
    section: "delivery",
    source: "transcript",
  },
  storytelling: {
    key: "storytelling",
    label: "Storytelling",
    definition: "Narrative resonating with the customer journey (persona-led)",
    section: "delivery",
    source: "transcript",
  },
  call_flow: {
    key: "call_flow",
    label: "Call flow",
    definition: "Transitions, time management, logical sequencing — share-track preferred",
    section: "delivery",
    source: "share_track",
  },
  ai: {
    key: "ai",
    label: "AI",
    definition: "AI capability demonstrated and made relevant",
    section: "delivery",
    source: "transcript",
  },
  value: {
    key: "value",
    label: "Value",
    definition: "ROI and tangible benefit articulation",
    section: "value",
    source: "transcript",
  },
  objections: {
    key: "objections",
    label: "Objections",
    definition: "Handling tough questions and pushback",
    section: "value",
    source: "transcript",
  },
  case_study_roi: {
    key: "case_study_roi",
    label: "Case study & ROI",
    definition: "Real success stories with quantifiable results",
    section: "value",
    source: "transcript",
  },
  comp_pitch: {
    key: "comp_pitch",
    label: "Comp pitch",
    definition: "Competitive positioning and differentiation",
    section: "value",
    source: "transcript",
  },
  summarise: {
    key: "summarise",
    label: "Summarise",
    definition: "Recap of key points, next steps, value delivered",
    section: "close",
    source: "transcript",
  },
  camera_on: {
    key: "camera_on",
    label: "Camera on",
    definition: "Professional presence on video — never inferred from transcript",
    section: "presence",
    source: "video",
  },
  customer_engagement: {
    key: "customer_engagement",
    label: "Customer engagement",
    definition: "Rapport, interaction, keeping the session lively",
    section: "presence",
    source: "video",
  },
  cta: {
    key: "cta",
    label: "CTA",
    definition: "Clear next steps that drive momentum",
    section: "close",
    source: "transcript",
  },
  technical_accuracy: {
    key: "technical_accuracy",
    label: "Technical accuracy",
    definition: "Statements about the product are correct and specific",
    section: "delivery",
    source: "transcript",
  },
  architecture_fitment: {
    key: "architecture_fitment",
    label: "Architecture fitment",
    definition: "Mapped their actual stack, not a generic diagram",
    section: "delivery",
    source: "transcript",
  },
  incumbent_competition: {
    key: "incumbent_competition",
    label: "Incumbent & competition",
    definition: "Uncovered the current tool and who else is in play",
    section: "discovery",
    source: "transcript",
  },
  pain_qualification: {
    key: "pain_qualification",
    label: "Pain qualification",
    definition: "Quantified the pain — cost, time, headcount — not just named it",
    section: "discovery",
    source: "transcript",
  },
  handover_discipline: {
    key: "handover_discipline",
    label: "Handover discipline",
    definition: "Gave the customer control and kept it there",
    section: "reverse",
    source: "share_track",
  },
  task_design: {
    key: "task_design",
    label: "Task design",
    definition: "Tasks were realistic, ordered, and achievable in the time",
    section: "reverse",
    source: "transcript",
  },
  coaching_without_taking_over: {
    key: "coaching_without_taking_over",
    label: "Coaching without taking over",
    definition: "Guided without seizing the mouse or finishing sentences",
    section: "reverse",
    source: "share_track",
  },
  setup_framing: {
    key: "setup_framing",
    label: "Setup & framing",
    definition: "Framed the exercise, its purpose, and what success looks like",
    section: "reverse",
    source: "transcript",
  },
  observation_note_capture: {
    key: "observation_note_capture",
    label: "Observation & note capture",
    definition: "Captured what the customer struggled with, not just outcomes",
    section: "reverse",
    source: "transcript",
  },
  exit_criteria_defined: {
    key: "exit_criteria_defined",
    label: "Exit criteria defined",
    definition: 'Measurable, agreed, written down. "Try it out" scores zero',
    section: "trial",
    source: "transcript",
  },
  success_metrics_agreed: {
    key: "success_metrics_agreed",
    label: "Success metrics agreed",
    definition: "Specific metrics with targets and owners",
    section: "trial",
    source: "transcript",
  },
  admin_access_enablement: {
    key: "admin_access_enablement",
    label: "Admin & access enablement",
    definition: "Who gets access, what training, by when",
    section: "trial",
    source: "transcript",
  },
  cadence_checkpoints: {
    key: "cadence_checkpoints",
    label: "Cadence & checkpoints",
    definition: 'Checkpoints scheduled, not "ping me if you need anything"',
    section: "trial",
    source: "transcript",
  },
  stakeholder_mapping: {
    key: "stakeholder_mapping",
    label: "Stakeholder mapping",
    definition: "Who decides, who blocks, who else is affected",
    section: "trial",
    source: "transcript",
  },
  risk_identification: {
    key: "risk_identification",
    label: "Risk identification",
    definition: "Named what could go wrong and who owns it",
    section: "trial",
    source: "transcript",
  },
  problem_diagnosis: {
    key: "problem_diagnosis",
    label: "Problem diagnosis",
    definition: "Established what is actually broken before theorising",
    section: "support",
    source: "transcript",
  },
  resolution_or_clear_path: {
    key: "resolution_or_clear_path",
    label: "Resolution or clear path",
    definition: "Fixed it, or left a plan with an owner and a date",
    section: "support",
    source: "transcript",
  },
  expectation_setting: {
    key: "expectation_setting",
    label: "Expectation setting",
    definition: "Honest timeline. No overpromising to calm the room",
    section: "support",
    source: "transcript",
  },
  customer_reassurance: {
    key: "customer_reassurance",
    label: "Customer reassurance",
    definition: "Managed an unhappy customer's confidence without deflecting",
    section: "support",
    source: "transcript",
  },
  escalation_handling: {
    key: "escalation_handling",
    label: "Escalation handling",
    definition: "Pulled in the right people at the right time",
    section: "support",
    source: "transcript",
  },
  documentation_followup: {
    key: "documentation_followup",
    label: "Documentation & follow-up",
    definition: "What was agreed is written down and sent",
    section: "support",
    source: "transcript",
  },
  question_handling: {
    key: "question_handling",
    label: "Question handling",
    definition: "Answered accurately, at the right depth, without bluffing",
    section: "discovery",
    source: "transcript",
  },
};

export function themeLabel(themeKey: string): string {
  return THEME_LIBRARY[themeKey]?.label || themeKey;
}

export function themeSection(themeKey: string): ThemeSectionId {
  return THEME_LIBRARY[themeKey]?.section || "delivery";
}
