#!/usr/bin/env -S npx tsx
/** Tests for rubric anchor validation, import guardrails, prompt text, and coverage. */

import {
  ANCHOR_SCORES,
  applyUnanchoredConfidenceCap,
  buildStorytellingAnchors,
  computeAnchorCoverageReport,
  formatAnchorBlockForPrompt,
  formatAnchorCoverageReport,
  isThemeAnchored,
  parseRubricAnchors,
  prepareRubricAnchorsWrite,
  UNANCHORED_CONFIDENCE_CAP,
  UNANCHORED_PROMPT_NOTICE,
  validateRubricAnchors,
} from "../src/rubric-anchors.ts";
import { RUBRIC_PROFILES } from "../src/rubric-profiles.ts";

const storytelling = buildStorytellingAnchors("demo");

const checks: [string, boolean][] = [
  ["storytelling template is anchored", isThemeAnchored(storytelling)],
  ["storytelling has approvedBy", !!storytelling.approvedBy],
  ["storytelling has five levels", storytelling.levels.length === 5],
  [
    "parse accepts valid storytelling payload",
    parseRubricAnchors(storytelling).themeKey === "storytelling",
  ],
  [
    "prepareRubricAnchorsWrite accepts valid payload",
    prepareRubricAnchorsWrite(storytelling).approvedBy === storytelling.approvedBy,
  ],
  [
    "reject missing approvedBy",
    validateRubricAnchors({ ...storytelling, approvedBy: "" }, { requireApproval: true }).some((e) =>
      /approvedBy/i.test(e),
    ),
  ],
  [
    "reject partial level set",
    validateRubricAnchors({
      ...storytelling,
      levels: storytelling.levels.slice(0, 3),
    }).some((e) => /partial|exactly 5/i.test(e)),
  ],
  [
    "reject duplicate scores",
    validateRubricAnchors({
      ...storytelling,
      levels: [
        { score: 1, description: "a" },
        { score: 1, description: "b" },
        { score: 3, description: "c" },
        { score: 4, description: "d" },
        { score: 5, description: "e" },
      ],
    }).some((e) => /duplicate|monotonic/i.test(e)),
  ],
  [
    "reject empty description",
    validateRubricAnchors({
      ...storytelling,
      levels: storytelling.levels.map((lv, i) =>
        i === 2 ? { ...lv, description: "  " } : lv,
      ),
    }).some((e) => /description/i.test(e)),
  ],
  [
    "prompt includes anchor text verbatim",
    formatAnchorBlockForPrompt(storytelling).includes("Named personas across all three lenses"),
  ],
  [
    "unanchored prompt is explicit",
    formatAnchorBlockForPrompt(null).includes(UNANCHORED_PROMPT_NOTICE),
  ],
  [
    "unanchored confidence cap is named constant",
    applyUnanchoredConfidenceCap(0.9) === UNANCHORED_CONFIDENCE_CAP,
  ],
  [
    "monotonic scores constant",
    ANCHOR_SCORES.length === 5 && ANCHOR_SCORES[0] === 1 && ANCHOR_SCORES[4] === 5,
  ],
];

let threw = false;
try {
  prepareRubricAnchorsWrite({ ...storytelling, approvedBy: "" });
} catch {
  threw = true;
}
checks.push(["prepareRubricAnchorsWrite throws without approvedBy", threw]);

const report = computeAnchorCoverageReport();
const demo = report.profiles.find((p) => p.callType === "demo")!;
const discovery = report.profiles.find((p) => p.callType === "discovery")!;

checks.push(
  ["coverage report has eight profiles", report.profiles.length === RUBRIC_PROFILES.length],
  ["demo has one anchored theme", demo.anchoredCount === 1 && demo.anchoredThemes.includes("storytelling")],
  ["demo anchored weight is 5%", Math.abs(demo.anchoredWeightPct - 5) < 0.01],
  ["discovery has zero anchored themes", discovery.anchoredCount === 0],
  [
    "coverage text mentions weight",
    formatAnchorCoverageReport(report).includes("weight anchored"),
  ],
  [
    "unique theme keys is 38",
    report.uniqueThemeKeys === 38 && report.uniqueAnchoredThemeKeys === 1,
  ],
);

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("test-rubric-anchors: FAIL");
  for (const [name] of failed) console.error(`  - ${name}`);
  process.exit(1);
}

console.log("test-rubric-anchors: OK");
