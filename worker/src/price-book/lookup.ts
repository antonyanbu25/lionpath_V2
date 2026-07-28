/**
 * Effective-dated price book lookups (spec §7.3).
 * Never overwrite rows — close with effectiveTo and insert a successor.
 */

import type {
  AddonPriceBookLookupKey,
  AddonPriceBookLookupResult,
  AddonPriceBookRow,
  AssumptionsBookRow,
  PriceBookLookupKey,
  PriceBookLookupResult,
  PriceBookRow,
} from "../domain-model/price-book.ts";

type EffectiveDated = { effectiveFrom: string; effectiveTo: string | null };

/** ISO date string YYYY-MM-DD — lexicographic order matches chronological order. */
export function isEffectiveAt(row: EffectiveDated, asOf: string): boolean {
  if (asOf < row.effectiveFrom) return false;
  if (row.effectiveTo !== null && asOf > row.effectiveTo) return false;
  return true;
}

function exactPriceMatch(row: PriceBookRow, key: PriceBookLookupKey): boolean {
  return (
    row.product === key.product &&
    row.tier === key.tier &&
    row.currency === key.currency &&
    row.term === key.term
  );
}

function toPriceResult(row: PriceBookRow): PriceBookLookupResult {
  if (row.quoteOnly || row.price === null) {
    return { found: true, row, quoteOnly: true };
  }
  return { found: true, row, quoteOnly: false, price: row.price };
}

/**
 * Resolve a base plan row by exact (product, tier, currency, term) at asOf.
 * No tier fallback. Quote-only rows return found:true with quoteOnly:true.
 */
export function lookupPriceBookRow(
  rows: PriceBookRow[],
  key: PriceBookLookupKey,
  asOf: string
): PriceBookLookupResult {
  const matches = rows.filter(
    (row) => exactPriceMatch(row, key) && isEffectiveAt(row, asOf)
  );
  if (matches.length === 0) return { found: false };
  if (matches.length > 1) {
    matches.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  }
  return toPriceResult(matches[0]!);
}

function addonMatchesTier(row: AddonPriceBookRow, tier: string): boolean {
  if (row.requiresTier.length === 0) return true;
  return row.requiresTier.includes(tier);
}

function exactAddonMatch(row: AddonPriceBookRow, key: AddonPriceBookLookupKey): boolean {
  return (
    row.addon === key.addon &&
    row.appliesTo.includes(key.product) &&
    addonMatchesTier(row, key.tier) &&
    row.currency === key.currency &&
    row.term === key.term
  );
}

function toAddonResult(row: AddonPriceBookRow): AddonPriceBookLookupResult {
  if (row.quoteOnly || row.price === null) {
    return { found: true, row, quoteOnly: true };
  }
  return { found: true, row, quoteOnly: false, price: row.price };
}

/** Resolve an add-on row — no tier fallback when requiresTier is set. */
export function lookupAddonPriceBookRow(
  rows: AddonPriceBookRow[],
  key: AddonPriceBookLookupKey,
  asOf: string
): AddonPriceBookLookupResult {
  const matches = rows.filter(
    (row) => exactAddonMatch(row, key) && isEffectiveAt(row, asOf)
  );
  if (matches.length === 0) return { found: false };
  if (matches.length > 1) {
    matches.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  }
  return toAddonResult(matches[0]!);
}

export function lookupAssumption(
  rows: AssumptionsBookRow[],
  key: string,
  scope: string,
  scopeValue: string | null,
  asOf: string
): AssumptionsBookRow | null {
  const matches = rows.filter(
    (row) =>
      row.key === key &&
      row.scope === scope &&
      row.scopeValue === scopeValue &&
      isEffectiveAt(row, asOf)
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    matches.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  }
  return matches[0] ?? null;
}

/** Close a row for versioning — returns a new object; persist both closed and successor rows. */
export function closeEffectiveRow<T extends EffectiveDated>(
  row: T,
  effectiveTo: string
): T {
  return { ...row, effectiveTo };
}
