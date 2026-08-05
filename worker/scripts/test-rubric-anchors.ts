#!/usr/bin/env -S npx tsx
/** v2.1 — rubric anchors retired; verify stubs and guardrails remain import-safe. */

import {
  ANCHORS_RETIRED,
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

function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const coverage = computeAnchorCoverageReport();

const checks: [string, boolean][] = [
  ["ANCHORS_RETIRED flag", ANCHORS_RETIRED === true],
  ["buildStorytellingAnchors throws", throws(() => buildStorytellingAnchors("demo"))],
  ["parseRubricAnchors throws", throws(() => parseRubricAnchors({}))],
  ["prepareRubricAnchorsWrite throws", throws(() => prepareRubricAnchorsWrite())],
  ["isThemeAnchored always false", !isThemeAnchored(null)],
  ["applyUnanchoredConfidenceCap passthrough", applyUnanchoredConfidenceCap(0.9) === 0.9],
  ["UNANCHORED_CONFIDENCE_CAP unchanged", UNANCHORED_CONFIDENCE_CAP === 0.55],
  ["UNANCHORED_PROMPT_NOTICE mentions v2.1", UNANCHORED_PROMPT_NOTICE.includes("v2.1")],
  ["validateRubricAnchors returns retirement message", validateRubricAnchors({}).some((e) => /retired/i.test(e))],
  ["formatAnchorBlockForPrompt empty", formatAnchorBlockForPrompt(null) === ""],
  ["formatAnchorCoverageReport mentions retirement", /retired/i.test(formatAnchorCoverageReport())],
  ["computeAnchorCoverageReport zeroed", coverage.anchored === 0 && coverage.total === 0],
  ["ANCHOR_SCORES still 1–5", ANCHOR_SCORES.length === 5 && ANCHOR_SCORES[0] === 1],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("test-rubric-anchors: FAIL");
  for (const [name] of failed) console.error(`  - ${name}`);
  process.exit(1);
}

console.log("test-rubric-anchors: OK (v2.1 retirement stubs)");
