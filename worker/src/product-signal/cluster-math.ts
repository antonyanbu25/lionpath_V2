/**
 * Verbatim embedding math for gap clustering (spec §8 — cluster on embeddings, not labels).
 */

export const CLUSTER_CONFIG = {
  MIN_CLUSTER_SIZE: 3,
  /** Cosine similarity — assign unclustered gap to existing cluster centroid. */
  ASSIGN_SIMILARITY: 0.82,
  /** Merge two cluster centroids when recomputing structure. */
  MERGE_SIMILARITY: 0.9,
  /** Average-linkage distance cap for agglomerative full recluster (distance = 1 - similarity). */
  MAX_LINKAGE_DISTANCE: 0.38,
  INCREMENTAL_GAP_THRESHOLD: 10,
  FULL_GAP_THRESHOLD: 25,
} as const;

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function normalizeVector(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  if (sum === 0) return [...v];
  const inv = 1 / Math.sqrt(sum);
  return v.map((x) => x * inv);
}

export function meanCentroid(vectors: number[][]): number[] {
  if (!vectors.length) return [];
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i += 1) sum[i] += v[i] || 0;
  }
  for (let i = 0; i < dim; i += 1) sum[i] /= vectors.length;
  return normalizeVector(sum);
}

function clusterAverageLinkage(
  aIndices: number[],
  bIndices: number[],
  embeddings: number[][],
): number {
  let total = 0;
  let count = 0;
  for (const i of aIndices) {
    for (const j of bIndices) {
      total += 1 - cosineSimilarity(embeddings[i], embeddings[j]);
      count += 1;
    }
  }
  return count ? total / count : 1;
}

/** Agglomerative clustering over embedding vectors; returns groups of input indices. */
export function agglomerativeClusterIndices(
  embeddings: number[][],
  maxDistance: number = CLUSTER_CONFIG.MAX_LINKAGE_DISTANCE,
  minClusterSize: number = CLUSTER_CONFIG.MIN_CLUSTER_SIZE,
): number[][] {
  const n = embeddings.length;
  if (n === 0) return [];
  if (n === 1) return minClusterSize <= 1 ? [[0]] : [];

  let groups: number[][] = embeddings.map((_, i) => [i]);

  while (groups.length > 1) {
    let bestDist = Infinity;
    let mergeA = -1;
    let mergeB = -1;
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        const d = clusterAverageLinkage(groups[i], groups[j], embeddings);
        if (d < bestDist) {
          bestDist = d;
          mergeA = i;
          mergeB = j;
        }
      }
    }
    if (bestDist > maxDistance || mergeA < 0) break;
    const merged = [...groups[mergeA], ...groups[mergeB]];
    groups = groups.filter((_, idx) => idx !== mergeA && idx !== mergeB);
    groups.push(merged);
  }

  return groups.filter((g) => g.length >= minClusterSize);
}

export function nearestCentroidAssignment(
  embedding: number[],
  centroids: { id: string; centroid: number[] }[],
  minSimilarity: number = CLUSTER_CONFIG.ASSIGN_SIMILARITY,
): string | null {
  let bestId: string | null = null;
  let bestSim = minSimilarity;
  for (const c of centroids) {
    const sim = cosineSimilarity(embedding, c.centroid);
    if (sim >= bestSim) {
      bestSim = sim;
      bestId = c.id;
    }
  }
  return bestId;
}

/** Pick up to k verbatims closest to centroid (medoids for label suggestion). */
export function medoidVerbatims(
  items: { verbatim: string; embedding: number[] }[],
  centroid: number[],
  k = 3,
): string[] {
  return [...items]
    .sort(
      (a, b) =>
        cosineSimilarity(b.embedding, centroid) - cosineSimilarity(a.embedding, centroid),
    )
    .slice(0, k)
    .map((x) => x.verbatim)
    .filter(Boolean);
}
