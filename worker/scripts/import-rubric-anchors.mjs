#!/usr/bin/env node
/**
 * Import hand-scored rubric anchors into rubricThemes.anchorsJson.
 *
 * Input JSON: one object or an array of:
 *   { themeKey, profileCallType, levels: [{ score: 1..5, description }],
 *     author, approvedBy, approvedAt, notes }
 *
 * Rejects partial level sets and any row without approvedBy.
 *
 * Requires Firebase Admin SDK credentials:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   node worker/scripts/import-rubric-anchors.mjs anchors.json
 *   node worker/scripts/import-rubric-anchors.mjs anchors.json --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { dryRun: false, file: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(
        "Usage: node worker/scripts/import-rubric-anchors.mjs <anchors.json> [--dry-run]",
      );
      process.exit(0);
    } else if (!args.file) {
      args.file = argv[i];
    } else {
      console.error(`Unknown argument: ${argv[i]}`);
      process.exit(1);
    }
  }
  if (!args.file) {
    console.error("Missing anchors JSON file path.");
    process.exit(1);
  }
  return args;
}

async function loadModules() {
  const anchorsPath = path.resolve(__dirname, "../src/rubric-anchors.ts");
  const profilesPath = path.resolve(__dirname, "../src/rubric-profiles.ts");
  const [anchorsMod, profilesMod] = await Promise.all([
    import(anchorsPath),
    import(profilesPath),
  ]);
  return { ...anchorsMod, ...profilesMod };
}

async function loadAdmin() {
  let mod;
  try {
    mod = await import("firebase-admin");
  } catch {
    console.error("Install firebase-admin in worker/ to run this script.");
    process.exit(1);
  }
  if (!mod.apps.length) {
    mod.initializeApp();
  }
  return mod.firestore();
}

function loadInput(filePath) {
  const abs = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    console.error(`File not found: ${abs}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
  return Array.isArray(raw) ? raw : [raw];
}

async function main() {
  const args = parseArgs(process.argv);
  const {
    prepareRubricAnchorsWrite,
    rubricIdFor,
    rubricThemeDocId,
    RUBRIC_VERSION,
  } = await loadModules();

  const rows = loadInput(args.file);
  const db = args.dryRun ? null : await loadAdmin();
  let written = 0;

  for (let i = 0; i < rows.length; i++) {
    let anchorsJson;
    try {
      anchorsJson = prepareRubricAnchorsWrite(rows[i]);
    } catch (err) {
      console.error(`Row ${i + 1}: ${err.message}`);
      process.exit(1);
    }

    const rubricId = rubricIdFor(anchorsJson.profileCallType, RUBRIC_VERSION);
    const themeDocId = rubricThemeDocId(rubricId, anchorsJson.themeKey);
    const payload = {
      rubricId,
      themeKey: anchorsJson.themeKey,
      anchorsJson,
    };

    if (args.dryRun) {
      console.log(`[dry-run] rubricThemes/${themeDocId}`, payload);
    } else {
      await db.collection("rubricThemes").doc(themeDocId).set(payload, { merge: true });
      console.log(`Updated rubricThemes/${themeDocId} (${anchorsJson.themeKey}, approvedBy=${anchorsJson.approvedBy})`);
    }
    written++;
  }

  console.log(
    args.dryRun
      ? `[dry-run] Would import ${written} anchor row(s)`
      : `Imported ${written} anchor row(s)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
