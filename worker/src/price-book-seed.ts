/**
 * Canonical USD list price book seed — docs/PRICE_BOOK_SEED.md §4.
 * Version 2026-07-24-usd-list. Assumptions from docs/ADDON_ARR_VOLUME.md §3.
 */

import type {
  AddonPriceBookRow,
  AssumptionsBookRow,
  PriceBookRow,
} from "./domain-model/price-book.ts";

export const PRICE_BOOK_VERSION = "2026-07-24-usd-list";

const EFFECTIVE_FROM = "2026-07-24";

export function priceBookIdFor(
  product: string,
  tier: string,
  currency: string,
  term: string,
  effectiveFrom = EFFECTIVE_FROM
): string {
  return `pb_${product}_${tier}_${currency}_${term}_${effectiveFrom}`;
}

export function addonPriceBookIdFor(
  addon: string,
  appliesTo: string[],
  requiresTier: string[],
  currency: string,
  term: string,
  effectiveFrom = EFFECTIVE_FROM
): string {
  const products = appliesTo.join("-") || "any";
  const tiers = requiresTier.length ? requiresTier.join("-") : "any";
  return `apb_${addon}_${products}_${tiers}_${currency}_${term}_${effectiveFrom}`;
}

export function assumptionsBookIdFor(
  key: string,
  scope: string,
  version: string,
  scopeValue: string | null = null
): string {
  const scopePart = scopeValue ? `_${scopeValue}` : `_${scope}`;
  const versionSlug = version.replace(/\./g, "-");
  return `asb_${key}${scopePart}_${versionSlug}`;
}

type PriceBookSeedInput = Omit<PriceBookRow, "id" | "quoteOnly"> & {
  quoteOnly?: boolean;
};

type AddonSeedInput = Omit<
  AddonPriceBookRow,
  "id" | "quoteOnly" | "includedUnits" | "includedScope" | "note"
> & {
  quoteOnly?: boolean;
  includedUnits?: number;
  includedScope?: string | null;
  note?: string | null;
};

function withPriceBookId(row: PriceBookSeedInput): PriceBookRow {
  return {
    ...row,
    id: priceBookIdFor(row.product, row.tier, row.currency, row.term, row.effectiveFrom),
    quoteOnly: row.quoteOnly ?? row.price === null,
  };
}

function withAddonId(row: AddonSeedInput): AddonPriceBookRow {
  return {
    ...row,
    id: addonPriceBookIdFor(
      row.addon,
      row.appliesTo,
      row.requiresTier,
      row.currency,
      row.term,
      row.effectiveFrom
    ),
    includedUnits: row.includedUnits ?? 0,
    includedScope: row.includedScope ?? null,
    note: row.note ?? null,
    quoteOnly: row.quoteOnly ?? row.price === null,
  };
}

/** 13 base plan rows — PRICE_BOOK_SEED.md §4 verbatim. */
export const PRICE_BOOK_SEED: PriceBookRow[] = [
  withPriceBookId({
    product: "freshdesk",
    tier: "growth",
    currency: "USD",
    term: "annual",
    unit: "agent_month",
    price: 19,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    source: "freshworks.com/freshdesk/pricing",
  }),
  withPriceBookId({
    product: "freshdesk",
    tier: "pro",
    currency: "USD",
    term: "annual",
    unit: "agent_month",
    price: 55,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    source: "freshworks.com/freshdesk/pricing",
  }),
  withPriceBookId({
    product: "freshdesk",
    tier: "enterprise",
    currency: "USD",
    term: "annual",
    unit: "agent_month",
    price: 89,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    source: "freshworks.com/freshdesk/pricing",
  }),
  withPriceBookId({
    product: "freshdesk_omni",
    tier: "growth",
    currency: "USD",
    term: "annual",
    unit: "agent_month",
    price: 29,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    source: "freshworks.com/freshdesk/omni/pricing",
  }),
  withPriceBookId({
    product: "freshdesk_omni",
    tier: "pro",
    currency: "USD",
    term: "annual",
    unit: "agent_month",
    price: 79,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    source: "freshworks.com/freshdesk/omni/pricing",
  }),
  withPriceBookId({
    product: "freshdesk_omni",
    tier: "enterprise",
    currency: "USD",
    term: "annual",
    unit: "agent_month",
    price: 119,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    source: "freshworks.com/freshdesk/omni/pricing",
  }),
  withPriceBookId({
    product: "freshservice",
    tier: "starter",
    currency: "USD",
    term: "annual",
    unit: "agent_month",
    price: 19,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    source: "freshworks.com/freshservice/pricing",
  }),
  withPriceBookId({
    product: "freshservice",
    tier: "growth",
    currency: "USD",
    term: "annual",
    unit: "agent_month",
    price: 49,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    source: "freshworks.com/freshservice/pricing",
  }),
  withPriceBookId({
    product: "freshservice",
    tier: "pro",
    currency: "USD",
    term: "annual",
    unit: "agent_month",
    price: 99,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    source: "freshworks.com/freshservice/pricing",
  }),
  withPriceBookId({
    product: "freshservice",
    tier: "enterprise",
    currency: "USD",
    term: "annual",
    unit: "agent_month",
    price: null,
    quoteOnly: true,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    source: "freshworks.com/freshservice/pricing",
  }),
  withPriceBookId({
    product: "freshsales",
    tier: "growth",
    currency: "USD",
    term: "annual",
    unit: "user_month",
    price: 9,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    source: "freshworks.com/crm/pricing",
  }),
  withPriceBookId({
    product: "freshsales",
    tier: "pro",
    currency: "USD",
    term: "annual",
    unit: "user_month",
    price: 39,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    source: "freshworks.com/crm/pricing",
  }),
  withPriceBookId({
    product: "freshsales",
    tier: "enterprise",
    currency: "USD",
    term: "annual",
    unit: "user_month",
    price: 59,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    source: "freshworks.com/crm/pricing",
  }),
];

