/** Appendix C sanity tests + profile math — mirrors web/scripts/test-quality-score.mjs */
import {
  scoreCall,
  computeThemeGrade,
  profileAverage,
  themeAverage,
  isEligibleForAggregate,
  formatProfileAverage,
} from "../src/quality-score.ts";
import { QIP_PROFILES, CATEGORY_KEYS } from "../src/rubric-profiles.ts";

const demo = QIP_PROFILES.find((p) => p.key === "demo")!;

function allSubParams(value: 0 | 1 | 2) {
  return demo.themes.map((t) => ({
    themeKey: t.key,
    subParameters: Array.from({ length: 5 }, () => ({ score: value })),
  }));
}

function allThemesGrade8Except(exceptKey: string) {
  // grade 8 = sub-params summing to 8, e.g. [2,2,2,1,1]
  const pattern: (0 | 1 | 2)[] = [2, 2, 2, 1, 1];
  return demo.themes.map((t) => ({
    themeKey: t.key,
    subParameters:
      t.key === exceptKey
        ? Array.from({ length: 5 }, () => ({ score: 0 as const }))
        : pattern.map((score) => ({ score })),
  }));
}

// Test 1: All zeros
const t1 = scoreCall(demo, allSubParams(0));
const checks: [string, boolean][] = [
  ["Test 1 overall", t1.overall === 0],
  ["Test 1 all categories 0", CATEGORY_KEYS.every((k) => t1.categoryScores[k] === 0)],
  ["Test 1 all theme grades 0", t1.themes.every((t) => t.grade === 0)],
];

// Test 2: All twos (perfect)
const t2 = scoreCall(demo, allSubParams(2));
checks.push(
  ["Test 2 overall", t2.overall === 10],
  ["Test 2 all categories 10", CATEGORY_KEYS.every((k) => t2.categoryScores[k] === 10)],
  ["Test 2 all theme grades 10", t2.themes.every((t) => t.grade === 10)],
);

// Test 3: All ones (baseline)
const t3 = scoreCall(demo, allSubParams(1));
checks.push(
  ["Test 3 overall", t3.overall === 5],
  ["Test 3 all categories 5", CATEGORY_KEYS.every((k) => t3.categoryScores[k] === 5)],
);

// Test 4: Credit weighting — solutioning (credit 3) vs camera_on (credit 1)
const t4a = scoreCall(demo, allThemesGrade8Except("solutioning"));
const t4b = scoreCall(demo, allThemesGrade8Except("camera_on"));
const expected4a = Math.round(((34 * 8 - 24) / 34) * 100) / 100;
const expected4b = Math.round(((34 * 8 - 8) / 34) * 100) / 100;
checks.push(
  ["Test 4a solutioning at 0", t4a.overall === expected4a],
  ["Test 4b camera_on at 0", t4b.overall === expected4b],
  ["Test 4 solutioning costs more", t4a.overall < t4b.overall],
);

// Test 5: Category consistency — overall equals credit-weighted category average
for (const profile of QIP_PROFILES.slice(0, 3)) {
  const inputs = profile.themes.map((t, i) => ({
    themeKey: t.key,
    subParameters: Array.from({ length: 5 }, (_, j) => ({
      score: ((i + j) % 3) as 0 | 1 | 2,
    })),
  }));
  const result = scoreCall(profile, inputs);
  let gpFromCats = 0;
  let creditsFromCats = 0;
  for (const cat of CATEGORY_KEYS) {
    const catThemes = profile.themes.filter((t) => t.category === cat);
    const catCredits = catThemes.reduce((a, t) => a + t.credit, 0);
    if (catCredits > 0) {
      gpFromCats += result.categoryScores[cat] * catCredits;
      creditsFromCats += catCredits;
    }
  }
  const fromCats = creditsFromCats > 0 ? Math.round((gpFromCats / creditsFromCats) * 100) / 100 : 0;
  checks.push([`Test 5 ${profile.key} category consistency`, Math.abs(result.overall - fromCats) < 0.01]);
}

// Test 6: Total credits — validated in test-rubric-profiles; spot-check here
checks.push(["Test 6 demo credits", demo.totalCredits === 34]);

// Test 7: Sub-parameter count — every theme has 5
checks.push([
  "Test 7 sub-parameter count",
  QIP_PROFILES.every((p) => p.themes.every((t) => t.subParameters.length === 5)),
]);

const VOCABULARY_KEYS = new Set([
  "research", "questions", "pain_qualification", "incumbent_competition", "stakeholder_mapping",
  "observation_note_capture", "problem_diagnosis", "solutioning", "cde_build", "ai", "slide_deck",
  "technical_accuracy", "architecture_fitment", "task_design", "setup_framing", "exit_criteria_defined",
  "success_metrics_agreed", "admin_access_enablement", "value", "case_study", "objections", "comp_pitch",
  "question_handling", "expectation_setting", "escalation_handling", "risk_identification",
  "coaching_without_taking_over", "call_flow", "customer_engagement", "storytelling", "summarise", "cta",
  "camera_on", "handover_discipline", "customer_reassurance", "documentation_followup", "cadence_checkpoints",
  "resolution_or_clear_path",
]);

// Test 8: Vocabulary consistency
checks.push([
  "Test 8 vocabulary",
  QIP_PROFILES.every((p) => p.themes.every((t) => VOCABULARY_KEYS.has(t.key))),
]);

// computeThemeGrade unit
checks.push(["computeThemeGrade", computeThemeGrade([2, 2, 2, 1, 1]) === 8]);

// evidence_unavailable exclusion
const tVideo = scoreCall(demo, [
  ...allSubParams(2).map((t) =>
    t.themeKey === "camera_on" ? { ...t, evidenceUnavailable: true, subParameters: [] } : t,
  ),
]);
checks.push(
  ["evidence_unavailable lowers included credits", tVideo.includedCredits === demo.totalCredits - 1],
  ["evidence_unavailable still computes overall", tVideo.overall > 9.5],
);

// Aggregates
checks.push(
  ["profileAverage", profileAverage([{ callType: "demo", rubricVersion: "2.1", overall: 7, lines: [] }], "demo").score === 7],
  ["formatProfileAverage", formatProfileAverage({ score: 7.29, callType: "demo", rubricVersion: "2.1", callCount: 1, includedCredits: 34 }).includes("7.29 / 10")],
  ["themeAverage", themeAverage([{ callType: "demo", rubricVersion: "2.1", lines: [{ themeKey: "questions", grade: 8, credit: 3, category: "discovery_qualification" }] }], "questions").score === 8],
  ["isEligibleForAggregate blocks provisional", isEligibleForAggregate({ provisional: true, confidence: 0.9 }) === false],
);

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}
console.log("OK — Appendix C tests 1-8 + quality-score unit tests passed");
