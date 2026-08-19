#!/usr/bin/env -S npx tsx
/**
 * Self-consistency harness for QIP scorecard (Pass 3).
 *
 * Scores each transcript M times through the full production scoring pass and
 * measures repeatability — the minimum bar for shipping uncalibrated AI scores.
 *
 * Usage:
 *   npx tsx scripts/self-consistency.mjs
 *   npx tsx scripts/self-consistency.mjs --runs 5 --limit 10 --fixture demo-strong-retail
 *   npx tsx scripts/self-consistency.mjs --dry-run
 *
 * Requires GEMINI_API_KEY in worker/.dev.vars or environment.
 * Artifacts: worker/consistency-runs/<timestamp>/
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregateThemeMetrics,
  analyzeCallRuns,
  formatConsistencyReport,
  MIN_TRANSCRIPTS_FOR_REPORT,
  snapshotFromScorecardResult,
  THRESHOLDS,
} from "../src/consistency-lib.ts";
import { buildEffectiveTranscriptForScoring } from "../src/postcall/speaker-attribution.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FIXTURES_PATH = join(ROOT, "testdata/consistency/fixtures.json");
const RUNS_DIR = join(ROOT, "consistency-runs");

const DEFAULT_RUNS = 5;
const DEFAULT_LIMIT = 10;

const args = process.argv.slice(2);

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] ?? null : null;
}

const runsPerCall = Number(argValue("--runs") || DEFAULT_RUNS);
const limit = Number(argValue("--limit") || DEFAULT_LIMIT);
const fixtureFilter = argValue("--fixture");
const dryRun = args.includes("--dry-run");

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
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // optional
  }
}

function timestampDir() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Match production worker env — wrangler.toml + gemini.ts defaults (temperature 0.2). */
function productionEnv() {
  return {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    POSTCALL_LLM_PROVIDER:
      process.env.POSTCALL_LLM_PROVIDER || process.env.LLM_PROVIDER || "gemini",
    POSTCALL_MODEL:
      process.env.POSTCALL_MODEL || process.env.MODEL || "gemini-3.1-flash-lite",
    POSTCALL_EFFORT: process.env.POSTCALL_EFFORT || "low",
    EFFORT: process.env.EFFORT || "medium",
    // Intentionally no temperature override — provider default 0.2 for postcall.
  };
}

function formatRunError(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Mirrors worker/src/postcall/generate.ts's buildIdentitiesContext (private there — this
 * harness calls runPostCallScorecard directly rather than the full runPostCallGenerate
 * pipeline, so a fixture's `confirmedIdentities` needs the same server-built, canonical
 * text block that PostCallScorecardInput.identitiesContext expects). Keep in sync with
 * generate.ts if that function's rules change.
 */
function buildIdentitiesContextForFixture(identities) {
  if (!identities) return null;
  const lines = ["Confirmed call identities (authoritative for scoring):"];
  if (identities.seIdentity) lines.push(`- Primary SE: ${identities.seIdentity}`);
  if (identities.secondarySeIdentities?.length) {
    lines.push(`- Secondary SE: ${identities.secondarySeIdentities.join(", ")}`);
  }
  if (identities.aeIdentity) lines.push(`- AE: ${identities.aeIdentity}`);
  if (identities.customerIdentities?.length) {
    lines.push(`- Customer: ${identities.customerIdentities.join(", ")}`);
  }
  if (identities.partnerIdentities?.length) {
    lines.push(`- Partner: ${identities.partnerIdentities.join(", ")}`);
  }
  if (identities.generalManagerIdentities?.length) {
    lines.push(`- General Manager: ${identities.generalManagerIdentities.join(", ")}`);
  }
  if (identities.executiveIdentities?.length) {
    lines.push(`- Executive: ${identities.executiveIdentities.join(", ")}`);
  }
  if (identities.roomAttributions?.length) {
    lines.push(
      "",
      'Meeting-room mic attributions — speech in these spans is credited to the named person ' +
        '(tagged "(via meeting room)" in the transcript below):',
    );
    for (const attribution of identities.roomAttributions) {
      for (const span of attribution.spans || []) {
        const role = span.role ? ` (${span.role})` : "";
        lines.push(
          `- "${attribution.roomLabel}" ${Math.round(span.startS)}s–${Math.round(span.endS)}s → ${span.person}${role}`,
        );
      }
    }
  }
  if (lines.length <= 1) return null;
  return lines.join("\n");
}

