/** Web mirror of worker/scripts/test-quality-score.ts — Appendix C tests. */
import {
  scoreCall,
  computeThemeGrade,
  profileAverage,
  themeAverage,
  isEligibleForAggregate,
  formatProfileAverage,
} from "../quality-score.js";
import { QIP_PROFILES, CATEGORY_KEYS } from "../rubric-profiles.js";

const demo = QIP_PROFILES.find((p) => p.key === "demo");

function allSubParams(value) {
  return demo.themes.map((t) => ({
    themeKey: t.key,
    subParameters: Array.from({ length: 5 }, () => ({ score: value })),
  }));
}

function allThemesGrade8Except(exceptKey) {
  const pattern = [2, 2, 2, 1, 1];
  return demo.themes.map((t) => ({
    themeKey: t.key,
    subParameters:
      t.key === exceptKey
        ? Array.from({ length: 5 }, () => ({ score: 0 }))
        : pattern.map((score) => ({ score })),
  }));
}

const t1 = scoreCall(demo, allSubParams(0));
const checks = [
  ["Test 1 overall", t1.overall === 0],
  ["Test 2 overall", scoreCall(demo, allSubParams(2)).overall === 10],
  ["Test 3 overall", scoreCall(demo, allSubParams(1)).overall === 5],
  [
    "Test 4 credit weighting",
    scoreCall(demo, allThemesGrade8Except("solutioning")).overall <
      scoreCall(demo, allThemesGrade8Except("camera_on")).overall,
  ],
  ["computeThemeGrade", computeThemeGrade([2, 2, 2, 1, 1]) === 8],
  [
    "profileAverage",
    profileAverage([{ callType: "demo", rubricVersion: "2.1", overall: 7, lines: [] }], "demo").score === 7,
  ],
  [
    "formatProfileAverage",
    formatProfileAverage({ score: 7.29, callType: "demo", rubricVersion: "2.1", callCount: 1, includedCredits: 34 }).includes(
      "7.29 / 10",
    ),
  ],
  [
    "themeAverage",
    themeAverage(
      [{ callType: "demo", rubricVersion: "2.1", lines: [{ themeKey: "questions", grade: 8, credit: 3, category: "discovery_qualification" }] }],
      "questions",
    ).score === 8,
  ],
  ["isEligibleForAggregate", isEligibleForAggregate({ provisional: true, confidence: 0.9 }) === false],
  ["Test 6 demo credits", demo.totalCredits === 34],
  [
    "Test 7 sub-parameter count",
    QIP_PROFILES.every((p) => p.themes.every((t) => t.subParameters.length === 5)),
  ],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}
console.log("OK — web quality-score Appendix C tests passed");
