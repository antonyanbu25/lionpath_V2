/**
 * Unit tests for gap clustering engine (no LLM, no Firestore).
 */
import {
  agglomerativeClusterIndices,
  cosineSimilarity,
  meanCentroid,
  nearestCentroidAssignment,
} from "../src/product-signal/cluster-math.ts";
import { computeClusterRollups } from "../src/product-signal/rollups.ts";
import {
  isClusterEligibleGap,
  resolveClusteringMode,
  runGapClustering,
  type GapClusterInput,
} from "../src/product-signal/run-clustering.ts";

const checks: [string, boolean][] = [];

const vResidencyA = [1, 0, 0];
const vResidencyB = [0.98, 0.1, 0];
const vResidencyC = [0.96, 0.05, 0];
const vWhatsappA = [0, 1, 0];
const vWhatsappB = [0.05, 0.99, 0];
const vWhatsappC = [0.02, 0.97, 0];

checks.push(["cosine identical", cosineSimilarity(vResidencyA, vResidencyA) > 0.99]);
checks.push(["cosine orthogonal", cosineSimilarity(vResidencyA, vWhatsappA) < 0.1]);

const groups = agglomerativeClusterIndices([
  vResidencyA,
  vResidencyB,
  vResidencyC,
  vWhatsappA,
  vWhatsappB,
  vWhatsappC,
]);
checks.push(["two clusters from 6 vectors", groups.length === 2]);
checks.push(
  ["each cluster size >= 3", groups.every((g) => g.length >= 3)],
);

const rollups = computeClusterRollups([
  { dealId: "deal_1", arrTouched: 88000, productArea: "channels", crossCuttingTags: ["data_residency"] },
  { dealId: "deal_1", arrTouched: 88000, productArea: "channels", crossCuttingTags: ["data_residency"] },
  { dealId: "deal_2", arrTouched: 42000, productArea: "knowledge", crossCuttingTags: [] },
]);
checks.push(["dealCount distinct", rollups.dealCount === 2]);
checks.push(["arrTotal sums snapshots", rollups.arrTotal === 88000 + 88000 + 42000]);
checks.push(["productArea plurality", rollups.productArea === "channels"]);

const centroid = meanCentroid([vResidencyA, vResidencyB]);
const assigned = nearestCentroidAssignment(vResidencyC, [{ id: "gclus_a", centroid }]);
checks.push(["incremental assign similar", assigned === "gclus_a"]);

const gapBase = (id: string, embedding: number[], overrides: Partial<GapClusterInput> = {}): GapClusterInput => ({
  id,
  orgId: "org_test",
  dealId: `deal_${id}`,
  arrTouched: 50000,
  embedding,
  verbatim: `quote ${id}`,
  productArea: "channels",
  crossCuttingTags: [],
  gapType: "real_gap",
  status: "draft",
  clusterId: null,
  ...overrides,
});

checks.push([
  "enablement excluded",
  !isClusterEligibleGap(gapBase("e1", vResidencyA, { gapType: "enablement_gap" })),
]);
checks.push([
  "dismissed excluded",
  !isClusterEligibleGap(gapBase("d1", vResidencyA, { status: "dismissed" })),
]);

checks.push([
  "auto mode incremental when pending low",
  resolveClusteringMode("auto", 3, Date.now(), Date.now()) === "incremental",
]);
checks.push([
  "auto mode full when pending high",
  resolveClusteringMode("auto", 30, Date.now(), Date.now()) === "full",
]);

const gaps: GapClusterInput[] = [
  gapBase("g1", vResidencyA),
  gapBase("g2", vResidencyB),
  gapBase("g3", vResidencyC),
  gapBase("g4", vWhatsappA),
  gapBase("g5", vWhatsappB),
  gapBase("g6", vWhatsappC),
];

const fullResult = await runGapClustering(
  {},
  {
    orgId: "org_test",
    gaps,
    clusters: [],
    mode: "full",
    suggestLabels: false,
    now: 1_700_000_000_000,
  },
);

checks.push(["full run creates clusters", fullResult.clusters.length >= 2]);
checks.push(["full run assigns all gaps", fullResult.gapAssignments.length === 6]);
checks.push([
  "all gaps assigned to a cluster",
  fullResult.gapAssignments.every((a) => a.clusterId),
]);
checks.push(["cluster ids prefixed", fullResult.clusters.every((c) => c.id.startsWith("gclus_"))]);
checks.push([
  "arrTotal on cluster positive",
  fullResult.clusters.every((c) => c.arrTotal > 0),
]);

const publishedCluster = fullResult.clusters[0];
const incrementalGaps: GapClusterInput[] = [
  ...gaps.map((g) => ({
    ...g,
    clusterId: fullResult.gapAssignments.find((a) => a.gapId === g.id)?.clusterId ?? null,
  })),
  gapBase("g7", vResidencyB),
];

const incResult = await runGapClustering(
  {},
  {
    orgId: "org_test",
    gaps: incrementalGaps,
    clusters: fullResult.clusters.map((c) => ({
      ...c,
      status: c.id === publishedCluster.id ? "published" : c.status,
    })),
    mode: "incremental",
    suggestLabels: false,
    lastFullRunAt: 1_700_000_000_000,
    now: 1_700_000_100_000,
  },
);

checks.push([
  "incremental assigns new gap",
  incResult.gapAssignments.find((a) => a.gapId === "g7")?.clusterId != null,
]);
checks.push(["incremental preserves lastFullRunAt", incResult.clusteringState.lastFullRunAt === 1_700_000_000_000]);

let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

if (failed) {
  console.error(`\n${failed}/${checks.length} failed`);
  process.exit(1);
}
console.log(`\n${checks.length} checks passed`);
