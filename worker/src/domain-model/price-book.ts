/** ARR price book, add-on price book, and assumptions — effective-dated reference data (spec §7.3). */

export type PriceBookProduct =
  | "freshdesk"
  | "freshdesk_omni"
  | "freshservice"
  | "freshsales";

export type PriceBookTier = "starter" | "growth" | "pro" | "enterprise";

export interface PriceBookRow {
  id: string;
  product: PriceBookProduct | string;
  tier: PriceBookTier | string;
  currency: string;
  term: string;
  unit: string;
  price: number | null;
  quoteOnly: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string;
}

export interface AddonPriceBookRow {
  id: string;
  addon: string;
  appliesTo: string[];
  requiresTier: string[];
  unit: string;
  price: number | null;
  includedUnits: number;
  includedScope: string | null;
  quoteOnly: boolean;
  note: string | null;
  currency: string;
  term: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface AssumptionsBookRow {
  id: string;
  key: string;
  scope: string;
  scopeValue: string | null;
  value: number;
  source: string;
  rationale: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: string;
}

export type PriceBookLookupKey = {
  product: string;
  tier: string;
  currency: string;
  term: string;
};

/** Explicit match — quote-only rows are found:true with price null, never tier fallback. */
export type PriceBookLookupResult =
  | { found: false }
  | { found: true; row: PriceBookRow; quoteOnly: true }
  | { found: true; row: PriceBookRow; quoteOnly: false; price: number };

export type AddonPriceBookLookupKey = {
  addon: string;
  product: string;
  tier: string;
  currency: string;
  term: string;
};

export type AddonPriceBookLookupResult =
  | { found: false }
  | { found: true; row: AddonPriceBookRow; quoteOnly: true }
  | { found: true; row: AddonPriceBookRow; quoteOnly: false; price: number };
