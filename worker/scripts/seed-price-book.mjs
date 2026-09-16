#!/usr/bin/env node
/**
 * Seed priceBooks, addonPriceBooks, and assumptionsBooks (2026-07-24-usd-list).
 *
 * Requires Firebase Admin SDK credentials:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   node worker/scripts/seed-price-book.mjs
 *   node worker/scripts/seed-price-book.mjs --dry-run
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadSeedModule() {
  return import(path.resolve(__dirname, "../src/price-book-seed.ts"));
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage: node worker/scripts/seed-price-book.mjs [--dry-run]`);
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
    PRICE_BOOK_SEED,
    ADDON_PRICE_BOOK_SEED,
    ASSUMPTIONS_BOOK_SEED,
    PRICE_BOOK_VERSION,
    validatePriceBookSeed,
  } = await loadSeedModule();

  const errors = validatePriceBookSeed();
  if (errors.length) {
    console.error("Price book seed validation failed:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const db = args.dryRun ? null : await loadAdmin();
  let priceCount = 0;
  let addonCount = 0;
  let assumptionCount = 0;

  for (const row of PRICE_BOOK_SEED) {
    if (args.dryRun) {
      console.log(`[dry-run] priceBooks/${row.id}`, row);
    } else {
      await db.collection("priceBooks").doc(row.id).set(row, { merge: true });
    }
    priceCount++;
  }

  for (const row of ADDON_PRICE_BOOK_SEED) {
    if (args.dryRun) {
      console.log(`[dry-run] addonPriceBooks/${row.id}`, row);
    } else {
      await db.collection("addonPriceBooks").doc(row.id).set(row, { merge: true });
    }
    addonCount++;
  }

  for (const row of ASSUMPTIONS_BOOK_SEED) {
    if (args.dryRun) {
      console.log(`[dry-run] assumptionsBooks/${row.id}`, row);
    } else {
      await db.collection("assumptionsBooks").doc(row.id).set(row, { merge: true });
    }
    assumptionCount++;
  }

  console.log(
    args.dryRun
      ? `[dry-run] Would seed ${priceCount} priceBooks, ${addonCount} addonPriceBooks, ${assumptionCount} assumptionsBooks (${PRICE_BOOK_VERSION})`
      : `Seeded ${priceCount} priceBooks, ${addonCount} addonPriceBooks, ${assumptionCount} assumptionsBooks (${PRICE_BOOK_VERSION})`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
