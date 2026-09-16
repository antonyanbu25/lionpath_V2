/**
 * Async gap clustering over verbatim embeddings (ADR-006, spec §8, ARCHITECTURE rule 3).
 *
 * Modes:
 * - incremental — assign unclustered real_gap rows to nearest centroid; refresh rollups
 * - full — agglomerative recluster; split/merge published clusters via archive + draft
 */

import { newId } from "../domain-model/id";
import type { GapCluster, GapClusterStatus } from "../domain-model/gap-cluster";
import { PRODUCT_TAXONOMY_VERSION } from "../domain-model/product-taxonomy";
import type { CrossCuttingTag, ProductArea } from "../domain-model/product-taxonomy";
import {
  agglomerativeClusterIndices,
  CLUSTER_CONFIG,
  cosineSimilarity,
  meanCentroid,
  medoidVerbatims,
  nearestCentroidAssignment,
} from "./cluster-math";
import { suggestClusterLabel, heuristicClusterLabel } from "./cluster-label";
import { computeClusterRollups, shouldArchiveCluster } from "./rollups";
import type { ProviderEnv } from "../providers/types";

const EXCLUDED_STATUSES = new Set(["dismissed", "merged"]);

export interface GapClusterInput {
  id: string;
  orgId: string;
  dealId: string;
  arrTouched: number | null;
  embedding: number[];
  verbatim: string;
  productArea?: string;
  crossCuttingTags?: string[];
  gapType: string;
  status: string;
  clusterId?: string | null;
}

export interface ExistingClusterInput {
  id: string;
  orgId: string;
  label: string;
  centroid: number[];
  status: GapClusterStatus;
  dealCount: number;
  arrTotal: number;
  taxonomyVersion?: string | null;
  productArea?: string | null;
  crossCuttingTags?: string[];
}

export type ClusteringMode = "incremental" | "full" | "auto";

export type ClusterLabelMode = "inline" | "batch";

export interface PendingClusterLabel {
  clusterId: string;
  verbatims: string[];
}

export interface RunClusteringInput {
  orgId: string;
  gaps: GapClusterInput[];
  clusters: ExistingClusterInput[];
  mode?: ClusteringMode;
  pendingGapCount?: number;
  lastFullRunAt?: number | null;
  lastIncrementalAt?: number | null;
  suggestLabels?: boolean;
  /** batch = heuristic labels now, LLM via Gemini Batch; inline = sync LLM (fallback). */
  labelMode?: ClusterLabelMode;
  now?: number;
}

export interface GapAssignment {
  gapId: string;
  clusterId: string | null;
}

export interface ClusteringRunResult {
  mode: "incremental" | "full";
  clusters: GapCluster[];
  archivedClusterIds: string[];
  gapAssignments: GapAssignment[];
  pendingLabels?: PendingClusterLabel[];
  clusteringState: {
    pendingGapCount: number;
    lastIncrementalAt: number | null;
    lastFullRunAt: number | null;
    running: false;
  };
}

export function isClusterEligibleGap(gap: GapClusterInput): boolean {
  return (
    !!gap.orgId &&
    gap.gapType === "real_gap" &&
    !EXCLUDED_STATUSES.has(gap.status) &&
    Array.isArray(gap.embedding) &&
    gap.embedding.length > 0
  );
}

export function resolveClusteringMode(
  requested: ClusteringMode | undefined,
  pendingGapCount: number,
  lastFullRunAt: number | null,
  now: number,
): "incremental" | "full" {
  if (requested === "incremental" || requested === "full") return requested;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  if (pendingGapCount >= CLUSTER_CONFIG.FULL_GAP_THRESHOLD) return "full";
  if (!lastFullRunAt || now - lastFullRunAt >= weekMs) return "full";
  if (pendingGapCount >= CLUSTER_CONFIG.INCREMENTAL_GAP_THRESHOLD) return "incremental";
  return "incremental";
}

function activeClusters(clusters: ExistingClusterInput[]): ExistingClusterInput[] {
  return clusters.filter((c) => c.status !== "archived");
}

function buildClusterDoc(
  partial: Omit<GapCluster, "createdAt" | "updatedAt"> & { createdAt?: number },
  now: number,
): GapCluster {
  return {
    ...partial,
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
  };
}

