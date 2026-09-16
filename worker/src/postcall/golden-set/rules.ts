/**
 * Distilled calibration rules from human-vs-pipeline gap analysis on the seed
 * golden set (2 hunting demos + 3 expansion calls). These influence EVERY call.
 * The seed calls themselves are not a lookup table.
 *
 * Gap (why AI and humans diverge):
 * - Pass 1 + verifier both say "a typical call lands mostly on 1s". Five 1s →
 *   theme grade 5, which the math treats as adequate. Humans polarize: 0 when
 *   the theme did not happen, 2 when the motion-critical craft is clearly done.
 * - Proof-point themes (value, case_study, comp_pitch, cta) are 0 unless the
 *   thing actually occurred. A courtesy 1 is the most common AI miss.
 * - Hunting demos score execution (questions, CDE, solutioning, AI, objections,
 *   call_flow, engagement) at 2 when it is clearly done — do not sandbag to 1.
 * - Expansion AI-vision does NOT get hunting-style discovery credit.
 * - camera_on is 2 on every human card; the UI currently N/As it for display.
 */

import type { CallType, SeMotion } from "../../rubric-profiles";

export interface GoldenRule {
  id: string;
  /** Empty = all motions. */
  seMotions?: SeMotion[];
  /** Empty = all call types. */
  callTypes?: CallType[];
  /** Skip this rule for these call types (still applies elsewhere). */
  excludeCallTypes?: CallType[];
  text: string;
}

export const GOLDEN_SET_RULES: GoldenRule[] = [
  {
    id: "polarize-not-courtesy-one",
    text:
      "Do not default a theme to five 1s (grade 5). If the theme was not actually done on this call, score every sub-parameter 0 (grade 0). If it was done well, majority 2s (grade 8–10). Use a mix of 1s only when the theme was attempted but thin.",
  },
  {
    id: "absent-proof-points-are-zero",
    excludeCallTypes: ["discovery"],
    text:
      "value / case_study / comp_pitch / cta / summarise: 0 unless the transcript has the thing itself — quantified ROI, a real customer story, a named-competitor take, a dated next step with an owner, a recap of what the customer said. Passing mentions are not a 1.",
  },
  {
    id: "value-requires-numbers",
    excludeCallTypes: ["discovery"],
    text:
      "value is 0 unless hours, tickets, cost, headcount, or a customer KPI was quantified. Adjectives (faster, better, ROI) without a number stay 0. Hunting demos in the golden set scored value 0 on both calls.",
  },
  {
    id: "cta-needs-owner-and-date",
    text:
      "cta is 0 for 'let's stay in touch' / vague follow-up. 1 only if a next step was proposed. 2 only with owner + date + customer confirmation.",
  },
  {
    id: "hunting-execution-earns-twos",
    seMotions: ["new_business"],
    callTypes: ["demo"],
    text:
      "Hunting demo: questions, cde_build, solutioning, ai, objections, call_flow, customer_engagement earn 2 when clearly executed. Do not compress them to 1 because 'typical is 1'. research and storytelling in the golden set sat at 1 (prep was present, not excellent).",
  },
  {
    id: "hunting-slide-deck-all-or-nothing",
    seMotions: ["new_business"],
    callTypes: ["demo"],
    text:
      "Hunting slide_deck is all-or-nothing at the theme bar: 2 when a tailored deck was actually walked, 0 when it was not. Do not land five 1s for 'there were some slides'.",
  },
  {
    id: "expansion-plan-upgrade-partials",
    seMotions: ["expansion"],
    callTypes: ["demo_plan_upgrade"],
    text:
      "Plan-upgrade is a positioning call. ai, solutioning, value, microstory, objections, customer_engagement are often 1 (partial), not hunting-demo 2s. research / cde_build / call_flow / summarise can still be 2 when clearly done. cta stays 0 without a dated expansion ask.",
  },
  {
    id: "ai-vision-discovery-is-zero-unless-done",
    seMotions: ["expansion"],
    callTypes: ["ai_vision_demo"],
    text:
      "AI vision demo: research and questions are 0 unless discovery was actually run. Do not score them up because some account context appeared. ai_solutioning is the 2 when the live AI demo landed; case_study / summarise / cta are 0 unless they happened.",
  },
  {
    id: "camera-on-do-not-nitpick",
    text:
      "camera_on: humans scored 2 whenever the SE was on camera. Do not grind this theme to 1s over lighting or framing. The display layer may still N/A camera_on until Zoom detection ships — score it honestly in the data anyway.",
  },
  {
    id: "discovery-habits-earn-twos",
    callTypes: ["discovery"],
    text:
      "Discovery: questions, pain_qualification, stakeholder_mapping, customer_engagement, summarise earn 2 when clearly done. Do not sandbag them to 1 because 'typical is 1'. research earns 2 when prep is specific and used in the opening.",
  },
  {
    id: "discovery-incidents-na-when-absent",
    callTypes: ["discovery"],
    text:
      "Discovery incident themes objections / comp_pitch / case_study: if that moment never occurred, score all five 0 with no evidence quotes so the system marks them N/A (out of denominator). If the incident DID happen and the SE fumbled, score 0s AND cite the pushback / named competitor / case study with timestamps — that 0 stays in the denominator.",
  },
  {
    id: "discovery-value-is-hypothesis",
    callTypes: ["discovery"],
    text:
      "Discovery value is a hypothesis anchored on THEIR metrics (cost, time, tickets, KPI they named), not a hunting-demo ROI proof with vendor numbers. Score 2 when the SE framed value as a hypothesis using the customer's own numbers. Do not zero value just because there is no ROI slide.",
  },
];

export function rulesFor(seMotion?: SeMotion | string | null, callType?: CallType | string | null): GoldenRule[] {
  const motion = seMotion === "expansion" ? "expansion" : seMotion === "new_business" ? "new_business" : null;
  const type = typeof callType === "string" && callType ? callType : null;
  return GOLDEN_SET_RULES.filter((rule) => {
    if (rule.seMotions?.length && motion && !rule.seMotions.includes(motion)) return false;
    if (rule.callTypes?.length && type && !rule.callTypes.includes(type as CallType)) return false;
    if (rule.excludeCallTypes?.length && type && rule.excludeCallTypes.includes(type as CallType)) return false;
    return true;
  });
}
