/**
 * Async gap clustering orchestration — reads store, calls worker, persists results.
 */

import { WORKER_BASE_URL } from "../firebase-config.js";
import { shouldTriggerGapClustering, countPendingClusterGaps } from "../gap-cluster.js";
import { mergePostCallDetail, setDetailArray } from "./post-call-detail.js";
import { newId, now } from "./types.js";

/** @type {(() => Promise<string|null>)|null} */
let getAuthToken = null;

/** @param {() => Promise<string|null>} fn */
export function setProductSignalAuthGetter(fn) {
  getAuthToken = fn || null;
}

export function clearProductSignalAuthGetter() {
  getAuthToken = null;
}

async function authHeaders() {
  /** @type {Record<string, string>} */
  const headers = { "Content-Type": "application/json" };
  if (getAuthToken) {
    try {
      const token = await getAuthToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {
      /* dummy mode */
    }
  }
  return headers;
}

/**
 * @param {string} apiBase
 * @param {string} orgId
 * @param {Array<{ clusterId: string, verbatims: string[] }>} pendingLabels
 */
async function enqueueClusterLabelsAfterClustering(apiBase, orgId, pendingLabels) {
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/batch/cluster-labels/enqueue`, {
    method: "POST",
    headers: await authHeaders(),
    credentials: "include",
    body: JSON.stringify({ orgId, pendingLabels }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Cluster label batch enqueue failed (${res.status})`);
  }
  return res.json();
}

/** @param {object|null|undefined} session */
export function isProductSignalCurator(session) {
  const role = session?.role;
  return role === "admin" || role === "pm";
}

/**
 * @param {object} store
 * @param {string} apiBase
 * @param {string} orgId
 * @param {{ mode?: "auto"|"incremental"|"full", force?: boolean, suggestLabels?: boolean }} [options]
 */
