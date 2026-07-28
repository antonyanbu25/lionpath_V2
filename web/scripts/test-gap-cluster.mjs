/**
 * Smoke tests for gap-cluster rollups mirror (web).
 */
import assert from "node:assert/strict";
import {
  computeClusterRollups,
  shouldTriggerGapClustering,
  countPendingClusterGaps,
  CLUSTER_CONFIG,
} from "../gap-cluster.js";

const rollups = computeClusterRollups([
  { dealId: "d1", arrTouched: 88000 },
  { dealId: "d1", arrTouched: 88000 },
  { dealId: "d2", arrTouched: 42000 },
]);
assert.equal(rollups.dealCount, 2);
assert.equal(rollups.arrTotal, 88000 + 88000 + 42000);

const pending = countPendingClusterGaps(
  [
    { orgId: "org_a", gapType: "real_gap", status: "draft", embedding: [1], clusterId: null },
    { orgId: "org_a", gapType: "enablement_gap", status: "draft", embedding: [1], clusterId: null },
    { orgId: "org_b", gapType: "real_gap", status: "draft", embedding: [1], clusterId: null },
  ],
  "org_a",
);
assert.equal(pending, 1);

const trigger = shouldTriggerGapClustering({
  pendingGapCount: CLUSTER_CONFIG.INCREMENTAL_GAP_THRESHOLD,
  lastFullRunAt: Date.now(),
});
assert.equal(trigger.run, true);
assert.equal(trigger.mode, "incremental");

console.log("test-gap-cluster.mjs: all passed");
