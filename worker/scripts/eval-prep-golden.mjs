#!/usr/bin/env node
/**
 * Golden-set eval for Prep v2 pipeline.
 * Usage: node scripts/eval-prep-golden.mjs [--fixture id] [--stability 3] [--dry-run]
 *
 * Requires GEMINI_API_KEY in worker/.dev.vars or environment.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIXTURES_DIR = join(ROOT, "testdata/prep-golden");

const args = process.argv.slice(2);
const fixtureFilter = args.includes("--fixture") ? args[args.indexOf("--fixture") + 1] : null;
const stabilityRuns = args.includes("--stability") ? Number(args[args.indexOf("--stability") + 1]) : 1;
const dryRun = args.includes("--dry-run");

async function loadEnv() {
  try {
    const raw = await readFile(join(ROOT, ".dev.vars"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {
    // optional
  }
}

function factsWithSource(prep) {
  const sources = new Set((prep.sources || []).map((s) => s.label));
  let count = 0;
  for (const f of prep.facts || []) {
    if (f.sourceLabel && sources.has(f.sourceLabel) && f.value !== "unknown") count++;
  }
  for (const s of prep.signals || []) {
    if (s.sourceLabel && sources.has(s.sourceLabel) && s.value !== "unknown") count++;
  }
  return count;
}

function hallucinationRate(prep) {
  const items = [...(prep.facts || []), ...(prep.signals || [])];
  if (!items.length) return 1;
  const srcMap = new Map((prep.sources || []).map((s) => [s.label, s]));
  let bad = 0;
  for (const item of items) {
    const val = String(item.value || "").toLowerCase();
    if (val === "unknown" || !val) continue;
    const src = srcMap.get(item.sourceLabel);
    if (!src || !src.url || src.url === "unknown") bad++;
  }
  return bad / items.length;
}

function fieldMatchPct(a, b) {
  const keys = ["description", "about", ...(a.facts || []).map((f, i) => `fact:${i}:${f.key}`)];
  let match = 0;
  let total = 0;
  if (a.description && b.description) {
    total++;
    if (a.description === b.description) match++;
  }
  for (let i = 0; i < Math.min((a.facts || []).length, (b.facts || []).length); i++) {
    total++;
    if (a.facts[i]?.value === b.facts[i]?.value) match++;
  }
  return total ? match / total : 0;
}

async function runFixture(env, fixture) {
  const { runPrepResearch, runPrepSynthesize } = await import("../src/prep/index.ts");

  const research = await runPrepResearch(env, fixture.input);
  const synth = await runPrepSynthesize(env, {
    ...fixture.input,
    confirmedFacts: research.facts,
    researchBundle: research.researchBundle,
  });

  const prep = synth.prep;
  const sourced = factsWithSource(prep);
  const halluc = hallucinationRate(prep);
  const minSource = fixture.expectedFacts?.minWithSource ?? 1;
  const accuracy = sourced >= minSource ? 1 : sourced / minSource;

  return { prep, sourced, halluc, accuracy, researchMeta: synth.researchMeta };
}

async function main() {
  await loadEnv();

  if (!process.env.GEMINI_API_KEY && !dryRun) {
    console.error("GEMINI_API_KEY required (worker/.dev.vars or env). Use --dry-run to list fixtures only.");
    process.exit(1);
  }

  const files = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith(".json"));
  const fixtures = [];
  for (const file of files) {
    const fx = JSON.parse(await readFile(join(FIXTURES_DIR, file), "utf8"));
    if (fixtureFilter && fx.id !== fixtureFilter) continue;
    fixtures.push(fx);
  }

  if (dryRun) {
    console.log(`Fixtures (${fixtures.length}):`, fixtures.map((f) => f.id).join(", "));
    return;
  }

  const env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    LLM_PROVIDER: process.env.LLM_PROVIDER || "gemini",
    MODEL: process.env.MODEL,
    RESEARCH_MODEL: process.env.RESEARCH_MODEL,
    SYNTHESIZE_MODEL: process.env.SYNTHESIZE_MODEL,
    EFFORT: process.env.EFFORT || "low",
  };

  console.log(`Running ${fixtures.length} fixture(s), stability=${stabilityRuns}…\n`);

  const results = [];
  for (const fx of fixtures) {
    process.stdout.write(`  ${fx.id}… `);
    try {
      const runs = [];
      for (let i = 0; i < stabilityRuns; i++) {
        runs.push(await runFixture(env, fx));
      }
      const avgAccuracy = runs.reduce((s, r) => s + r.accuracy, 0) / runs.length;
      const avgHalluc = runs.reduce((s, r) => s + r.halluc, 0) / runs.length;
      let stability = 1;
      if (runs.length > 1) {
        stability =
          runs.slice(1).reduce((s, r) => s + fieldMatchPct(runs[0].prep, r.prep), 0) / (runs.length - 1);
      }
      const pass = avgAccuracy >= (fx.minAccuracy ?? 0.5) && avgHalluc <= 0.15;
      results.push({ id: fx.id, avgAccuracy, avgHalluc, stability, pass });
      console.log(pass ? "PASS" : "FAIL", `(acc=${avgAccuracy.toFixed(2)} halluc=${avgHalluc.toFixed(2)} stab=${stability.toFixed(2)})`);
    } catch (err) {
      results.push({ id: fx.id, error: err.message, pass: false });
      console.log("ERROR", err.message);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