function refreshClusterFromMembers(
  cluster: ExistingClusterInput,
  members: GapClusterInput[],
  now: number,
): GapCluster {
  const centroid = meanCentroid(members.map((m) => m.embedding));
  const rollups = computeClusterRollups(members);
  return buildClusterDoc(
    {
      id: cluster.id,
      orgId: cluster.orgId,
      label: cluster.label,
      centroid,
      dealCount: rollups.dealCount,
      arrTotal: rollups.arrTotal,
      status: cluster.status,
      taxonomyVersion: cluster.taxonomyVersion ?? null,
      productArea: rollups.productArea,
      crossCuttingTags: rollups.crossCuttingTags,
    },
    now,
  );
}

async function resolveClusterLabel(
  env: ProviderEnv,
  clusterId: string,
  verbatims: string[],
  suggestLabels: boolean,
  labelMode: ClusterLabelMode,
  pendingLabels: PendingClusterLabel[],
): Promise<string> {
  const samples = verbatims.filter((v) => v.trim()).slice(0, 5);
  if (!samples.length) return "Untitled theme";
  if (!suggestLabels) return heuristicClusterLabel(samples);
  if (labelMode === "batch") {
    pendingLabels.push({ clusterId, verbatims: samples });
    return heuristicClusterLabel(samples);
  }
  return suggestClusterLabel(env, samples, true);
}

async function runIncrementalClustering(
  env: ProviderEnv,
  orgId: string,
  gaps: GapClusterInput[],
  clusters: ExistingClusterInput[],
  suggestLabels: boolean,
  labelMode: ClusterLabelMode,
  now: number,
  lastFullRunAt: number | null,
): Promise<ClusteringRunResult> {
  const pendingLabels: PendingClusterLabel[] = [];
  const eligible = gaps.filter(isClusterEligibleGap);
  const active = activeClusters(clusters).filter((c) => c.orgId === orgId);
  const centroids = active
    .filter((c) => c.centroid?.length)
    .map((c) => ({ id: c.id, centroid: c.centroid }));

  const assignments: GapAssignment[] = [];
  const assignmentMap = new Map<string, string | null>();
  for (const g of eligible) {
    assignmentMap.set(g.id, g.clusterId ?? null);
  }

  for (const g of eligible) {
    if (g.clusterId) continue;
    const assigned = nearestCentroidAssignment(g.embedding, centroids);
    if (assigned) assignmentMap.set(g.id, assigned);
  }

  for (const [gapId, clusterId] of assignmentMap) {
    assignments.push({ gapId, clusterId });
  }

  const updatedById = new Map<string, GapCluster>();
  for (const cluster of active) {
    const members = eligible.filter((g) => assignmentMap.get(g.id) === cluster.id);
    if (!members.length) {
      if (shouldArchiveCluster(0, 0)) {
        updatedById.set(
          cluster.id,
          buildClusterDoc(
            {
              ...refreshClusterFromMembers(cluster, [], now),
              status: "archived",
              dealCount: 0,
              arrTotal: 0,
              supersededBy: [],
            },
            now,
          ),
        );
      }
      continue;
    }
    updatedById.set(cluster.id, refreshClusterFromMembers(cluster, members, now));
  }

  const unassigned = eligible.filter((g) => !assignmentMap.get(g.id));
  if (unassigned.length >= CLUSTER_CONFIG.MIN_CLUSTER_SIZE) {
    const idxGroups = agglomerativeClusterIndices(unassigned.map((g) => g.embedding));
    for (const indices of idxGroups) {
      const members = indices.map((i) => unassigned[i]);
      const centroid = meanCentroid(members.map((m) => m.embedding));
      const rollups = computeClusterRollups(members);
      const verbatims = medoidVerbatims(members, centroid);
      const id = newId("gapCluster");
      const label = await resolveClusterLabel(
        env,
        id,
        verbatims,
        suggestLabels,
        labelMode,
        pendingLabels,
      );
      updatedById.set(
        id,
        buildClusterDoc(
          {
            id,
            orgId,
            label,
            centroid,
            dealCount: rollups.dealCount,
            arrTotal: rollups.arrTotal,
            status: "draft",
            taxonomyVersion: null,
            productArea: rollups.productArea,
            crossCuttingTags: rollups.crossCuttingTags,
          },
          now,
        ),
      );
      for (const m of members) {
        assignmentMap.set(m.id, id);
        const existing = assignments.find((a) => a.gapId === m.id);
        if (existing) existing.clusterId = id;
        else assignments.push({ gapId: m.id, clusterId: id });
      }
    }
  }

  return {
    mode: "incremental",
    clusters: [...updatedById.values()],
    archivedClusterIds: [...updatedById.values()]
      .filter((c) => c.status === "archived")
      .map((c) => c.id),
    gapAssignments: assignments,
    pendingLabels: pendingLabels.length ? pendingLabels : undefined,
    clusteringState: {
      pendingGapCount: eligible.filter((g) => !assignmentMap.get(g.id)).length,
      lastIncrementalAt: now,
      lastFullRunAt: lastFullRunAt,
      running: false,
    },
  };
}

