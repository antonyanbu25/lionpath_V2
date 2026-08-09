/**
 * Schema-drift regression test — deterministic, no network call needed.
 *
 * Targets docs/BUILD_ALIGNMENT.md §7.3's "five-file rule": a new analysis
 * field must exist in the Gemini schema, the TS interface, the system
 * prompt, normalizePostCallOutput, AND the renderer — miss one and the
 * normalizer silently drops it. Loads a captured (or hand-built placeholder
 * — see the fixture's own _note field) raw model response and re-runs it
 * through the CURRENT normalizer on every CI run, asserting an explicit list
 * of fields survives. A field going missing here means someone changed the
 * schema/prompt without updating the normalizer — exactly the failure mode
 * that reached production undetected before this test existed.
 *
 * Refresh workflow: after an intentional schema/prompt change, run
 * `GEMINI_API_KEY=... npx tsx scripts/capture-schema-snapshots.mjs`, review
 * the fixture diff, and update EXPECTED_TOP_LEVEL_FIELDS below to match the
 * reviewed change.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePostCallOutput } from "../src/word-limits.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PATH = join(ROOT, "testdata", "schema-snapshots", "postcall-scorecard.demo.snapshot.json");

/**
 * Every top-level field a post-call analysis response should still carry
 * after normalization. If you're adding a field to the schema, add it here
 * too — that's the point: this list is the reviewed, intentional contract.
 */
const EXPECTED_TOP_LEVEL_FIELDS = [
  "callHeader",
  "momentum",
  "followUpTable",
  "signals",
  "nextSteps",
  "qualityCoach",
  "artifacts",
  "analysisVersion",
  "rubricVersion",
];

// dealQualification deliberately excluded: removed from POSTCALL_SCHEMA
// 2026-08-09 as vestigial (never populated by this pass's prompt, superseded
// by Pass 4's analysis.qualification — see postcall-schema.ts's comment at
// the removal site). Don't re-add it here without also re-adding it to the
// schema and deciding what should populate it.

function loadFixture() {
  const parsed = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  if (!parsed.raw) {
    throw new Error(`Fixture ${FIXTURE_PATH} has no "raw" field — malformed snapshot.`);
  }
  return parsed;
}

function main() {
  const fixture = loadFixture();
  if (fixture._capturedAt === null) {
    console.log(
      "NOTE: this fixture is a hand-built placeholder, not a live Gemini capture " +
        "(no GEMINI_API_KEY was available when it was created). Run " +
        "`GEMINI_API_KEY=... npx tsx scripts/capture-schema-snapshots.mjs` to replace it " +
        "with a real captured response, then re-run this test.",
    );
  }

  const normalized = normalizePostCallOutput(fixture.raw);
  const actualKeys = new Set(Object.keys(normalized));

  const missing = EXPECTED_TOP_LEVEL_FIELDS.filter((f) => !actualKeys.has(f));
  const present = EXPECTED_TOP_LEVEL_FIELDS.filter((f) => actualKeys.has(f));

  console.log(`Fields present after normalization: ${present.join(", ")}`);

  if (missing.length) {
    console.log("");
    console.log("=== SCHEMA DRIFT DETECTED ===");
    console.log("");
    for (const field of missing) {
      const inFixture = field in fixture.raw;
      console.log(
        `  "${field}" was ${inFixture ? "present in the captured response but is MISSING" : "missing from both the captured response AND"} after normalizePostCallOutput().`,
      );
      console.log(
        `    → check worker/src/word-limits.ts's normalizePostCallOutput() return object — ` +
          `it rebuilds the response field-by-field and silently drops anything not explicitly listed there.`,
      );
    }
    console.log("");
  }

  assert.deepEqual(
    missing,
    [],
    `${missing.length} field(s) were silently dropped by normalizePostCallOutput: ${missing.join(", ")}. ` +
      `See the plain-language explanation printed above.`,
  );

  console.log("\nPASS: all expected fields survive normalization.");
}

main();
