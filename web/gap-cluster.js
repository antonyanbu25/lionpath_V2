/**
 * Gap cluster rollups + trigger thresholds — mirror of worker/src/product-signal (ADR-006).
 */

export const CLUSTER_CONFIG = {
  MIN_CLUSTER_SIZE: 3,
  ASSIGN_SIMILARITY: 0.82,
  MERGE_SIMILARITY: 0.9,
  MAX_LINKAGE_DISTANCE: 0.38,
  INCREMENTAL_GAP_THRESHOLD: 10,
  FULL_GAP_THRESHOLD: 25,
};

/**
 * @param {Array<{ dealId: string, arrTouched?: number|null, productArea?: string, crossCuttingTags?: string[] }>} gaps
 */
export function computeClusterRollups(gaps) {
  const dealIds = new Set();
  let arrTotal = 0;
  const areaCounts = new Map();
  const tagSet = new Set();

  for (const g of gaps) {
    if (g.dealId) dealIds.add(g.dealId);
    if (typeof g.arrTouched === "number" && Number.isFinite(g.arrTouched)) {
      arrTotal += g.arrTouched;
    }
    if (g.productArea) {
      areaCounts.set(g.productArea, (areaCounts.get(g.productArea) || 0) + 1);
    }
    for (const tag of g.crossCuttingTags || []) tagSet.add(tag);
  }

  let productArea = null;
  let maxArea = 0;
  for (const [area, count] of areaCounts) {
    if (count > maxArea) {
      maxArea = count;
      productArea = area;
    }
  }

  return {
    dealCount: dealIds.size,
    arrTotal,
    productArea,
    crossCuttingTags: [...tagSet],
  };
}

/**
 * @param {{ pendingGapCount?: number, lastFullRunAt?: number|null }} state
 * @param {number} [now]
 */
export function shouldTriggerGapClustering(state, now = Date.now()) {
  const pending = state.pendingGapCount ?? 0;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  if (pending >= CLUSTER_CONFIG.FULL_GAP_THRESHOLD) return { run: true, mode: "full" };
  if (!state.lastFullRunAt || now - state.lastFullRunAt >= weekMs) {
    return { run: pending > 0, mode: "full" };
  }
  if (pending >= CLUSTER_CONFIG.INCREMENTAL_GAP_THRESHOLD) {
    return { run: true, mode: "incremental" };
  }
  return { run: false, mode: null };
}

/**
 * Count eligible unclustered real gaps for an org.
 * @param {Array<{ orgId: string, gapType?: string, status?: string, embedding?: number[], clusterId?: string|null }>} gaps
 * @param {string} orgId
 */
export function countPendingClusterGaps(gaps, orgId) {
  return gaps.filter(
    (g) =>
      g.orgId === orgId &&
      g.gapType === "real_gap" &&
      g.status !== "dismissed" &&
      g.status !== "merged" &&
      Array.isArray(g.embedding) &&
      g.embedding.length > 0 &&
      !g.clusterId,
  ).length;
}