async function runFullClustering(
  env: ProviderEnv,
  orgId: string,
  gaps: GapClusterInput[],
  clusters: ExistingClusterInput[],
  suggestLabels: boolean,
  labelMode: ClusterLabelMode,
  now: number,
): Promise<ClusteringRunResult> {
  const pendingLabels: PendingClusterLabel[] = [];
  const eligible = gaps.filter(isClusterEligibleGap);
  const active = activeClusters(clusters).filter((c) => c.orgId === orgId);
  const archivedIds: string[] = [];
  const outputClusters: GapCluster[] = [];
  const assignmentMap = new Map<string, string | null>();

  if (eligible.length < CLUSTER_CONFIG.MIN_CLUSTER_SIZE) {
    for (const g of eligible) assignmentMap.set(g.id, null);
    return {
      mode: "full",
      clusters: [],
      archivedClusterIds: [],
      gapAssignments: eligible.map((g) => ({ gapId: g.id, clusterId: null })),
      clusteringState: {
        pendingGapCount: eligible.length,
        lastIncrementalAt: null,
        lastFullRunAt: now,
        running: false,
      },
    };
  }

  const indexGroups = agglomerativeClusterIndices(eligible.map((g) => g.embedding));
  const newGroups: GapClusterInput[][] = indexGroups.map((indices) =>
    indices.map((i) => eligible[i]),
  );

  const publishedById = new Map(active.filter((c) => c.status === "published").map((c) => [c.id, c]));
  const publishedGroupCounts = new Map<string, number>();
  for (const members of newGroups) {
    const pubIds = new Set(
      members
        .map((m) => m.clusterId)
        .filter((id): id is string => !!id && publishedById.has(id)),
    );
    for (const pubId of pubIds) {
      publishedGroupCounts.set(pubId, (publishedGroupCounts.get(pubId) || 0) + 1);
    }
  }
  const splitPublishedIds = new Set(
    [...publishedGroupCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id),
  );

  for (const members of newGroups) {
    const oldClusterIds = new Map<string, number>();
    for (const m of members) {
      if (!m.clusterId) continue;
      oldClusterIds.set(m.clusterId, (oldClusterIds.get(m.clusterId) || 0) + 1);
    }

    const publishedSources = [...oldClusterIds.keys()].filter((id) => publishedById.has(id));
    const splitPublished = publishedSources.some((id) => splitPublishedIds.has(id));
    const multiPublished = publishedSources.length > 1;

    if (splitPublished || multiPublished) {
      for (const pubId of publishedSources) {
        if (!archivedIds.includes(pubId)) archivedIds.push(pubId);
      }
    }

    let clusterId = newId("gapCluster");
    let label: string;
    let status: GapClusterStatus = "draft";
    let taxonomyVersion: string | null = null;

    if (publishedSources.length === 1 && !splitPublished && !multiPublished) {
      const survivor = publishedById.get(publishedSources[0])!;
      clusterId = survivor.id;
      label = survivor.label;
      status = "published";
      taxonomyVersion = survivor.taxonomyVersion ?? PRODUCT_TAXONOMY_VERSION;
    } else if (oldClusterIds.size === 1 && !publishedSources.length) {
      const draftId = [...oldClusterIds.keys()][0];
      const draft = active.find((c) => c.id === draftId);
      if (draft && draft.status === "draft") {
        clusterId = draft.id;
        label = draft.label;
        status = "draft";
      } else {
        const verbatims = medoidVerbatims(members, meanCentroid(members.map((m) => m.embedding)));
        label = await resolveClusterLabel(
          env,
          clusterId,
          verbatims,
          suggestLabels,
          labelMode,
          pendingLabels,
        );
      }
    } else {
      const verbatims = medoidVerbatims(members, meanCentroid(members.map((m) => m.embedding)));
      label = await resolveClusterLabel(
        env,
        clusterId,
        verbatims,
        suggestLabels,
        labelMode,
        pendingLabels,
      );
    }

    const centroid = meanCentroid(members.map((m) => m.embedding));
    const rollups = computeClusterRollups(members);
    outputClusters.push(
      buildClusterDoc(
        {
          id: clusterId,
          orgId,
          label,
          centroid,
          dealCount: rollups.dealCount,
          arrTotal: rollups.arrTotal,
          status,
          taxonomyVersion,
          productArea: rollups.productArea,
          crossCuttingTags: rollups.crossCuttingTags,
        },
        now,
      ),
    );

    for (const m of members) assignmentMap.set(m.id, clusterId);
  }

  for (const old of active) {
    const stillUsed = outputClusters.some((c) => c.id === old.id);
    if (!stillUsed && !archivedIds.includes(old.id)) archivedIds.push(old.id);
  }

  for (const archId of archivedIds) {
    const old = active.find((c) => c.id === archId);
    if (!old) continue;
    const replacements = outputClusters.filter((c) => c.status === "draft").map((c) => c.id);
    outputClusters.push(
      buildClusterDoc(
        {
          id: old.id,
          orgId: old.orgId,
          label: old.label,
          centroid: old.centroid,
          dealCount: 0,
          arrTotal: 0,
          status: "archived",
          taxonomyVersion: old.taxonomyVersion ?? null,
          productArea: (old.productArea as ProductArea | null) ?? null,
          crossCuttingTags: (old.crossCuttingTags ?? []) as CrossCuttingTag[],
          supersededBy: replacements,
        },
        now,
      ),
    );
  }

  for (const g of eligible) {
    if (!assignmentMap.has(g.id)) assignmentMap.set(g.id, null);
  }

  const mergedOutput = new Map<string, GapCluster>();
  for (const c of outputClusters) mergedOutput.set(c.id, c);

  return {
    mode: "full",
    clusters: [...mergedOutput.values()].filter((c) => c.status !== "archived" || archivedIds.includes(c.id)),
    archivedClusterIds: archivedIds,
    gapAssignments: [...assignmentMap.entries()].map(([gapId, clusterId]) => ({ gapId, clusterId })),
    pendingLabels: pendingLabels.length ? pendingLabels : undefined,
    clusteringState: {
      pendingGapCount: eligible.filter((g) => !assignmentMap.get(g.id)).length,
      lastIncrementalAt: null,
      lastFullRunAt: now,
      running: false,
    },
  };
}

export async function runGapClustering(
  env: ProviderEnv,
  input: RunClusteringInput,
): Promise<ClusteringRunResult> {
  const now = input.now ?? Date.now();
  const pending =
    input.pendingGapCount ??
    input.gaps.filter((g) => g.orgId === input.orgId && isClusterEligibleGap(g) && !g.clusterId)
      .length;
  const resolvedMode = resolveClusteringMode(
    input.mode ?? "auto",
    pending,
    input.lastFullRunAt ?? null,
    now,
  );

  const labelMode = input.labelMode ?? "batch";

  if (resolvedMode === "full") {
    return runFullClustering(
      env,
      input.orgId,
      input.gaps,
      input.clusters,
      input.suggestLabels !== false,
      labelMode,
      now,
    );
  }

  return runIncrementalClustering(
    env,
    input.orgId,
    input.gaps,
    input.clusters,
    input.suggestLabels !== false,
    labelMode,
    now,
    input.lastFullRunAt ?? null,
  );
}

export { CLUSTER_CONFIG };
