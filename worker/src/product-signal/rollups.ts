/** Cluster rollups — dealCount + arrTotal from snapshotted gap rows (ADR-006). */

import type { CrossCuttingTag, ProductArea } from "../domain-model/product-taxonomy";
import { CLUSTER_CONFIG } from "./cluster-math";

export interface GapRollupInput {
  dealId: string;
  arrTouched: number | null;
  productArea?: string;
  crossCuttingTags?: string[];
}

export interface ClusterRollups {
  dealCount: number;
  arrTotal: number;
  productArea: ProductArea | null;
  crossCuttingTags: CrossCuttingTag[];
}

export function computeClusterRollups(gaps: GapRollupInput[]): ClusterRollups {
  const dealIds = new Set<string>();
  let arrTotal = 0;
  const areaCounts = new Map<string, number>();
  const tagSet = new Set<string>();

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

  let productArea: ProductArea | null = null;
  let maxArea = 0;
  for (const [area, count] of areaCounts) {
    if (count > maxArea) {
      maxArea = count;
      productArea = area as ProductArea;
    }
  }

  return {
    dealCount: dealIds.size,
    arrTotal,
    productArea,
    crossCuttingTags: [...tagSet] as CrossCuttingTag[],
  };
}

export function shouldArchiveCluster(dealCount: number, gapCount: number): boolean {
  return gapCount === 0 || dealCount < CLUSTER_CONFIG.MIN_CLUSTER_SIZE;
}
