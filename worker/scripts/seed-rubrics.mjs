#!/usr/bin/env node
/**
 * Seed QIP rubrics and rubricThemes (v1.0, core-four amendment).
 *
 * Requires Firebase Admin SDK credentials:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   node worker/scripts/seed-rubrics.mjs
 *   node worker/scripts/seed-rubrics.mjs --dry-run
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadModules() {
  const profilesPath = path.resolve(__dirname, "../src/rubric-profiles.ts");
  const anchorsPath = path.resolve(__dirname, "../src/rubric-anchors.ts");
  const [profilesMod, anchorsMod] = await Promise.all([
    import(profilesPath),
    import(anchorsPath),
  ]);
  return { ...profilesMod, ...anchorsMod };
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage: node worker/scripts/seed-rubrics.mjs [--dry-run]`);
      process.exit(0);
    }
  }
  return args;
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

async function main() {
  const args = parseArgs(process.argv);
  const {
    RUBRIC_PROFILES,
    rubricIdFor,
    rubricThemeDocId,
    anchorsJsonForTheme,
    validateRubricProfiles,
  } = await loadModules();

  const errors = validateRubricProfiles(RUBRIC_PROFILES);
  if (errors.length) {
    console.error("Rubric profile validation failed:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const now = Date.now();
  let rubricCount = 0;
  let themeCount = 0;
  const db = args.dryRun ? null : await loadAdmin();

  for (const profile of RUBRIC_PROFILES) {
    const id = rubricIdFor(profile.callType, profile.version);
    const rubricDoc = {
      id,
      callType: profile.callType,
      version: profile.version,
      totalPoints: profile.totalPoints,
      active: profile.active,
      provisional: profile.provisional,
      createdAt: now,
      updatedAt: now,
    };

    if (args.dryRun) {
      console.log(`[dry-run] rubrics/${id}`, rubricDoc);
    } else {
      await db.collection("rubrics").doc(id).set(rubricDoc, { merge: true });
    }
    rubricCount++;

    for (const theme of profile.themes) {
      const themeDocId = rubricThemeDocId(id, theme.themeKey);
      const themeDoc = {
        rubricId: id,
        themeKey: theme.themeKey,
        weight: theme.weight,
        anchorsJson: anchorsJsonForTheme(theme.themeKey, profile.callType),
      };

      if (args.dryRun) {
        console.log(`[dry-run] rubricThemes/${themeDocId}`, themeDoc);
      } else {
        await db.collection("rubricThemes").doc(themeDocId).set(themeDoc, { merge: true });
      }
      themeCount++;
    }
  }

  console.log(
    args.dryRun
      ? `[dry-run] Would seed ${rubricCount} rubrics and ${themeCount} rubricThemes`
      : `Seeded ${rubricCount} rubrics and ${themeCount} rubricThemes`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
