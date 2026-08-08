#!/usr/bin/env -S npx tsx
/** Live verify: post-call scorecard is repeatable and uses in-memory cache on second run. */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadEnv() {
  try {
    const raw = await readFile(join(ROOT, ".dev.vars"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* optional */
  }
}

async function main() {
  await loadEnv();
  if (!process.env.GEMINI_API_KEY?.trim()) {
    console.error("GEMINI_API_KEY required in worker/.dev.vars");
    process.exit(1);
  }

  const { runPostCallScorecard, clearScorecardResultCache } = await import("../src/postcall/scorecard.ts");

  const env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    POSTCALL_MODEL: process.env.POSTCALL_MODEL || "gemini-3.1-flash-lite",
    POSTCALL_EFFORT: "low",
  };

  const fixtures = JSON.parse(
    await readFile(join(ROOT, "testdata/consistency/fixtures.json"), "utf8"),
  );
  const fx = fixtures.find((f) => f.id === "demo-strong-retail") || fixtures[0];
  const input = {
    transcript: fx.transcript,
    callType: fx.callType,
    videoAvailable: false,
    deckLink: fx.deckLink ?? null,
    briefContext: fx.briefContext ?? null,
    companyName: fx.companyName ?? undefined,
    meetingTitle: fx.meetingTitle ?? undefined,
  };

  console.log(`Fixture: ${fx.id} (${fx.callType}) — scoring twice (expect cache hit on run 2)…`);

  clearScorecardResultCache();
  const run1Start = Date.now();
  const run1 = await runPostCallScorecard(env, input);
  const run1Ms = Date.now() - run1Start;

  const run2Start = Date.now();
  const run2 = await runPostCallScorecard(env, input);
  const run2Ms = Date.now() - run2Start;

  const score1 = run1.scorecard.overall;
  const score2 = run2.scorecard.overall;
  const match = score1 === score2;
  const cacheLikely = run2Ms < Math.max(500, run1Ms * 0.25);

  console.log(`Run 1 overall: ${score1}/10 (${run1Ms}ms)`);
  console.log(`Run 2 overall: ${score2}/10 (${run2Ms}ms)`);
  console.log(`Scores match: ${match ? "YES" : "NO"}`);
  console.log(`Run 2 fast (cache likely): ${cacheLikely ? "YES" : "NO"}`);

  if (!match) {
    console.error("FAIL: scores differ");
    process.exit(1);
  }
  if (!cacheLikely) {
    console.error("FAIL: second run was not fast enough to indicate cache hit");
    process.exit(1);
  }
  console.log("test-postcall-temperature-live: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
