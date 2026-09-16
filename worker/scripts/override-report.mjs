#!/usr/bin/env -S npx tsx
/**
 * Score override calibration report (QIP_PROFILES §5 / Phase 5 input).
 *
 * Reads score_overrides + scorecard_lines (+ arr_overrides) from a Firestore export
 * or live Admin SDK, cross-references the latest 4.1′ consistency run, and writes markdown.
 *
 * Usage:
 *   npx tsx scripts/override-report.mjs --export ./firestore-export.json
 *   npx tsx scripts/override-report.mjs --firestore
 *   npx tsx scripts/override-report.mjs --export ./export.json --consistency-run ../consistency-runs/2026-07-24T10-57-43-275Z
 *   npx tsx scripts/override-report.mjs --dry-run --export ./export.json
 *
 * Output: worker/override-reports/<timestamp>/report.md (+ manifest.json)
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  aggregateThemeMetrics,
  buildOverrideReportData,
  formatOverrideReport,
  snapshotsFromConsistencyRuns,
} from "./override-lib.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REPORTS_DIR = join(ROOT, "override-reports");
const CONSISTENCY_DIR = join(ROOT, "consistency-runs");

const args = process.argv.slice(2);

function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] ?? null : null;
}

const exportPath = argValue("--export");
const consistencyRunArg = argValue("--consistency-run");
const useFirestore = args.includes("--firestore");
const dryRun = args.includes("--dry-run");

function timestampDir() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function loadAdmin() {
  let mod;
  try {
    mod = await import("firebase-admin");
  } catch {
    console.error("Install firebase-admin in worker/ for --firestore.");
    process.exit(1);
  }
  if (!mod.apps.length) mod.initializeApp();
  return mod.firestore();
}

async function readCollection(db, name, limit = 50000) {
  const snap = await db.collection(name).limit(limit).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadFromFirestore() {
  const db = await loadAdmin();
  const [scoreOverrides, scorecardLines, arrOverrides, users] = await Promise.all([
    readCollection(db, "scoreOverrides"),
    readCollection(db, "scorecardLines"),
    readCollection(db, "arrOverrides"),
    readCollection(db, "users"),
  ]);
  return { scoreOverrides, scorecardLines, arrOverrides, users };
}

async function loadFromExport(path) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  return {
    scoreOverrides: raw.scoreOverrides || [],
    scorecardLines: raw.scorecardLines || [],
    arrOverrides: raw.arrOverrides || [],
    users: raw.users || [],
  };
}

async function listConsistencyRunDirs() {
  try {
    const names = await readdir(CONSISTENCY_DIR);
    return names
      .filter((n) => !n.startsWith("."))
      .sort()
      .map((n) => join(CONSISTENCY_DIR, n));
  } catch {
    return [];
  }
}

async function loadLatestConsistencyRun(explicitPath) {
  const runDir = explicitPath
    ? explicitPath.startsWith("/")
      ? explicitPath
      : join(process.cwd(), explicitPath)
    : (await listConsistencyRunDirs()).at(-1) ?? null;

  if (!runDir) return { runId: null, generatedAt: null, metrics: [] };

  const runId = runDir.split(/[/\\]/).pop();
  let generatedAt = null;
  let metrics = [];

  try {
    const manifest = JSON.parse(await readFile(join(runDir, "manifest.json"), "utf8"));
    generatedAt = manifest.generatedAt ?? null;
  } catch {
    // optional
  }

  try {
    const rawResults = JSON.parse(await readFile(join(runDir, "runs.json"), "utf8"));
    const snapshots = snapshotsFromConsistencyRuns(rawResults);
    if (snapshots.length) {
      const callIds = [...new Set(snapshots.map((s) => s.callId))];
      metrics = aggregateThemeMetrics(snapshots, callIds);
    }
  } catch {
    // no runs.json or empty run
  }

  return { runId, generatedAt, metrics, runDir };
}

function normalizeExport(data) {
  return {
    scoreOverrides: (data.scoreOverrides || []).map((o) => ({
      id: o.id,
      scorecardLineId: o.scorecardLineId,
      scorecardId: o.scorecardId,
      callId: o.callId,
      original: Number(o.original),
      override: Number(o.override),
      userId: o.userId,
      reason: String(o.reason || ""),
      createdAt: Number(o.createdAt) || 0,
    })),
    scorecardLines: (data.scorecardLines || []).map((l) => ({
      id: l.id,
      themeKey: l.themeKey,
      applicable: Boolean(l.applicable),
      ownerId: l.ownerId,
    })),
    arrOverrides: data.arrOverrides || [],
    users: (data.users || []).map((u) => ({
      id: u.id,
      email: u.email ?? null,
      displayName: u.displayName ?? null,
    })),
  };
}

async function main() {
  if (!exportPath && !useFirestore) {
    console.error(
      "Provide --export <json> or --firestore. Export shape: { scoreOverrides, scorecardLines, arrOverrides, users }",
    );
    process.exit(1);
  }

  const raw = useFirestore ? await loadFromFirestore() : await loadFromExport(exportPath);
  const input = normalizeExport(raw);
  const consistency = await loadLatestConsistencyRun(consistencyRunArg);

  const reportData = buildOverrideReportData(input, {
    consistencyMetrics: consistency.metrics,
    consistencyRunId: consistency.runId,
    consistencyRunGeneratedAt: consistency.generatedAt,
  });

  const markdown = formatOverrideReport(reportData);
  const outDir = join(REPORTS_DIR, timestampDir());

  if (dryRun) {
    console.log(markdown);
    console.error(`\n(dry-run — would write to ${outDir}/)`);
    return;
  }

  await mkdir(outDir, { recursive: true });
  const manifest = {
    generatedAt: reportData.generatedAt,
    scoreOverrideCount: reportData.scoreOverrideCount,
    arrOverrideCount: reportData.arrOverrideCount,
    scoredLineCount: reportData.scoredLineCount,
    consistencyRunId: reportData.consistencyRunId,
    consistencyRunGeneratedAt: reportData.consistencyRunGeneratedAt,
    source: useFirestore ? "firestore" : exportPath,
    anchorPriority: reportData.crossRef
      .filter((r) => r.fixKind === "anchor_priority")
      .map((r) => r.themeKey),
    promptOffset: reportData.crossRef
      .filter((r) => r.fixKind === "prompt_offset")
      .map((r) => r.themeKey),
  };

  await writeFile(join(outDir, "report.md"), markdown);
  await writeFile(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`Report: ${join(outDir, "report.md")}`);
  console.log(
    `Overrides: ${reportData.scoreOverrideCount} score · ${reportData.arrOverrideCount} ARR · ${reportData.scoredLineCount} scored lines`,
  );
  if (consistency.runDir) {
    console.log(`4.1′ cross-ref: ${consistency.runId} (${consistency.metrics.length} themes)`);
  } else {
    console.log("4.1′ cross-ref: no consistency run found — run self-consistency.mjs first");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
