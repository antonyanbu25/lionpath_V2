/**
 * Default in-worker price book bundle — docs/PRICE_BOOK_SEED.md.
 */

import {
  ADDON_PRICE_BOOK_SEED,
  ASSUMPTIONS_BOOK_SEED,
  PRICE_BOOK_SEED,
  PRICE_BOOK_VERSION,
} from "../price-book-seed";
import type { ArrPriceBooks } from "./compute";

export function defaultArrPriceBooks(): ArrPriceBooks {
  return {
    version: PRICE_BOOK_VERSION,
    priceBook: PRICE_BOOK_SEED,
    addonPriceBook: ADDON_PRICE_BOOK_SEED,
    assumptionsBook: ASSUMPTIONS_BOOK_SEED,
  };
}