/** 10 add-on rows — PRICE_BOOK_SEED.md §4 verbatim. */
export const ADDON_PRICE_BOOK_SEED: AddonPriceBookRow[] = [
  withAddonId({
    addon: "freddy_ai_copilot",
    appliesTo: ["freshdesk", "freshdesk_omni", "freshservice", "freshsales"],
    requiresTier: ["pro", "enterprise"],
    unit: "agent_month",
    price: 29,
    includedUnits: 0,
    includedScope: null,
    currency: "USD",
    term: "annual",
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  }),
  withAddonId({
    addon: "freddy_ai_agent_sessions",
    appliesTo: ["freshdesk", "freshdesk_omni"],
    requiresTier: [],
    unit: "per_100_sessions",
    price: 49,
    includedUnits: 500,
    includedScope: "once_per_account",
    currency: "USD",
    term: "annual",
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  }),
  withAddonId({
    addon: "connector_app_tasks",
    appliesTo: ["freshdesk", "freshdesk_omni"],
    requiresTier: [],
    unit: "per_5000_tasks",
    price: 80,
    includedUnits: 0,
    includedScope: null,
    currency: "USD",
    term: "annual",
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  }),
  withAddonId({
    addon: "day_pass",
    appliesTo: ["freshdesk"],
    requiresTier: ["growth"],
    unit: "per_pass",
    price: 2,
    currency: "USD",
    term: "annual",
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  }),
  withAddonId({
    addon: "day_pass",
    appliesTo: ["freshdesk"],
    requiresTier: ["pro"],
    unit: "per_pass",
    price: 7,
    currency: "USD",
    term: "annual",
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  }),
  withAddonId({
    addon: "day_pass",
    appliesTo: ["freshdesk"],
    requiresTier: ["enterprise"],
    unit: "per_pass",
    price: 12,
    currency: "USD",
    term: "annual",
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  }),
  withAddonId({
    addon: "day_pass",
    appliesTo: ["freshdesk_omni"],
    requiresTier: ["growth"],
    unit: "per_pass",
    price: 5,
    currency: "USD",
    term: "annual",
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  }),
  withAddonId({
    addon: "day_pass",
    appliesTo: ["freshdesk_omni"],
    requiresTier: ["pro"],
    unit: "per_pass",
    price: 10,
    currency: "USD",
    term: "annual",
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  }),
  withAddonId({
    addon: "day_pass",
    appliesTo: ["freshdesk_omni"],
    requiresTier: ["enterprise"],
    unit: "per_pass",
    price: 15,
    currency: "USD",
    term: "annual",
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  }),
  withAddonId({
    addon: "asset_units",
    appliesTo: ["freshservice"],
    requiresTier: [],
    unit: "per_500_units",
    price: null,
    quoteOnly: true,
    note: "ITAM licensing metric, packs of 500 — price not published",
    currency: "USD",
    term: "annual",
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  }),
];

/** ADDON_ARR_VOLUME.md §3 seed rows. */
export const ASSUMPTIONS_BOOK_SEED: AssumptionsBookRow[] = [
  {
    id: assumptionsBookIdFor("ai_session_rate", "global", PRICE_BOOK_VERSION),
    key: "ai_session_rate",
    scope: "global",
    scopeValue: null,
    value: 0.5,
    source: "internal_estimate",
    rationale: "Half of conversation volume assumed to reach the AI agent",
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    version: PRICE_BOOK_VERSION,
  },
  {
    id: assumptionsBookIdFor("peak_to_average_ratio", "global", PRICE_BOOK_VERSION),
    key: "peak_to_average_ratio",
    scope: "global",
    scopeValue: null,
    value: 1.0,
    source: "internal_estimate",
    rationale: "No automatic adjustment — stated peaks are flagged, never scaled",
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
    version: PRICE_BOOK_VERSION,
  },
];

export function validatePriceBookSeed(): string[] {
  const errors: string[] = [];
  if (PRICE_BOOK_SEED.length !== 13) {
    errors.push(`expected 13 price_book rows, got ${PRICE_BOOK_SEED.length}`);
  }
  if (ADDON_PRICE_BOOK_SEED.length !== 10) {
    errors.push(`expected 10 addon_price_book rows, got ${ADDON_PRICE_BOOK_SEED.length}`);
  }
  if (ASSUMPTIONS_BOOK_SEED.length !== 2) {
    errors.push(`expected 2 assumptions_book rows, got ${ASSUMPTIONS_BOOK_SEED.length}`);
  }
  const priceIds = new Set<string>();
  for (const row of PRICE_BOOK_SEED) {
    if (priceIds.has(row.id)) errors.push(`duplicate price_book id ${row.id}`);
    priceIds.add(row.id);
    if (row.quoteOnly && row.price !== null) {
      errors.push(`${row.id}: quoteOnly row must have price null`);
    }
    if (!row.quoteOnly && row.price === null) {
      errors.push(`${row.id}: priced row must have numeric price`);
    }
  }
  const addonIds = new Set<string>();
  for (const row of ADDON_PRICE_BOOK_SEED) {
    if (addonIds.has(row.id)) errors.push(`duplicate addon_price_book id ${row.id}`);
    addonIds.add(row.id);
  }
  return errors;
}
