#!/usr/bin/env node
/** Deal motion grace period + wonAt routing tests. */

import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};

const {
  shouldUseWonNbDeal,
  resolveEngagementDealInput,
  NB_GRACE_DAYS,
} = await import("../domain/deal-motion.js");

const day = 86400000;
const wonAt = Date.UTC(2026, 0, 1);

const deal = { id: "deal_nb", type: "new_business", wonAt, status: "closed_won_grace" };

for (const [days, expect] of [
  [0, true],
  [1, true],
  [89, true],
  [90, true],
  [91, false],
  [365, false],
]) {
  const r = shouldUseWonNbDeal({ wonNbDeal: deal, now: wonAt + days * day });
  assert.equal(r.useWonNb, expect, `day ${days}`);
}

assert.equal(shouldUseWonNbDeal({ wonNbDeal: { id: "x" } }).useWonNb, false);

const expansionDeal = { id: "deal_exp", type: "expansion" };
let m = resolveEngagementDealInput({ explicitDeal: expansionDeal });
assert.equal(m.prepType, "expansion", "explicit deal type wins");

m = resolveEngagementDealInput({
  account: { id: "a1" },
  actor: { teamId: "team_x" },
  wonNbDeal: deal,
  now: wonAt + 30 * day,
  allowlist: { accountIds: new Set(), slugs: new Set(), loaded: false },
});
assert.equal(m.source, "grace", "grace within 90 days");
assert.equal(m.dealId, "deal_nb");

m = resolveEngagementDealInput({
  account: { id: "a1" },
  actor: { teamId: "team_x" },
  wonNbDeal: deal,
  now: wonAt + 120 * day,
  allowlist: { accountIds: new Set(), slugs: new Set(), loaded: false },
});
assert.notEqual(m.source, "grace", "grace expired at day 120");

console.log(`test-deal-motion-grace.mjs: ok (${NB_GRACE_DAYS}-day rule)`);
