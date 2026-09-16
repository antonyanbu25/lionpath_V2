/**
 * Human-scored QIP golden set. Theme scores are the team's 0/1/2 per THEME
 * (not five sub-parameters). These rows are ground truth for THESE calls only.
 *
 * To add more: run `python3 tools/import-qip-golden-xlsx.py <sheet.xlsx>`
 * and append the printed objects here. Hunting = new_business.
 */

import type { CallType, SeMotion } from "../../rubric-profiles";

/** Theme-level human score matching the scoring-sheet "Score" column. */
export type ThemeBand = 0 | 1 | 2;

export interface GoldenExample {
  id: string;
  seName: string;
  /** new_business is hunting. */
  seMotion: SeMotion;
  callType: CallType;
  /** Engage / Kaia / Zoom / Outreach link from the sheet. */
  recordingUrl: string;
  sourceFile: "nb_eu_scoring_sheet" | "expansion_scoring_sheet";
  scoredAt: string;
  /**
   * Theme key → human 0/1/2. Keys must match the product profile for `callType`.
   * Absent keys were not scored on the sheet.
   */
  themeBands: Record<string, ThemeBand>;
  notes?: string;
}

export const GOLDEN_EXAMPLES: GoldenExample[] = [
  {
    id: "shamron-nb-demo",
    seName: "Shamron",
    seMotion: "new_business",
    callType: "demo",
    recordingUrl: "https://engage.freshworks.com/s/4ZBJaa6GQL0",
    sourceFile: "nb_eu_scoring_sheet",
    scoredAt: "2026-09",
    themeBands: {
      research: 1,
      questions: 2,
      cde_build: 2,
      solutioning: 2,
      ai: 2,
      slide_deck: 2,
      value: 0,
      case_study: 0,
      objections: 2,
      comp_pitch: 0,
      call_flow: 2,
      customer_engagement: 2,
      storytelling: 1,
      summarise: 0,
      cta: 1,
      camera_on: 2,
    },
    notes: "Hunting demo. Execution themes mostly 2; value/case_study/comp_pitch/summarise absent (0).",
  },
  {
    id: "nitish-nb-demo",
    seName: "Nitish",
    seMotion: "new_business",
    callType: "demo",
    recordingUrl: "https://engage.freshworks.com/s/h9FGBItS5ZY",
    sourceFile: "nb_eu_scoring_sheet",
    scoredAt: "2026-09",
    themeBands: {
      research: 1,
      questions: 2,
      cde_build: 2,
      solutioning: 2,
      ai: 2,
      slide_deck: 0,
      value: 0,
      case_study: 1,
      objections: 2,
      comp_pitch: 0,
      call_flow: 2,
      customer_engagement: 2,
      storytelling: 1,
      summarise: 2,
      cta: 0,
      camera_on: 2,
    },
    notes: "Hunting demo. Same value=0 / comp_pitch=0 pattern; slide_deck 0; summarise 2; cta 0.",
  },
  {
    id: "pradeep-exp-plan-upgrade",
    seName: "Pradeep",
    seMotion: "expansion",
    callType: "demo_plan_upgrade",
    recordingUrl:
      "https://engage.freshworks.com/kaia/share/JTdCJTIydiUyMiUzQSU3QiUyMnAlMjIlM0ElMjJQd0laVUx1ViUyMiUyQyUyMm0lMjIlM0ElMjIwMjA2NTRiNC0xYzFkLTQzOWQtYTMwZi1mODUxMDI2MzQzZmUlM0FlOWl5c2pFUFQxZWlLekV5M0ZvWHZRJTIyJTJDJTIyaSUyMiUzQSUyMjY4NDMlMjIlN0QlN0Q=",
    sourceFile: "expansion_scoring_sheet",
    scoredAt: "2026-09",
    themeBands: {
      research: 2,
      cde_build: 2,
      solutioning: 1,
      ai: 1,
      slide_deck: 2,
      value: 1,
      microstory: 1,
      objections: 1,
      call_flow: 2,
      customer_engagement: 1,
      summarise: 2,
      cta: 0,
      camera_on: 2,
    },
    notes: "Expansion plan-upgrade. More 1s (partial) on AI/solutioning/value; CTA absent.",
  },
  {
    id: "hussain-exp-ai-vision",
    seName: "Hussain",
    seMotion: "expansion",
    callType: "ai_vision_demo",
    recordingUrl: "https://web.outreach.io/kaia/record/UxL6vaaoS7KKaoi6eB7BRQ",
    sourceFile: "expansion_scoring_sheet",
    scoredAt: "2026-09",
    themeBands: {
      research: 0,
      questions: 0,
      ai_readiness_fit: 1,
      ai_solutioning: 2,
      technical_accuracy: 2,
      cde_build: 1,
      value: 1,
      case_study: 0,
      objections: 1,
      expectation_setting: 1,
      call_flow: 1,
      customer_engagement: 1,
      summarise: 0,
      cta: 0,
      camera_on: 2,
    },
    notes: "AI vision demo. Discovery research/questions 0 — not the job of this call type.",
  },
  {
    id: "akshaya-exp-ai-vision",
    seName: "Akshaya",
    seMotion: "expansion",
    callType: "ai_vision_demo",
    recordingUrl:
      "https://freshworks.zoom.us/rec/play/Hpd8zCIF5cPDNBAw_BLOFz0TijmPbMhlvPQZ-ujLaiyU0lOWxFiU3xBMVKlDzl_G0PUcsLCq-hbp58RW.k3810eeg2Kcrikir",
    sourceFile: "expansion_scoring_sheet",
    scoredAt: "2026-09",
    themeBands: {
      research: 0,
      questions: 0,
      ai_readiness_fit: 1,
      ai_solutioning: 2,
      technical_accuracy: 1,
      cde_build: 1,
      value: 1,
      case_study: 0,
      objections: 1,
      expectation_setting: 1,
      call_flow: 1,
      customer_engagement: 1,
      summarise: 0,
      cta: 0,
      camera_on: 2,
    },
    notes: "Same AI-vision pattern as Hussain; technical_accuracy 1 rather than 2.",
  },
];
