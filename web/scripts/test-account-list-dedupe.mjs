#!/usr/bin/env node
/**
 * Account list dedupe: history stubs merge into store rows; daysSince never NaNd.
 * Run: node web/scripts/test-account-list-dedupe.mjs
 */

import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};

const { initDomainStore, getStore } = await import("../domain/store.js");
const { clearLocalStoreCache } = await import("../domain/local-store.js");
const { mergeAccountListRows } = await import("../domain/history-deal-enrichment.js");
const { findAccountByCompanyName, enrichAccountListRow } = await import("../domain/account-service.js?v=2.1.14");
const { normalizeAccountSlug } = await import("../domain/types.js");

initDomainStore(null);
const store = getStore();

async function reset() {
  store.clearAll();
  clearLocalStoreCache();
}

await reset();
const ts = 1_700_300_000_000;
const account = await store.createAccount({
  id: "acct_vivid",
  name: "Vivid Pix",
  domain: "vivid-pix.com",
  slug: "vivid-pix.com",
  createdAt: ts,
  updatedAt: ts,
});

const storeRow = {
  account,
  lifecycle: { id: "lc_vivid", accountId: account.id, lastActivityAt: ts },
  lastActivityAt: ts,
  historyCallCount: 0,
};

const historyRow = {
  account: { id: "hist_vivid-pix", name: "Vivid Pix", domain: "" },
  lifecycle: { id: "lc_hist_vivid", accountId: "hist_vivid-pix", lastActivityAt: ts - 1000 },
  lastActivityAt: "not-a-date",
  historyCallCount: 2,
  _historyFallback: true,
};

const merged = mergeAccountListRows([storeRow], [historyRow]);
assert.equal(merged.length, 1, "history stub merges into store account");
assert.equal(merged[0].account.id, account.id, "store account id wins");
assert.equal(merged[0].historyCallCount, 2, "history call count rolls up");

const enriched = await enrichAccountListRow(store, {
  ...storeRow,
  lastActivityAt: "invalid",
  deals: [],
});
assert.ok(
  enriched.lastTouchDays == null || Number.isFinite(enriched.lastTouchDays),
  "lastTouchDays is finite or null, never NaN",
);

await reset();
await store.createAccount({
  id: "acct_alias",
  name: "Acme Corp",
  domain: "acme.com",
  slug: "acme.com",
  metadata: { slugAliases: ["acme-corp"] },
  createdAt: ts,
  updatedAt: ts,
});

const bySlug = await findAccountByCompanyName("Acme Corp", null);
assert.equal(bySlug?.id, "acct_alias", "name lookup finds account via slug alias");

const byDomain = await findAccountByCompanyName("Acme Industries", "acme.com");
assert.equal(byDomain?.id, "acct_alias", "domain lookup finds single domain match");

assert.equal(normalizeAccountSlug("Vivid Pix", "vivid-pix.com"), "vivid-pix.com");

console.log("test-account-list-dedupe.mjs: ok");