/**
 * A fixture's `roomAttributions` (top-level convenience) wins if set; otherwise falls back
 * to `confirmedIdentities.roomAttributions` (the shape a real confirm-page submission sends).
 */
function roomAttributionsForFixture(fx) {
  return fx.roomAttributions ?? fx.confirmedIdentities?.roomAttributions ?? null;
}

/**
 * Threads a fixture's optional identity-aware-scoring (v2.2) fields through the exact same
 * transform generate.ts applies before calling runPostCallScorecard: the transcript is
 * rewritten via buildEffectiveTranscriptForScoring (real production function) when room
 * attributions are present, and identitiesContext/deckContent/roomAttributions are passed
 * straight through to the real scoring pass — never silently dropped.
 */
function scorecardInputForFixture(fx) {
  const roomAttributions = roomAttributionsForFixture(fx);
  const transcript = roomAttributions?.length
    ? buildEffectiveTranscriptForScoring(fx.transcript, roomAttributions)
    : fx.transcript;
  return {
    transcript,
    callType: fx.callType,
    videoAvailable: false,
    deckLink: fx.deckLink ?? null,
    deckContent: fx.deckContent ?? null,
    briefContext: fx.briefContext ?? null,
    identitiesContext: buildIdentitiesContextForFixture(fx.confirmedIdentities),
    roomAttributions,
    companyName: fx.companyName ?? undefined,
    meetingTitle: fx.meetingTitle ?? undefined,
  };
}

