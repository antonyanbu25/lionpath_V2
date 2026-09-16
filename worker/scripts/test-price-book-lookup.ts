#!/usr/bin/env -S npx tsx
/** Price book seed + effective-dated lookup tests. */

import {
  ADDON_PRICE_BOOK_SEED,
  ASSUMPTIONS_BOOK_SEED,
  PRICE_BOOK_SEED,
  validatePriceBookSeed,
} from "../src/price-book-seed.ts";
import {
  lookupAddonPriceBookRow,
  lookupAssumption,
  lookupPriceBookRow,
} from "../src/price-book/lookup.ts";

function fail(msg: string): never {
  console.error(`test-price-book-lookup: FAIL — ${msg}`);
  process.exit(1);
}

const seedErrors = validatePriceBookSeed();
if (seedErrors.length) {
  console.error("test-price-book-lookup: FAIL — seed validation");
  for (const e of seedErrors) console.error(`  ${e}`);
  process.exit(1);
}

const AS_OF = "2026-07-24";
const BEFORE = "2026-07-23";

// Pioneer Metering sanity check — PRICE_BOOK_SEED.md §5
const omniGrowth = lookupPriceBookRow(
  PRICE_BOOK_SEED,
  {
    product: "freshdesk_omni",
    tier: "growth",
    currency: "USD",
    term: "annual",
  },
  AS_OF
);
if (!omniGrowth.found || omniGrowth.quoteOnly || omniGrowth.price !== 29) {
  fail("freshdesk_omni growth should be $29/agent/month");
}
const pioneerArr = 28 * omniGrowth.price * 12;
if (pioneerArr !== 9744) {
  fail(`Pioneer example expected 9744 ARR, got ${pioneerArr}`);
}

// Lookup before effectiveFrom returns nothing
const beforeEffective = lookupPriceBookRow(
  PRICE_BOOK_SEED,
  {
    product: "freshdesk_omni",
    tier: "growth",
    currency: "USD",
    term: "annual",
  },
  BEFORE
);
if (beforeEffective.found) {
  fail("lookup dated before effectiveFrom must not return the current row");
}

// Freshservice Enterprise — quote-only, never Pro fallback
const fsEnt = lookupPriceBookRow(
  PRICE_BOOK_SEED,
  {
    product: "freshservice",
    tier: "enterprise",
    currency: "USD",
    term: "annual",
  },
  AS_OF
);
if (!fsEnt.found || !fsEnt.quoteOnly) {
  fail("freshservice enterprise must return explicit quote-only result");
}
if (fsEnt.row.price !== null) {
  fail("quote-only row must have price null, not zero");
}

const fsEntViaPro = lookupPriceBookRow(
  PRICE_BOOK_SEED,
  {
    product: "freshservice",
    tier: "enterprise",
    currency: "USD",
    term: "annual",
  },
  AS_OF
);
const fsPro = lookupPriceBookRow(
  PRICE_BOOK_SEED,
  {
    product: "freshservice",
    tier: "pro",
    currency: "USD",
    term: "annual",
  },
  AS_OF
);
if (
  fsEntViaPro.found &&
  fsPro.found &&
  !fsEntViaPro.quoteOnly &&
  fsPro.found &&
  !fsPro.quoteOnly
) {
  // enterprise lookup must not return pro row — already tested above; also ensure distinct tiers
  if (fsEntViaPro.row.id === fsPro.row.id) {
    fail("enterprise lookup must not fall back to pro tier row");
  }
}

// Freshservice asset units — quote-only add-on
const assetUnits = lookupAddonPriceBookRow(
  ADDON_PRICE_BOOK_SEED,
  {
    addon: "asset_units",
    product: "freshservice",
    tier: "pro",
    currency: "USD",
    term: "annual",
  },
  AS_OF
);
if (!assetUnits.found || !assetUnits.quoteOnly) {
  fail("freshservice asset_units must return explicit quote-only add-on result");
}
if (assetUnits.row.price !== null) {
  fail("asset_units quote-only row must have price null");
}

// Assumptions seed
const sessionRate = lookupAssumption(
  ASSUMPTIONS_BOOK_SEED,
  "ai_session_rate",
  "global",
  null,
  AS_OF
);
if (!sessionRate || sessionRate.value !== 0.5) {
  fail("ai_session_rate global assumption missing or wrong value");
}
const peakRatio = lookupAssumption(
  ASSUMPTIONS_BOOK_SEED,
  "peak_to_average_ratio",
  "global",
  null,
  AS_OF
);
if (!peakRatio || peakRatio.value !== 1.0) {
  fail("peak_to_average_ratio global assumption missing or wrong value");
}

console.log(
  "test-price-book-lookup: OK — 13+10+2 seed rows, effective dating, quote-only, Pioneer $9,744"
);
