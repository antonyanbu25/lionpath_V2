/**
 * Deal / opportunity on an account — canonical pipeline stage (ADR-003).
 */

import { getStore } from "./store.js";
import { newId, now, stageAfterFirstPostCall, can } from "./types.js";
import { sessionUserId } from "./session.js";
import { resolveEngagementMotion, resolveDealOwnerId } from "./deal-motion.js";

/** @type {Record<import("./types.js").DealType, string>} */
export const DEAL_TYPE_LABELS = {
  new_business: "New business",
  expansion: "Expansion",
};

/** Legacy/default titles that should be upgraded to the "<Account> - Deal N - <date>" scheme. */
const LEGACY_DEAL_TITLES = new Set(["New business", "Expansion", "Account"]);

/** @param {string} [title] */
export function isLegacyDealTitle(title) {
  const s = String(title || "").trim();
  return !s || LEGACY_DEAL_TITLES.has(s);
}

/** yyyy-mm-dd for a deal's creation date (falls back to now). */
function dealDateStr(ts) {
  const d = new Date(ts || now());
  return Number.isNaN(d.getTime()) ? new Date(now()).toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

/**
 * Sequence number of a deal within its account (1-based, ordered by creation).
 * For a not-yet-created deal (no dealId), returns count + 1.
 * @param {string} accountId
 * @param {string|null} [dealId]
 */
async function dealSequenceNumber(accountId, dealId = null) {
  const store = getStore();
  const deals = store.listDealsByAccount ? await store.listDealsByAccount(accountId) : [];
  const sorted = [...deals].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  if (dealId) {
    const idx = sorted.findIndex((d) => d.id === dealId);
    if (idx >= 0) return idx + 1;
  }
  return sorted.length + 1;
}

/**
 * Build the canonical deal title: "<Account> - Deal <N> - <yyyy-mm-dd>".
 * @param {string} accountId
 * @param {{ account?: object, dealId?: string|null, createdAt?: number }} [opts]
 */
export async function nextDealTitle(accountId, opts = {}) {
  const store = getStore();
  const account = opts.account || (store.getAccount ? await store.getAccount(accountId) : null);
  const name = account?.name || account?.slug || "Account";
  const n = await dealSequenceNumber(accountId, opts.dealId || null);
  return `${name} - Deal ${n} - ${dealDateStr(opts.createdAt)}`;
}

/**
 * Pick an explicit meaningful title, else generate the canonical scheme.
 * A title that merely echoes the account name/slug (as the lifecycle title does)
 * is treated as non-meaningful and upgraded to "<Account> - Deal N - <date>".
 */
async function resolveNewDealTitle(accountId, title, createdAt) {
  const store = getStore();
  const account = store.getAccount ? await store.getAccount(accountId) : null;
  const name = account?.name || account?.slug || "Account";
  const t = String(title || "").trim();
  const meaningful = t && !isLegacyDealTitle(t) && t !== name && t !== account?.slug;
  if (meaningful) return t;
  return nextDealTitle(accountId, { account, createdAt });
}

/**
 * Lazily upgrade a legacy-titled deal ("New business"/"Expansion") to the new
 * scheme on read, persisting the rename once. Returns the (possibly updated) deal.
 * @param {object} deal
 */
export async function ensureDealTitle(deal) {
  if (!deal || !isLegacyDealTitle(deal.title)) return deal;
  const store = getStore();
  const title = await nextDealTitle(deal.accountId, { dealId: deal.id, createdAt: deal.createdAt });
  if (title === deal.title) return deal;
  try {
    const updated = await store.updateDeal(deal.id, { title });
    return updated || { ...deal, title };
  } catch {
    return { ...deal, title };
  }
}

/** Mirror deal counters/stage onto linked lifecycle if present. */
async function syncLifecycleFromDeal(deal, extraPatch = {}) {
  const store = getStore();
  const lc = await store.findLifecycleByDealAndOwner(deal.id, deal.ownerId);
  if (!lc) return;
  await store.updateLifecycle(lc.id, {
    stage: deal.stage,
    prepCount: deal.prepCount,
    postCallCount: deal.postCallCount,
    openTaskCount: deal.openTaskCount,
    latestQualityScore: deal.latestQualityScore,
    lastActivityAt: deal.lastActivityAt,
    dealId: deal.id,
    ...extraPatch,
  });
}

/**
 * @param {string} accountId
 * @param {string} ownerId
 * @param {string} teamId
 * @param {string|null} orgId
 * @param {{ title?: string, primaryContactId?: string|null, type?: import("./types.js").DealType }} [opts]
 */
export async function getOrCreateNewBusinessDeal(accountId, ownerId, teamId, orgId, opts = {}) {
  const store = getStore();
  const existing = await store.findActiveDeal(accountId, "new_business");
  if (existing) return existing;

  const dealOwnerId = opts.dealOwnerId || (await resolveDealOwnerId(accountId, ownerId));
  const ts = now();
  return store.createDeal({
    id: newId("deal"),
    accountId,
    type: opts.type || "new_business",
    stage: "research",
    status: "active",
    ownerId: dealOwnerId,
    teamId,
    orgId: orgId || null,
    primaryContactId: opts.primaryContactId ?? null,
    title: await resolveNewDealTitle(accountId, opts.title, ts),
    prepCount: 0,
    postCallCount: 0,
    openTaskCount: 0,
    latestQualityScore: null,
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
  });
}

/**
 * @param {string} accountId
 * @param {string} ownerId
 * @param {string} teamId
 * @param {string|null} orgId
 * @param {{ title?: string, primaryContactId?: string|null }} [opts]
 */
export async function createExpansionDeal(accountId, ownerId, teamId, orgId, opts = {}) {
  const store = getStore();
  const existing = await store.findActiveDeal(accountId, "expansion");
  if (existing) return existing;

  const dealOwnerId = opts.dealOwnerId || (await resolveDealOwnerId(accountId, ownerId));
  const ts = now();
  return store.createDeal({
    id: newId("deal"),
    accountId,
    type: "expansion",
    stage: "research",
    status: "active",
    ownerId: dealOwnerId,
    teamId,
    orgId: orgId || null,
    primaryContactId: opts.primaryContactId ?? null,
    title: await resolveNewDealTitle(accountId, opts.title, ts),
    prepCount: 0,
    postCallCount: 0,
    openTaskCount: 0,
    latestQualityScore: null,
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
  });
}

/** @param {string} accountId @param {string} [ownerId] */
export async function listDealsForAccount(accountId, ownerId) {
  const store = getStore();
  if (!accountId || !store.listDealsByAccount) return [];
  const deals = await store.listDealsByAccount(accountId, ownerId);
  return Promise.all(deals.map((d) => ensureDealTitle(d)));
}

/** @param {string} dealId */
export async function getDeal(dealId) {
  const store = getStore();
  const deal = await store.getDeal(dealId);
  return deal ? ensureDealTitle(deal) : deal;
}

/**
 * @param {string} dealId
 * @param {import("./types.js").LifecycleStage} toStage
 * @param {string} actorId
 */
export async function advanceDealStage(dealId, toStage, actorId) {
  const store = getStore();
  const deal = await store.getDeal(dealId);
  if (!deal || deal.stage === toStage) return deal;

  const ts = now();
  const updated = await store.updateDeal(dealId, {
    stage: toStage,
    lastActivityAt: ts,
  });
  await syncLifecycleFromDeal(updated);

  const lc = await store.findLifecycleByDealAndOwner(dealId, deal.ownerId);
  if (lc) {
    await store.addLifecycleEvent({
      id: newId("event"),
      lifecycleId: lc.id,
      type: "stage_changed",
      actorId,
      timestamp: ts,
      payload: { fromStage: deal.stage, toStage, dealId },
    });
  }

  return updated;
}

/**
 * @param {string} dealId
 * @param {string} actorId
 * @param {{ stage?: import("./types.js").LifecycleStage }} [opts]
 */
export async function archiveDeal(dealId, actorId, opts = {}) {
  const store = getStore();
  const deal = await store.getDeal(dealId);
  if (!deal || deal.status === "archived") return deal;

  const ts = now();
  const stage = opts.stage || deal.stage;
  const updated = await store.updateDeal(dealId, {
    status: "archived",
    stage,
    lastActivityAt: ts,
  });
  await syncLifecycleFromDeal(updated, { status: "archived" });

  const lc = await store.findLifecycleByDealAndOwner(dealId, deal.ownerId);
  if (lc && lc.status === "active") {
    const { archiveLifecycle } = await import("./lifecycle-service.js");
    await archiveLifecycle(lc.id, actorId, "deal_archived");
  }

  return updated;
}

/** Increment deal counters after artifact attach; lifecycle mirrors via sync. */
export async function bumpDealAfterPrep(dealId, patch = {}) {
  const store = getStore();
  const deal = await store.getDeal(dealId);
  if (!deal) return null;
  const ts = now();
  const updated = await store.updateDeal(dealId, {
    prepCount: (deal.prepCount || 0) + 1,
    lastActivityAt: ts,
    primaryContactId: deal.primaryContactId || patch.primaryContactId || null,
    ...patch,
  });
  await syncLifecycleFromDeal(updated);
  return updated;
}

export async function bumpDealAfterPostCall(dealId, { isNew, stage }) {
  const store = getStore();
  const deal = await store.getDeal(dealId);
  if (!deal) return null;
  const ts = now();
  /** @type {Partial<import("./types.js").Deal>} */
  const dealPatch = {
    lastActivityAt: ts,
  };
  if (isNew) {
    dealPatch.postCallCount = (deal.postCallCount || 0) + 1;
    dealPatch.stage = stage ?? stageAfterFirstPostCall(deal.stage);
  }
  const updated = await store.updateDeal(dealId, dealPatch);
  await syncLifecycleFromDeal(updated);
  return updated;
}

/**
 * Pass 8 traction rollup after post-call — writes one deal_signals row per call.
 * Invoked from dual-write once Pass 4/5/7 inputs are persisted (same lifecycle as bumpDealAfterPostCall).
 * @param {string} dealId
 * @param {object} ctx
 */
export async function rollupDealTractionAfterPostCall(dealId, ctx) {
  const { computeAndPersistDealSignal } = await import("./deal-traction-service.js");
  return computeAndPersistDealSignal(dealId, ctx);
}

/**
 * Post-call ARR persist (task 2.5b) — arr_lines, Deal estimate columns, call arrSnapshot.
 * Invoked from dual-write once compute output is available (same lifecycle as bumpDealAfterPostCall).
 * @param {string} dealId
 * @param {object} computeResult runPostCallArrCompute output
 * @param {object} ctx
 */
export async function persistArrAfterPostCall(dealId, computeResult, ctx) {
  const { persistArrAfterPostCall: persist } = await import("./arr-service.js");
  return persist(dealId, computeResult, ctx);
}

/**
 * Pass 9 summaries after post-call — rewrites dealSummaries + accountSummaries.
 * @param {string|null} dealId
 * @param {string} accountId
 * @param {object} ctx
 */
export async function regenerateSummariesAfterPostCall(dealId, accountId, ctx) {
  const { regenerateDealAndAccountSummaries } = await import("./summaries-service.js");
  return regenerateDealAndAccountSummaries(dealId, accountId, ctx);
}

export async function bumpDealAfterTask(dealId) {
  const store = getStore();
  const deal = await store.getDeal(dealId);
  if (!deal) return null;
  const ts = now();
  const updated = await store.updateDeal(dealId, {
    openTaskCount: (deal.openTaskCount || 0) + 1,
    lastActivityAt: ts,
  });
  await syncLifecycleFromDeal(updated);
  return updated;
}

/**
 * Backfill deal for legacy lifecycle missing dealId.
 * @param {import("./types.js").Lifecycle} lifecycle
 */
export async function ensureDealForLifecycle(lifecycle) {
  if (lifecycle.dealId) {
    const store = getStore();
    const deal = await store.getDeal(lifecycle.dealId);
    if (deal) return deal;
  }

  const store = getStore();
  const existingNb = await store.findActiveDeal(lifecycle.accountId, "new_business");
  if (existingNb) {
    await store.updateLifecycle(lifecycle.id, { dealId: existingNb.id });
    return existingNb;
  }

  const dealOwnerId = await resolveDealOwnerId(lifecycle.accountId, lifecycle.ownerId);
  const ts = now();
  const deal = await store.createDeal({
    id: newId("deal"),
    accountId: lifecycle.accountId,
    type: "new_business",
    stage: lifecycle.stage,
    status: lifecycle.status,
    ownerId: dealOwnerId,
    teamId: lifecycle.teamId,
    orgId: lifecycle.orgId || null,
    primaryContactId: lifecycle.primaryContactId,
    title: await resolveNewDealTitle(lifecycle.accountId, lifecycle.title, lifecycle.createdAt || ts),
    prepCount: lifecycle.prepCount || 0,
    postCallCount: lifecycle.postCallCount || 0,
    openTaskCount: lifecycle.openTaskCount || 0,
    latestQualityScore: lifecycle.latestQualityScore,
    createdAt: lifecycle.createdAt || ts,
    updatedAt: ts,
    lastActivityAt: lifecycle.lastActivityAt || ts,
  });
  await store.updateLifecycle(lifecycle.id, { dealId: deal.id });
  return deal;
}

/**
 * Resolve deal for prep/post-call (NB or expansion).
 * @param {string} accountId
 * @param {string} ownerId
 * @param {string} teamId
 * @param {string|null} orgId
 * @param {{ prepType?: string, dealId?: string|null, title?: string, primaryContactId?: string|null }} opts
 */
export async function resolveDealForEngagement(accountId, ownerId, teamId, orgId, opts = {}) {
  const store = getStore();
  if (opts.dealId) {
    const deal = await store.getDeal(opts.dealId);
    if (deal && deal.accountId === accountId) return deal;
  }

  const motion = await resolveEngagementMotion(accountId, ownerId, {
    explicitDealId: opts.dealId,
    explicitPrepType: opts.prepType,
    useSessionContext: opts.useSessionContext !== false,
  });

  if (motion.dealId) {
    const deal = await store.getDeal(motion.dealId);
    if (deal && deal.accountId === accountId) return deal;
  }

  const prepType = motion.prepType;
  const dealOwnerId = await resolveDealOwnerId(accountId, ownerId);
  const common = {
    title: opts.title,
    primaryContactId: opts.primaryContactId,
    dealOwnerId,
  };

  if (prepType === "expansion") {
    return createExpansionDeal(accountId, ownerId, teamId, orgId, common);
  }
  return getOrCreateNewBusinessDeal(accountId, ownerId, teamId, orgId, common);
}

/**
 * NB → expansion handoff.
 * @param {object} session
 * @param {string} accountId
 * @param {{ targetOwnerId?: string }} [opts]
 */
export async function handoffToExpansion(session, accountId, opts = {}) {
  const store = getStore();
  const actorId = sessionUserId(session);
  const user = actorId ? await store.getUser(actorId) : null;
  if (!actorId || !user || !accountId) {
    return { success: false, error: "Not signed in" };
  }

  const account = await store.getAccount(accountId);
  if (!account) return { success: false, error: "Account not found" };

  const teamLifecycles = await store.listActiveLifecyclesForAccount(accountId);
  const memberIds = (account.seTeam || []).map((m) => m.seUserId);
  const primaryId = account.primarySeUserId || memberIds[0] || actorId;
  const targetOwnerId = opts.targetOwnerId || primaryId;

  const canHandoff =
    actorId === primaryId ||
    can(user, "manage_account_team", {
      seTeamUserIds: memberIds,
      accountOrgId: user.orgId,
      teamId: user.teamId || undefined,
    }) ||
    user.role === "admin";
  if (!canHandoff) return { success: false, error: "Not allowed to hand off account" };

  const nbDeal = await store.findActiveDeal(accountId, "new_business");
  if (nbDeal) {
    await archiveDeal(nbDeal.id, actorId, { stage: "closed_won" });
  }

  for (const lc of teamLifecycles) {
    if (lc.status === "active" && (!nbDeal || lc.dealId === nbDeal.id || !lc.dealId)) {
      const { archiveLifecycle } = await import("./lifecycle-service.js");
      await archiveLifecycle(lc.id, actorId, "handoff_to_expansion");
    }
  }

  await store.updateAccount(accountId, {
    programPhase: "expansion",
    updatedAt: now(),
  });

  const teamId = user.teamId || session.teamId;
  const orgId = user.orgId || session.orgId || null;
  const expansionDeal = await createExpansionDeal(accountId, targetOwnerId, teamId, orgId, {
    title: `${account.name || "Account"}. Expansion`,
    primaryContactId: nbDeal?.primaryContactId ?? null,
  });

  const { getOrCreateLifecycle } = await import("./lifecycle-service.js");
  const lifecycle = await getOrCreateLifecycle(targetOwnerId, accountId, teamId, {
    dealId: expansionDeal.id,
    title: expansionDeal.title,
    primaryContactId: expansionDeal.primaryContactId,
    actorId,
    orgId,
  });

  return { success: true, expansionDeal, lifecycle, accountId };
}
