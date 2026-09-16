#!/usr/bin/env -S npx tsx
/**
 * One-time (or re-run-on-demand) live capture for schema-drift fixtures.
 *
 * Reuses the exact live-call path already proven in
 * worker/scripts/verify-postcall-schema.mjs (runPostCallScorecard) and
 * worker/scripts/eval-prep-golden.mjs (runPrepSynthesize), but instead of
 * scoring/grading the response, dumps the RAW Gemini output to disk as a
 * fixture — the input worker/scripts/test-schema-drift.ts replays
 * deterministically on every CI run.
 *
 * Usage:
 *   GEMINI_API_KEY=... npx tsx scripts/capture-schema-snapshots.mjs
 *
 * When to re-run: after any intentional change to the Gemini schema, the
 * system prompt, or the shape of what a pass returns — capture a fresh
 * snapshot, review the diff against the committed fixture, and update
 * test-schema-drift.ts's expected-field list to match the reviewed change.
 * An unreviewed fixture diff is exactly the "five-file rule" drift this test
 * exists to catch (see docs/BUILD_ALIGNMENT.md §7.3) — don't regenerate and
 * commit without reading what changed.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runPostCallScorecard } from "../src/postcall/scorecard.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "testdata", "schema-snapshots");

function loadDevVars() {
  try {
    const raw = readFileSync(join(ROOT, ".dev.vars"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    // optional
  }
}

async function capturePostcallScorecard() {
  const transcript = readFileSync(
    join(ROOT, "testdata", "schema-snapshots", "postcall-scorecard.demo.transcript.txt"),
    "utf8",
  );
  const env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    POSTCALL_LLM_PROVIDER: "gemini",
    POSTCALL_MODEL: "gemini-3.1-flash-lite",
    POSTCALL_EFFORT: "low",
  };
  const result = await runPostCallScorecard(env, {
    transcript,
    callType: "demo",
    videoAvailable: false,
  });
  const outPath = join(OUT_DIR, "postcall-scorecard.demo.snapshot.json");
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        _capturedAt: new Date().toISOString(),
        _capturedBy: "capture-schema-snapshots.mjs",
        _note: "Raw model output before normalizePostCallOutput. Review the diff before committing.",
        raw: result,
      },
      null,
      2,
    ),
  );
  console.log(`Captured → ${outPath}`);
}

async function main() {
  loadDevVars();
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY required (worker/.dev.vars or env) — capture needs a live model call.");
    process.exit(1);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  await capturePostcallScorecard();
  console.log("\nDone. Review the diff, then update the expected-field list in scripts/test-schema-drift.ts if this was an intentional change.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
