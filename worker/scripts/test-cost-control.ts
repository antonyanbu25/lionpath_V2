/**
 * Cost control config helpers — percentile + env parsing.
 * Usage: tsx worker/scripts/test-cost-control.ts
 */

import assert from "node:assert/strict";
import {
  dailyTokenBudgetLimit,
  dailyTokenBudgetReserve,
  percentile,
  summariseAnomalyMultiplier,
  utcDateKey,
} from "../src/cost-control-config.ts";

assert.equal(percentile([1, 2, 3, 4, 5], 95), 5);
assert.equal(percentile([10, 20, 30, 40], 50), 20);
assert.equal(percentile([], 95), 0);

assert.equal(dailyTokenBudgetLimit({}), 8_000_000);
assert.equal(dailyTokenBudgetLimit({ DAILY_TOKEN_BUDGET_PER_USER: "5000000" }), 5_000_000);
assert.equal(dailyTokenBudgetReserve({}), 120_000);
assert.equal(summariseAnomalyMultiplier({}), 2);
assert.equal(summariseAnomalyMultiplier({ SUMMARISE_ANOMALY_MULTIPLIER: "3" }), 3);

const dateKey = utcDateKey(Date.parse("2026-08-05T12:00:00.000Z"));
assert.equal(dateKey, "2026-08-05");

console.log("test-cost-control: OK");
