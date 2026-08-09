#!/usr/bin/env node
/**
 * Deal motion grace period + wonAt routing tests.
 *
 * Rewritten 2026-08-09: the API this test called no longer exists as written —
 * shouldUseWonNbDeal moved from an options-object ({wonNbDeal, now}) returning
 * {useWonNb} to positional args (account, wonNbDeal, asOfMs) returning
 * `null | dealId`; resolveEngagementDealInput's grace-period field renamed
 * wonNbDeal -> wonNbDealInGrace and now -> asOfMs; the deal fixture shape
 * changed from {wonAt, status} to {closedWonAt (or metadata.closedWonAt),
 * stage: "closed_won"} per getClosedWonAt()/isWithinNbGracePeriod() in
 * domain/deal-motion.js. NB_GRACE_DAYS was removed in favor of
 * NB_GRACE_PERIOD_MS (still 90 days). Business logic (90-day grace window)
 * is unchanged — only the calling convention was stale, orphaned until now.
 */

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
  NB_GRACE_PERIOD_MS,
} = await import("../domain/deal-motion.js");

const day = 86400000;
const wonAt = Date.UTC(2026, 0, 1);

const deal = { id: "deal_nb", type: "new_business", stage: "closed_won", closedWonAt: wonAt };
const account = { id: "a1" };

for (const [days, expect] of [
  [0, "deal_nb"],
  [1, "deal_nb"],
  [89, "deal_nb"],
  [90, "deal_nb"],
  [91, null],
  [365, null],
]) {
  const r = shouldUseWonNbDeal(account, deal, wonAt + days * day);
  assert.equal(r, expect, `day ${days}`);
}

assert.equal(shouldUseWonNbDeal(account, { id: "x" }, wonAt), null, "deal without closedWonAt/stage never in grace");

const expansionDeal = { id: "deal_exp", type: "expansion" };
let m = resolveEngagementDealInput({ explicitDealId: expansionDeal.id, explicitDealType: "expansion" });
assert.equal(m.prepType, "expansion", "explicit deal type wins");
assert.equal(m.source, "manual");

m = resolveEngagementDealInput({
  account,
  actor: { teamId: "team_x" },
  wonNbDealInGrace: deal,
  asOfMs: wonAt + 30 * day,
  allowlist: { accountIds: new Set(), slugs: new Set(), loaded: false },
});
assert.equal(m.source, "won_grace", "grace within 90 days");
assert.equal(m.dealId, "deal_nb");
assert.equal(m.prepType, "new_business");

m = resolveEngagementDealInput({
  account,
  actor: { teamId: "team_x" },
  wonNbDealInGrace: deal,
  asOfMs: wonAt + 120 * day,
  allowlist: { accountIds: new Set(), slugs: new Set(), loaded: false },
});
assert.notEqual(m.source, "won_grace", "grace expired at day 120 — no longer using the NB deal");
assert.equal(m.dealId, null, "grace expired: no deal id");
assert.equal(m.prepType, "expansion", "grace expired: routes to expansion motion");
assert.equal(m.source, "won_grace_expired", "grace expired: distinct source from still-in-grace (fixed 2026-08-09 — was mislabeled won_grace)");

console.log(`test-deal-motion-grace.mjs: ok (${NB_GRACE_PERIOD_MS / day}-day rule)`);