async function main() {
  await loadEnv();

  const fixturesRaw = JSON.parse(await readFile(FIXTURES_PATH, "utf8"));
  let fixtures = fixturesRaw;
  if (fixtureFilter) {
    fixtures = fixtures.filter((f) => f.id === fixtureFilter);
  }
  fixtures = fixtures.slice(0, limit);

  if (dryRun) {
    console.log(`Fixtures (${fixtures.length}): ${fixtures.map((f) => f.id).join(", ")}`);
    console.log(`Runs per call: ${runsPerCall}`);
    console.log(`Output dir: ${RUNS_DIR}/<timestamp>/`);
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY required (worker/.dev.vars or env). Use --dry-run to list fixtures.");
    process.exit(1);
  }

  const { runPostCallScorecard } = await import("../src/postcall/scorecard.ts");
  const { RUBRIC_PROFILES } = await import("../src/rubric-profiles.ts");

  const env = productionEnv();
  const outDir = join(RUNS_DIR, timestampDir());
  await mkdir(outDir, { recursive: true });

  console.log(`Self-consistency run → ${outDir}`);
  console.log(`Transcripts: ${fixtures.length} · Runs each: ${runsPerCall}`);
  console.log(
    `Model: ${env.POSTCALL_MODEL} · Effort: ${env.POSTCALL_EFFORT} · Temperature: 0 (post-call provider default)\n`,
  );

  const allRuns = [];
  const rawResults = [];
  const apiErrors = [];
  const succeededTranscriptIds = new Set();
  let runsAttempted = 0;
  let runsSucceeded = 0;
  let runsFailed = 0;

  for (const fx of fixtures) {
    process.stdout.write(`  ${fx.id} (${fx.callType})… `);
    const profile = RUBRIC_PROFILES.find((p) => p.key === fx.callType || p.callType === fx.callType);
    if (!profile) {
      console.log("SKIP unknown call type");
      continue;
    }

    let fixtureHadSuccess = false;
    for (let r = 0; r < runsPerCall; r++) {
      runsAttempted += 1;
      try {
        const result = await runPostCallScorecard(env, scorecardInputForFixture(fx));

        const snap = snapshotFromScorecardResult(
          fx.id,
          fx.callType,
          r,
          result.scorecard,
          profile.version,
        );
        allRuns.push(snap);
        runsSucceeded += 1;
        fixtureHadSuccess = true;

        rawResults.push({
          callId: fx.id,
          callType: fx.callType,
          runIndex: r,
          compositeScore: snap.compositeScore,
          applicableWeight: snap.applicableWeight,
          lines: snap.lines,
          analysisConfidence: result.analysisConfidence,
          provisional: result.provisional,
        });
      } catch (err) {
        const message = formatRunError(err);
        runsFailed += 1;
        apiErrors.push({ callId: fx.id, runIndex: r, error: message });
        console.log(`\n    run ${r} ERROR:\n${message}`);
        rawResults.push({ callId: fx.id, runIndex: r, error: message });
      }
    }

    if (fixtureHadSuccess) succeededTranscriptIds.add(fx.id);
    console.log(fixtureHadSuccess ? "done" : "FAILED (0 successful runs)");
  }

  const transcriptsAttempted = fixtures.length;
  const transcriptsSucceeded = succeededTranscriptIds.size;
  const transcriptsFailed = transcriptsAttempted - transcriptsSucceeded;
  const generatedAt = new Date().toISOString();
  const profileNote = `Profiles: ${[...new Set(fixtures.map((f) => f.callType))].join(", ")} (confirmed call type per fixture)`;
  const temperatureNote =
    "Temperature: **0** (post-call provider default — deterministic scoring and extraction)";

  const callIds = [...new Set(allRuns.map((r) => r.callId))];
  const themeMetrics = aggregateThemeMetrics(allRuns, callIds);
  const callMetrics = callIds.map((id) => analyzeCallRuns(allRuns, id)).filter(Boolean);

  const report = formatConsistencyReport({
    generatedAt,
    runsPerCall,
    transcriptsAttempted,
    transcriptsSucceeded,
    transcriptsFailed,
    runsAttempted,
    runsSucceeded,
    runsFailed,
    profileNote,
    temperatureNote,
    themeMetrics,
    callMetrics,
    errors: apiErrors,
  });

  const manifest = {
    generatedAt,
    runsPerCall,
    transcriptsAttempted,
    transcriptsSucceeded,
    transcriptsFailed,
    runsAttempted,
    runsSucceeded,
    runsFailed,
    fixtures: fixtures.map((f) => ({ id: f.id, callType: f.callType })),
    env: {
      model: env.POSTCALL_MODEL,
      provider: env.POSTCALL_LLM_PROVIDER,
      postcallEffort: env.POSTCALL_EFFORT,
      temperature: "0 (post-call provider default)",
    },
    thresholds: {
      themeScoreSd: { acceptable: 8, needsAnchor: 15 },
      applicabilityFlipRate: 0.1,
      compositeSd: 5,
      minTranscripts: MIN_TRANSCRIPTS_FOR_REPORT,
    },
  };

  await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(outDir, "runs.json"), JSON.stringify(rawResults, null, 2));
  await writeFile(join(outDir, "report.md"), report);

  console.log(`\nReport: ${join(outDir, "report.md")}`);
  console.log(
    `Transcripts: ${transcriptsSucceeded}/${transcriptsAttempted} succeeded · Runs: ${runsSucceeded}/${runsAttempted} succeeded`,
  );

  if (themeMetrics.length) {
    console.log("\n--- Anchor priority (top 8) ---\n");
    for (const t of themeMetrics.slice(0, 8)) {
      console.log(
        `  ${t.themeKey.padEnd(22)} instability=${t.instabilityScore}  meanSD=${t.meanScoreSd}  runs=${t.nSuccessfulRuns}  verdict=${t.nSuccessfulRuns >= 3 ? "scored" : "insufficient_data"}`,
      );
    }
  }

  if (transcriptsSucceeded < MIN_TRANSCRIPTS_FOR_REPORT) {
    console.error(
      `\nINSUFFICIENT DATA: ${transcriptsSucceeded} transcripts scored successfully, ${MIN_TRANSCRIPTS_FOR_REPORT} required.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