export async function runGapClusteringJob(store, apiBase, orgId, options = {}) {
  if (!store?.listProductGapsByOrg || !store?.listGapClustersByOrg) {
    throw new Error("Domain store does not support product signal collections.");
  }

  const gaps = await store.listProductGapsByOrg(orgId, 2000);
  const clusters = await store.listGapClustersByOrg(orgId, 500);
  const state = (await store.getClusteringState?.(orgId)) || {
    orgId,
    pendingGapCount: 0,
    lastIncrementalAt: null,
    lastFullRunAt: null,
    running: false,
  };

  const pendingGapCount = countPendingClusterGaps(gaps, orgId);
  const trigger = shouldTriggerGapClustering({
    pendingGapCount,
    lastFullRunAt: state.lastFullRunAt,
  });

  const mode = options.force ? options.mode || "full" : options.mode || trigger.mode || "auto";
  if (!options.force && !trigger.run && mode === "auto") {
    return { skipped: true, reason: "below_threshold", pendingGapCount };
  }

  if (state.running) {
    return { skipped: true, reason: "already_running", pendingGapCount };
  }

  await store.upsertClusteringState?.({
    ...state,
    id: state.id || orgId,
    orgId,
    pendingGapCount,
    running: true,
    updatedAt: now(),
  });

  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/product-signal/cluster`, {
    method: "POST",
    headers: await authHeaders(),
    credentials: "include",
    body: JSON.stringify({
      orgId,
      gaps,
      clusters,
      mode: mode === "auto" ? undefined : mode,
      pendingGapCount,
      lastFullRunAt: state.lastFullRunAt,
      lastIncrementalAt: state.lastIncrementalAt,
      suggestLabels: options.suggestLabels !== false,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    await store.upsertClusteringState?.({
      ...state,
      id: state.id || orgId,
      orgId,
      pendingGapCount,
      running: false,
      updatedAt: now(),
    });
    throw new Error(err.error || `Clustering failed (${res.status})`);
  }

  const result = await res.json();
  const ts = now();

  for (const cluster of result.clusters || []) {
    await store.upsertGapCluster({
      ...cluster,
      orgId,
      updatedAt: ts,
      createdAt: cluster.createdAt || ts,
    });
  }

  const assignmentMap = new Map(
    (result.gapAssignments || []).map((a) => [a.gapId, a.clusterId]),
  );
  for (const gap of gaps) {
    if (!assignmentMap.has(gap.id)) continue;
    const clusterId = assignmentMap.get(gap.id);
    if (gap.clusterId === clusterId) continue;
    await store.upsertProductGap({ ...gap, clusterId, updatedAt: ts });
  }

  const nextState = {
    id: state.id || orgId,
    orgId,
    pendingGapCount: result.clusteringState?.pendingGapCount ?? 0,
    lastIncrementalAt:
      result.clusteringState?.lastIncrementalAt ?? state.lastIncrementalAt ?? null,
    lastFullRunAt: result.clusteringState?.lastFullRunAt ?? state.lastFullRunAt ?? null,
    running: false,
    updatedAt: ts,
  };
  await store.upsertClusteringState?.(nextState);

  if (result.pendingLabels?.length) {
    void enqueueClusterLabelsAfterClustering(apiBase, orgId, result.pendingLabels).catch((err) => {
      console.warn("[product-signal] cluster label batch enqueue failed:", err?.message || err);
    });
  }

  return {
    skipped: false,
    mode: result.mode,
    clusterCount: (result.clusters || []).length,
    archivedClusterIds: result.archivedClusterIds || [],
    pendingGapCount: nextState.pendingGapCount,
  };
}

/**
 * After Pass 6 persists new gaps, bump pending counter (async pipeline trigger).
 * @param {object} store
 * @param {string} orgId
 * @param {number} [addedCount]
 */
export async function notifyGapClusteringPending(store, orgId, addedCount = 1) {
  if (!store?.upsertClusteringState) return;
  const state = (await store.getClusteringState?.(orgId)) || {
    id: orgId,
    orgId,
    pendingGapCount: 0,
    lastIncrementalAt: null,
    lastFullRunAt: null,
    running: false,
  };
  const gaps = store.listProductGapsByOrg ? await store.listProductGapsByOrg(orgId, 2000) : [];
  await store.upsertClusteringState({
    ...state,
    id: state.id || orgId,
    orgId,
    pendingGapCount: countPendingClusterGaps(gaps, orgId) + Math.max(0, addedCount - 1),
    updatedAt: now(),
  });
}

/**
 * @param {object} store
 * @param {object} draft
 * @param {object} rbac
 */
/**
 * Build embedded detail rows + flat collection docs for Pass 6.
 * @param {object} drafts
 * @param {object} context
 * @returns {{ productGaps: object[], whatWorks: object[], flatProductGaps: object[], flatWhatWorks: object[] }}
 */
export function buildPass6Detail(drafts, context) {
  const ts = now();
  const productGaps = [];
  const whatWorks = [];
  const flatProductGaps = [];
  const flatWhatWorks = [];

  for (const row of drafts.productGaps || []) {
    const id = newId("productGap");
    const doc = {
      id,
      postCallId: context.postCallId,
      dealId: context.dealId,
      accountId: context.accountId,
      ownerId: context.ownerId,
      teamId: context.teamId,
      orgId: context.orgId,
      clusterId: null,
      createdAt: ts,
      updatedAt: ts,
      ...row,
    };
    productGaps.push(doc);
    flatProductGaps.push(doc);
  }

  for (const row of drafts.whatWorks || []) {
    const doc = {
      id: newId("whatWorks"),
      postCallId: context.postCallId,
      dealId: context.dealId,
      accountId: context.accountId,
      ownerId: context.ownerId,
      teamId: context.teamId,
      orgId: context.orgId,
      createdAt: ts,
      updatedAt: ts,
      ...row,
    };
    whatWorks.push(doc);
    flatWhatWorks.push(doc);
  }

  return { productGaps, whatWorks, flatProductGaps, flatWhatWorks };
}

/** Dedupe key for deal-level product signal rollup (verbatim-first). */
export function productSignalDedupeKey(row) {
  return String(row?.verbatim || row?.headline || row?.title || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 96);
}

/**
 * Merge product signal rows across calls on a deal; tag first surface per call.
 * @param {object[]} rows
 * @param {string|null|undefined} currentCallId
 */
export function rollupProductSignalRows(rows, currentCallId = null) {
  const sorted = [...(rows || [])].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  /** @type {Map<string, object>} */
  const byKey = new Map();
  for (const row of sorted) {
    const key = productSignalDedupeKey(row);
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, {
        ...row,
        firstSurfacedCallId: row.postCallId || null,
        firstSurfacedAt: row.createdAt || null,
      });
    }
  }
  return [...byKey.values()]
    .map((row) => ({
      ...row,
      surfacedOnThisCall: !!currentCallId && row.firstSurfacedCallId === currentCallId,
    }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** Collect pass 6 rows from local post-call history blobs. */
export function productSignalsFromHistoryRecords(records) {
  /** @type {object[]} */
  const productGaps = [];
  /** @type {object[]} */
  const whatWorks = [];
  const sorted = [...(records || [])].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  for (const rec of sorted) {
    const pass6 = rec?.pass6 || rec?.result?.pass6;
    if (!pass6) continue;
    const ts = rec.timestamp || Date.now();
    for (const g of pass6.productGaps || []) {
      productGaps.push({
        ...g,
        postCallId: g.postCallId || rec.id,
        dealId: g.dealId || rec.dealId || null,
        createdAt: g.createdAt || ts,
      });
    }
    for (const w of pass6.whatWorks || []) {
      whatWorks.push({
        ...w,
        postCallId: w.postCallId || rec.id,
        dealId: w.dealId || rec.dealId || null,
        createdAt: w.createdAt || ts,
      });
    }
  }
  return { productGaps, whatWorks };
}

/**
 * Deal-level product signals: store collections + history + this call, deduped.
 * @param {object} store
 * @param {string} dealId
 * @param {{ currentCallId?: string|null, callGaps?: object[], callWorks?: object[], historyRecords?: object[] }} [opts]
 */
export async function resolveDealProductSignals(store, dealId, opts = {}) {
  const { currentCallId = null, callGaps = [], callWorks = [], historyRecords = [] } = opts;
  /** @type {object[]} */
  const gapRows = [...callGaps];
  /** @type {object[]} */
  const workRows = [...callWorks];

  if (store?.listProductGapsByDeal) {
    try {
      gapRows.push(...(await store.listProductGapsByDeal(dealId, 500)));
    } catch {
      /* optional read path */
    }
  }
  if (store?.listWhatWorksByDeal) {
    try {
      workRows.push(...(await store.listWhatWorksByDeal(dealId, 500)));
    } catch {
      /* optional read path */
    }
  }

  const fromHistory = productSignalsFromHistoryRecords(historyRecords);
  gapRows.push(...fromHistory.productGaps);
  workRows.push(...fromHistory.whatWorks);

  const productGaps = rollupProductSignalRows(gapRows, currentCallId);
  const whatWorks = rollupProductSignalRows(workRows, currentCallId);

  return { productGaps, whatWorks, dealRollup: true };
}

/** Merge store-backed and history-derived deal product signals. */
export function mergeDealProductSignalExtras(storeExtras = {}, historyExtras = {}) {
  return {
    productGaps: rollupProductSignalRows([
      ...(storeExtras.productGaps || []),
      ...(historyExtras.productGaps || []),
    ]),
    whatWorks: rollupProductSignalRows([
      ...(storeExtras.whatWorks || []),
      ...(historyExtras.whatWorks || []),
    ]),
  };
}

/** Embed pass 6 rows on postCalls.detail for fast per-call reads. */
export async function embedPass6OnPostCallDetail(store, postCallId, built) {
  if (!store?.getPostCall || !store?.upsertPostCall || !postCallId) return;
  const postCall = await store.getPostCall(postCallId);
  if (!postCall) return;
  const detail = mergePostCallDetail(postCall.detail);
  setDetailArray(detail, "productGaps", built.productGaps || []);
  setDetailArray(detail, "whatWorks", built.whatWorks || []);
  await store.upsertPostCall({ ...postCall, detail, updatedAt: now() });
}

export async function persistPass6ProductGaps(store, drafts, context) {
  const built = buildPass6Detail(drafts, context);
  const saved = [];
  for (const doc of built.flatProductGaps) {
    saved.push(await store.upsertProductGap(doc));
  }
  for (const doc of built.flatWhatWorks) {
    await store.upsertWhatWorks(doc);
  }
  if (context.postCallId) {
    try {
      await embedPass6OnPostCallDetail(store, context.postCallId, built);
    } catch (err) {
      console.warn("[product-signal] postCall detail embed failed:", err?.message || err);
    }
  }
  if (saved.length && context.orgId) {
    await notifyGapClusteringPending(store, context.orgId, saved.length);
  }

  return { saved, ...built };
}

/**
 * Fire-and-forget clustering when threshold met (async pipeline).
 * @param {object} store
 * @param {string} [apiBase]
 * @param {string} orgId
 */
export async function maybeRunGapClusteringAfterPass6(store, orgId, apiBase = WORKER_BASE_URL) {
  if (!orgId) return { skipped: true, reason: "no_org" };
  try {
    return await runGapClusteringJob(store, apiBase, orgId, { mode: "auto" });
  } catch (err) {
    console.warn("[product-signal] clustering job failed:", err?.message || err);
    return { skipped: true, reason: "error", error: err?.message || String(err) };
  }
}

/**
 * PM publishes a draft cluster label (ADR-006).
 * @param {object} store
 * @param {string} clusterId
 * @param {string} label
 * @param {string} [taxonomyVersion]
 */
export async function publishGapCluster(store, clusterId, label, taxonomyVersion = "1.0") {
  if (!store?.getGapCluster || !store?.upsertGapCluster) {
    throw new Error("Store does not support gap clusters.");
  }
  const cluster = await store.getGapCluster(clusterId);
  if (!cluster) throw new Error("Cluster not found.");
  const ts = now();
  return store.upsertGapCluster({
    ...cluster,
    label: String(label || cluster.label || "").trim() || cluster.label,
    status: "published",
    taxonomyVersion,
    updatedAt: ts,
  });
}

/** Statuses where the filing SE has been told an outcome (spec §11.10 close the loop). */
export const LOOP_CLOSED_GAP_STATUSES = new Set([
  "published",
  "published_enablement",
  "dismissed",
  "merged",
]);

/** @param {string|null|undefined} status */
export function isGapLoopClosed(status) {
  return LOOP_CLOSED_GAP_STATUSES.has(status || "");
}

const AI_OPT_IN_THEMES = [
  {
    key: "deflection",
    label: "Deflection · volume they can't staff for",
    patterns: [/deflect/i, /volume/i, /staff/i, /headcount/i, /can't hire/i],
  },
  {
    key: "consolidation",
    label: "Consolidation · channels fragmented",
    patterns: [/consolid/i, /fragment/i, /channel/i, /inbox/i, /whatsapp.*email/i],
  },
  {
    key: "agent_speed",
    label: "Agent speed · Copilot shown in demo",
    patterns: [/copilot/i, /draft/i, /morning/i, /speed/i, /save.*team/i],
  },
  {
    key: "board_mandate",
    label: 'Board mandate · "we need an AI story"',
    patterns: [/board/i, /mandate/i, /ai story/i, /leadership/i, /executive/i],
  },
];

const AI_DECLINE_THEMES = [
  {
    key: "residency",
    label: "Data residency or compliance",
    patterns: [/residen/i, /compliance/i, /regulator/i, /gdpr/i, /singapore/i, /data outside/i],
  },
  {
    key: "knowledge",
    label: "Knowledge base isn't ready",
    patterns: [/knowledge/i, /\bkb\b/i, /confluence/i, /docs aren't/i, /not ready/i],
  },
  {
    key: "price",
    label: "Price of the add-on",
    patterns: [/price/i, /cost/i, /expensive/i, /budget/i, /add-on/i, /too much/i],
  },
  {
    key: "burned",
    label: "Burned by a previous bot",
    patterns: [/burn/i, /previous bot/i, /tried.*bot/i, /bad experience/i, /failed pilot/i],
  },
];

/** @param {unknown} slot */
function tcText(slot) {
  if (!slot) return "";
  if (typeof slot === "string") return slot.trim();
  if (typeof slot === "object" && slot && "value" in slot) return String(slot.value || "").trim();
  return "";
}

/** @param {Array<{ label: string, key: string, patterns: RegExp[] }>} themes @param {string} text */
export function classifyTextToTheme(themes, text) {
  const hay = String(text || "").toLowerCase();
  if (!hay) return null;
  for (const theme of themes) {
    if (theme.patterns.some((p) => p.test(hay))) return theme;
  }
  return null;
}

/** @param {object|null|undefined} aiAttach */
export function aiAttachIsOptedIn(aiAttach) {
  if (!aiAttach || typeof aiAttach !== "object") return false;
  if (typeof aiAttach.agentCount === "number" && aiAttach.agentCount > 0) return true;
  if (aiAttach.optedInAfterDemo === true) return true;
  const summary = String(aiAttach.summary || "").toLowerCase();
  return /\d+\s*\/\s*\d+/.test(summary) && !/0\s*\/\s*\d+/.test(summary);
}

/** AI was discussed or shown but customer did not attach. */
export function aiAttachIsDeclined(aiAttach) {
  if (!aiAttach || typeof aiAttach !== "object") return false;
  if (aiAttachIsOptedIn(aiAttach)) return false;
  const summary = String(aiAttach.summary || "").toLowerCase();
  const product = String(aiAttach.product || "").toLowerCase();
  return (
    product.includes("copilot") ||
    product.includes("agent") ||
    product.includes("ai") ||
    summary.includes("copilot") ||
    summary.includes("ai") ||
    summary.includes("shown") ||
    summary.includes("declined") ||
    summary.includes("0/")
  );
}

/**
 * @param {Array<{ label: string, count: number }>} buckets
 * @returns {Array<{ label: string, count: number, pct: number }>}
 */
export function themeBucketsWithPct(buckets) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (!total) return buckets.map((b) => ({ ...b, pct: 0 }));
  return buckets.map((b) => ({ ...b, pct: Math.round((b.count / total) * 100) }));
}

/**
 * Join reason-for-evaluation (opt-in) and why-AI / decline signals (spec §11.10).
 * @param {object[]} technicalCommits
 * @param {object[]} accounts
 */
export function aggregateAiAttachThemes(technicalCommits, accounts = []) {
  const accountMeta = new Map(
    accounts.map((a) => [
      a.id,
      {
        reason: tcText(a.metadata?.reason_for_evaluation || a.metadata?.reasonForEvaluation),
        whyAi: tcText(a.metadata?.why_ai || a.metadata?.whyAi),
      },
    ]),
  );

  const optInCounts = new Map(AI_OPT_IN_THEMES.map((t) => [t.key, 0]));
  const declineCounts = new Map(AI_DECLINE_THEMES.map((t) => [t.key, 0]));
  let optInDeals = 0;
  let declineDeals = 0;

  for (const tc of technicalCommits) {
    const meta = accountMeta.get(tc.accountId) || { reason: "", whyAi: "" };
    const reasonText = tcText(tc.reasonForEvaluation) || meta.reason;
    const whyText = tcText(tc.whyAi) || meta.whyAi;

    if (aiAttachIsOptedIn(tc.aiAttach)) {
      optInDeals += 1;
      const theme = classifyTextToTheme(AI_OPT_IN_THEMES, reasonText || whyText);
      if (theme) optInCounts.set(theme.key, (optInCounts.get(theme.key) || 0) + 1);
    } else if (aiAttachIsDeclined(tc.aiAttach) || whyText) {
      declineDeals += 1;
      const theme = classifyTextToTheme(AI_DECLINE_THEMES, whyText || reasonText || tcText(tc.identifiedRisk));
      if (theme) declineCounts.set(theme.key, (declineCounts.get(theme.key) || 0) + 1);
    }
  }

  const optIn = themeBucketsWithPct(
    AI_OPT_IN_THEMES.map((t) => ({ label: t.label, count: optInCounts.get(t.key) || 0 })).filter(
      (b) => b.count > 0,
    ),
  ).sort((a, b) => b.count - a.count);

  const decline = themeBucketsWithPct(
    AI_DECLINE_THEMES.map((t) => ({ label: t.label, count: declineCounts.get(t.key) || 0 })).filter(
      (b) => b.count > 0,
    ),
  ).sort((a, b) => b.count - a.count);

  return { optIn, decline, optInDeals, declineDeals };
}

/** @param {object[]} whatWorks */
export function aggregateWhatWorksClusters(whatWorks) {
  /** @type {Map<string, { labelKey: string, productArea: string, items: object[], accounts: Set<string>, refAccounts: Set<string> }>} */
  const byTheme = new Map();

  for (const row of whatWorks) {
    const area = row.productArea || "other";
    const verbatim = String(row.verbatim || "").trim();
    const labelKey = `${area}::${verbatim.slice(0, 64).toLowerCase()}`;
    if (!byTheme.has(labelKey)) {
      byTheme.set(labelKey, {
        labelKey,
        productArea: area,
        items: [],
        accounts: new Set(),
        refAccounts: new Set(),
      });
    }
    const bucket = byTheme.get(labelKey);
    bucket.items.push(row);
    if (row.accountId) bucket.accounts.add(row.accountId);
    if (row.referenceCandidate && row.accountId) bucket.refAccounts.add(row.accountId);
  }

  return [...byTheme.values()]
    .map((b) => ({
      label: b.items[0]?.verbatim?.split(/[.!?]/)[0]?.trim().slice(0, 80) || b.productArea,
      productArea: b.productArea,
      sampleVerbatim: b.items[0]?.verbatim || "",
      dealCount: b.accounts.size,
      referenceCount: b.refAccounts.size,
    }))
    .sort((a, b) => b.dealCount - a.dealCount);
}

/** @param {object} cluster @param {object[]} memberGaps */
export function resolveClusterRowMeta(cluster, memberGaps) {
  const gaps = memberGaps.length ? memberGaps : [];
  const enablementCount = gaps.filter((g) => g.gapType === "enablement_gap").length;
  const gapType = enablementCount > gaps.length / 2 ? "enablement_gap" : "real_gap";

  const statusPriority = [
    "published",
    "published_enablement",
    "in_review",
    "routed_enablement",
    "draft",
    "dismissed",
    "merged",
  ];
  let gapStatus = cluster.status === "published" ? "published" : "draft";
  for (const s of statusPriority) {
    if (gaps.some((g) => g.status === s)) {
      gapStatus = s;
      break;
    }
  }

  const competitorGap = gaps.find((g) => g.competitorNamed?.name);
  const blockerGap = gaps.find((g) => g.disposition === "hard_blocker" || g.dealImpact === "blocker");

  return {
    gapType,
    gapStatus,
    competitor: competitorGap?.competitorNamed || null,
    disposition: blockerGap?.disposition || gaps[0]?.disposition || null,
    dealImpact: blockerGap?.dealImpact || gaps[0]?.dealImpact || null,
  };
}

/**
 * Surface when a cross-cutting tag (e.g. data_residency) appears in both gap clusters and AI decline.
 * @param {object|null} topCluster
 * @param {Array<{ label: string, pct: number, count: number }>} declineThemes
 * @param {object[]} residencyGaps
 * @param {(n: number|null|undefined) => string} formatUsd
 */
export function buildAiResidencyJoinInsight(topCluster, declineThemes, residencyGaps, formatUsd) {
  const topDecline = declineThemes[0];
  const hasResidencyDecline =
    topDecline?.label?.toLowerCase().includes("residency") ||
    topDecline?.label?.toLowerCase().includes("compliance");
  const clusterHasResidency = topCluster?.crossCuttingTags?.includes("data_residency");
  const residencyArr =
    topCluster?.crossCuttingTags?.includes("data_residency") && topCluster.arrTotal
      ? topCluster.arrTotal
      : residencyGaps.reduce((s, g) => s + (g.arrTouched || 0), 0);

  if (!hasResidencyDecline || (!clusterHasResidency && !residencyGaps.length)) return null;

  const arrText = residencyArr ? formatUsd(residencyArr) : "significant ARR";
  return `Residency alone is ${arrText} blocked. same root cause as the top gap above. Two axes in the taxonomy is what lets those two facts meet.`;
}

/**
 * @param {object} store
 * @param {string} orgId
 */
export async function loadProductSignalDashboard(store, orgId) {
  const [clusters, gaps, whatWorks, technicalCommits, state, postCalls] = await Promise.all([
    store.listGapClustersByOrg(orgId, 200),
    store.listProductGapsByOrg(orgId, 2000),
    store.listWhatWorksByOrg ? store.listWhatWorksByOrg(orgId, 2000) : [],
    store.listTechnicalCommitsByOrg ? store.listTechnicalCommitsByOrg(orgId, 500) : [],
    store.getClusteringState?.(orgId),
    store.listPostCallsByOrg ? store.listPostCallsByOrg(orgId, 500) : [],
  ]);

  let accounts = [];
  if (store.listAccounts) {
    const all = await store.listAccounts();
    const accountIds = new Set([
      ...gaps.map((g) => g.accountId).filter(Boolean),
      ...technicalCommits.map((t) => t.accountId).filter(Boolean),
    ]);
    accounts = all.filter((a) => accountIds.has(a.id));
  }

  const gapsByCluster = new Map();
  for (const g of gaps) {
    if (!g.clusterId) continue;
    if (!gapsByCluster.has(g.clusterId)) gapsByCluster.set(g.clusterId, []);
    gapsByCluster.get(g.clusterId).push(g);
  }

  const sortedClusters = [...clusters].sort((a, b) => (b.arrTotal || 0) - (a.arrTotal || 0));
  const clusterRows = sortedClusters.map((c) => {
    const members = gapsByCluster.get(c.id) || [];
    const sample = members[0]?.verbatim || "";
    return { cluster: c, members, sampleVerbatim: sample, meta: resolveClusterRowMeta(c, members) };
  });

  const rawGapCount = gaps.filter((g) => g.status !== "dismissed" && g.status !== "merged").length;
  const distinctClusters = sortedClusters.filter((c) => c.status !== "archived").length;
  const realGaps = gaps.filter(
    (g) => g.gapType === "real_gap" && g.status !== "dismissed" && g.status !== "merged",
  );
  const enablementGaps = gaps.filter((g) => g.gapType === "enablement_gap");
  const hardBlockers = gaps.filter(
    (g) =>
      g.gapType === "real_gap" &&
      (g.disposition === "hard_blocker" || g.dealImpact === "blocker") &&
      g.status !== "dismissed" &&
      g.status !== "merged",
  );
  const blockerArr = hardBlockers.reduce((s, g) => s + (g.arrTouched || 0), 0);
  const loopClosed = gaps.filter((g) => isGapLoopClosed(g.status)).length;
  const publishedArr = sortedClusters
    .filter((c) => c.status === "published")
    .reduce((s, c) => s + (c.arrTotal || 0), 0);
  const dealIdsWithGaps = new Set(realGaps.map((g) => g.dealId).filter(Boolean));

  const workingRows = aggregateWhatWorksClusters(whatWorks);
  const aiThemes = aggregateAiAttachThemes(technicalCommits, accounts);
  const residencyGaps = gaps.filter(
    (g) =>
      g.crossCuttingTags?.includes("data_residency") &&
      g.gapType === "real_gap" &&
      g.status !== "dismissed" &&
      g.status !== "merged",
  );

  return {
    clusters: sortedClusters,
    gaps,
    whatWorks,
    gapsByCluster,
    clusterRows,
    workingRows,
    aiThemes,
    residencyGaps,
    topCluster: sortedClusters[0] || null,
    summary: {
      distinctClusters,
      rawGapCount,
      arrTouched: publishedArr || sortedClusters.reduce((s, c) => s + (c.arrTotal || 0), 0),
      dealCount: dealIdsWithGaps.size,
      hardBlockerCount: hardBlockers.length,
      blockerArr,
      enablementCount: enablementGaps.length,
      loopClosed,
      callCount: postCalls.length,
    },
    clusteringState: state,
  };
}
