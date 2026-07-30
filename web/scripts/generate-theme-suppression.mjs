#!/usr/bin/env -S npx tsx
/**
 * Build web/theme-suppression-data.js from the latest worker/consistency-runs/ artifact.
 * Themes with mean score SD > THRESHOLDS.themeScoreSd.needsAnchor (15) are suppressed at display.
 *
 * Usage: npx tsx web/scripts/generate-theme-suppression.mjs
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { aggregateThemeMetrics, THRESHOLDS } from "../../worker/src/consistency-lib.ts";
import { snapshotsFromConsistencyRuns } from "../../worker/scripts/override-lib.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(__dirname, "..");
const CONSISTENCY_DIR = join(WEB_ROOT, "..", "worker", "consistency-runs");
const OUT_PATH = join(WEB_ROOT, "theme-suppression-data.js");

async function listConsistencyRunDirs(consistencyDir = CONSISTENCY_DIR) {
  let entries;
  try {
    entries = await readdir(consistencyDir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === "ENOENT") {
      const msg =
        "worker/consistency-runs/ does not exist. Run worker/scripts/self-consistency.mjs first.";
      if (consistencyDir === CONSISTENCY_DIR) {
        console.error(`FATAL: ${msg}`);
        process.exit(1);
      }
      throw new Error(msg);
    }
    throw err;
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name))
    .sort();
}

function buildManifest(runId, runDir, generatedAt, metrics) {
  const threshold = THRESHOLDS.themeScoreSd.needsAnchor;
  const themes = metrics.map((m) => ({
    themeKey: m.themeKey,
    meanScoreSd: m.meanScoreSd,
    maxScoreSd: m.maxScoreSd,
    suppressed: m.meanScoreSd > threshold,
  }));
  const suppressedThemes = themes.filter((t) => t.suppressed).map((t) => t.themeKey);

  return {
    runId,
    runDir,
    generatedAt,
    threshold,
    suppressedThemes,
    themes,
  };
}

function formatModule(manifest) {
  return `/** Auto-generated — do not edit. Run: npx tsx web/scripts/generate-theme-suppression.mjs */
export const themeSuppressionManifest = ${JSON.stringify(manifest, null, 2)};
`;
}

export async function generateThemeSuppressionData(opts = {}) {
  const consistencyDir = opts.consistencyDir ?? CONSISTENCY_DIR;
  const outPath = opts.outPath ?? OUT_PATH;

  const dirs = await listConsistencyRunDirs(consistencyDir);
  if (!dirs.length) {
    throw new Error(
      "No consistency runs in worker/consistency-runs/. Run worker/scripts/self-consistency.mjs first.",
    );
  }

  const runId = opts.runId ?? dirs.at(-1);
  const runDir = join(consistencyDir, runId);

  let generatedAt = null;
  try {
    const manifest = JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8"));
    generatedAt = manifest.generatedAt ?? null;
  } catch {
    // manifest optional
  }

  let rawResults;
  try {
    rawResults = JSON.parse(await readFile(join(runDir, "runs.json"), "utf8"));
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error(`Consistency run ${runId} has no runs.json — re-run self-consistency.mjs.`);
    }
    throw err;
  }

  const snapshots = snapshotsFromConsistencyRuns(rawResults);
  const callIds = [...new Set(snapshots.map((s) => s.callId))];
  const metrics = snapshots.length ? aggregateThemeMetrics(snapshots, callIds) : [];

  const manifest = buildManifest(
    runId,
    join("..", "worker", "consistency-runs", runId),
    generatedAt,
    metrics,
  );
  await writeFile(outPath, formatModule(manifest), "utf8");
  return manifest;
}

async function main() {
  try {
    const manifest = await generateThemeSuppressionData();
    console.log(
      `Wrote ${OUT_PATH} from ${manifest.runId} — ${manifest.suppressedThemes.length} suppressed theme(s)`,
    );
    if (manifest.suppressedThemes.length) {
      console.log(`  suppressed: ${manifest.suppressedThemes.join(", ")}`);
    }
  } catch (err) {
    console.error(`FATAL: ${err.message || err}`);
    process.exit(1);
  }
}

const invokedDirectly = process.argv.some((arg) =>
  arg.endsWith("generate-theme-suppression.mjs"),
);

if (invokedDirectly) {
  void main();
}
