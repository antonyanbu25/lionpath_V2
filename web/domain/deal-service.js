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

/** Legacy/default titles upgraded to "<Company> - New Business|Expansion - <date>". */
const LEGACY_DEAL_TITLES = new Set(["New business", "Expansion", "Account"]);

const OLD_DEAL_N_RE = / - Deal \d+ - \d{4}-\d{2}-\d{2}$/;
const NEW_BUSINESS_DATED_RE = / - New Business - \d{4}-\d{2}-\d{2}$/;
const EXPANSION_DATED_RE = / - Expansion - \d{4}-\d{2}-\d{2}$/;

/** @param {import("./types.js").DealType} [dealType] */
export function dealTypeTitleSegment(dealType) {
  return dealType === "expansion" ? "Expansion" : "New Business";
}

/**
 * @param {string} [title]
 * @param {string} [accountName]
 */
export function isLegacyDealTitle(title, accountName) {
  const s = String(title || "").trim();
  const name = String(accountName || "").trim();
  if (!s) return true;
  if (LEGACY_DEAL_TITLES.has(s)) return true;
  if (name && (s === name || s === `${name} — New Business` || s === `${name} - New Business`)) return true;
  if (OLD_DEAL_N_RE.test(s)) return true;
  if (/ — (New Business|Expansion)$/.test(s)) return true;
  if (/ - New Business$/.test(s) && !NEW_BUSINESS_DATED_RE.test(s)) return true;
  if (/ - Expansion$/.test(s) && !EXPANSION_DATED_RE.test(s)) return true;
  return false;
}

/** yyyy-mm-dd for a deal's creation date (falls back to now). */
function dealDateStr(ts) {
  const d = new Date(ts || now());
  return Number.isNaN(d.getTime()) ? new Date(now()).toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

/**
 * Sync preview for UI (pre-call deal card) — mirrors nextDealTitle without store I/O.
 * @param {string} [accountName]
 * @param {import("./types.js").DealType} [dealType]
 * @param {number} [createdAt]
 */
export function formatDealTitlePreview(accountName, dealType = "new_business", createdAt) {
  const name = String(accountName || "Account").trim() || "Account";
  return `${name} - ${dealTypeTitleSegment(dealType)} - ${dealDateStr(createdAt)}`;
}

/**
 * Build the canonical deal title: "<Company> - New Business|Expansion - <yyyy-mm-dd>".
 * @param {string} accountId
 * @param {{ account?: object, dealType?: import("./types.js").DealType, createdAt?: number }} [opts]
 */
export async function nextDealTitle(accountId, opts = {}) {
  const store = getStore();
  const account = opts.account || (store.getAccount ? await store.getAccount(accountId) : null);
  const name = account?.name || account?.slug || "Account";
  const segment = dealTypeTitleSegment(opts.dealType || "new_business");
  return `${name} - ${segment} - ${dealDateStr(opts.createdAt)}`;
}

/**
 * Pick an explicit meaningful title, else generate the canonical scheme.
 * A title that merely echoes the account name/slug (as the lifecycle title does)
 * is treated as non-meaningful and upgraded to "<Company> - New Business|Expansion - <date>".
 * @param {import("./types.js").DealType} dealType
 */
async function resolveNewDealTitle(accountId, title, createdAt, dealType = "new_business") {
  const store = getStore();
  const account = store.getAccount ? await store.getAccount(accountId) : null;
  const name = account?.name || account?.slug || "Account";
  const t = String(title || "").trim();
  const meaningful = t && !isLegacyDealTitle(t, name) && t !== name && t !== account?.slug;
  if (meaningful) return t;
  return nextDealTitle(accountId, { account, createdAt, dealType });
}

/**
 * Lazily upgrade legacy deal titles on read, persisting the rename once.
 * @param {object} deal
 */
export async function ensureDealTitle(deal) {
  if (!deal) return deal;
  const store = getStore();
  const account = store.getAccount ? await store.getAccount(deal.accountId) : null;
  const name = account?.name || account?.slug || "Account";
  if (!isLegacyDealTitle(deal.title, name)) return deal;
  const title = await nextDealTitle(deal.accountId, {
    createdAt: deal.createdAt,
    dealType: deal.type || "new_business",
    account,
  });
  if (title === deal.title) return deal;
  try {
    const updated = await store.updateDeal(deal.id, { title });
    return updated || { ...deal, title };
  } catch {
    return { ...deal, title };
  }
}

/**
 * One person's link to one deal, as accepted by deal contact linking here.
 * @typedef {{ contactId: string, role?: import("./types.js").DealContactRole|null, isPrimary?: boolean }} DealContactLink
 */

/**
 * Collapse a caller's contact list to unique contacts with exactly one primary.
 *
 * `primaryContactId` wins the primary flag because it is the same value written into
 * `Deal.primaryContactId` — letting a different contact win here makes the join and pointer disagree.
 *
 * `role: null` means "caller did not say" — kept distinct from "unknown" so we preserve a
 * role already recorded on an existing join row (see linkDealContacts).
 *
 * @param {(DealContactLink|string)[]} [contacts]
 * @param {string|null} [primaryContactId]
 * @returns {DealContactLink[]}
 */
function normalizeContactLinks(contacts, primaryContactId = null) {
  /** @type {Map<string, DealContactLink>} */
  const byId = new Map();
  for (const entry of contacts || []) {
    const isStr = typeof entry === "string";
    const contactId = String((isStr ? entry : entry?.contactId) || "").trim();
    if (!contactId || byId.has(contactId)) continue;
    byId.set(contactId, {
      contactId,
      role: isStr ? null : entry?.role || null,
      isPrimary: isStr ? false : !!entry?.isPrimary,
    });
  }

  const explicitPrimary = String(primaryContactId || "").trim();
  if (explicitPrimary && !byId.has(explicitPrimary)) {
    byId.set(explicitPrimary, { contactId: explicitPrimary, role: null, isPrimary: true });
  }

  const list = [...byId.values()];
  const winner = explicitPrimary || list.find((l) => l.isPrimary)?.contactId || null;
  return list.map((l) => ({ ...l, isPrimary: !!winner && l.contactId === winner }));
}

/**
 * Write the `dealContacts` join rows for a deal and keep `Deal.primaryContactId` in step.
 *
 * Writes always go join-first, then patch the pointer. Repointing is backfill-only: a deal that
 * already names a primary keeps it, and the incoming contact is linked as non-primary.
 *
 * @param {object|null} deal
 * @param {DealContactLink[]} links already normalized by normalizeContactLinks
 * @returns {Promise<object|null>} the deal, re-patched if the pointer moved
 */
async function linkDealContacts(deal, links) {
  if (!deal?.id || !links?.length) return deal;
  const store = getStore();
  if (typeof store.createDealContact !== "function") return deal;

  const nominatesPrimary = links.some((l) => l.isPrimary);
  let requestedPrimary = null;
  for (const link of links) {
    try {
      const prev = store.findDealContact ? await store.findDealContact(deal.id, link.contactId) : null;
      await store.createDealContact({
        dealId: deal.id,
        contactId: link.contactId,
        accountId: deal.accountId,
        role: link.role || prev?.role || "unknown",
        isPrimary: link.isPrimary || (!!prev?.isPrimary && !nominatesPrimary),
      });
      if (link.isPrimary && !requestedPrimary) requestedPrimary = link.contactId;
    } catch (err) {
      console.warn("[deal-service] deal contact link failed:", err?.message || err);
    }
  }

  if (!requestedPrimary) return deal;

  const currentPrimary = deal.primaryContactId || null;
  const primaryContactId = currentPrimary || requestedPrimary;

  if (currentPrimary && currentPrimary !== requestedPrimary) {
    try {
      await store.createDealContact({
        dealId: deal.id,
        contactId: requestedPrimary,
        accountId: deal.accountId,
        role: links.find((l) => l.contactId === requestedPrimary)?.role || "unknown",
        isPrimary: false,
      });
      const pointerRow = store.findDealContact
        ? await store.findDealContact(deal.id, currentPrimary)
        : null;
      if (!pointerRow) {
        await store.createDealContact({
          dealId: deal.id,
          contactId: currentPrimary,
          accountId: deal.accountId,
          role: "unknown",
          isPrimary: true,
        });
      }
    } catch (err) {
      console.warn("[deal-service] deal contact reconcile failed:", err?.message || err);
    }
  }

  try {
    if (store.setPrimaryDealContact) await store.setPrimaryDealContact(deal.id, primaryContactId);
  } catch (err) {
    console.warn("[deal-service] set primary deal contact failed:", err?.message || err);
  }

  if (primaryContactId === currentPrimary) return deal;
  try {
    const updated = await store.updateDeal(deal.id, { primaryContactId });
    return updated || { ...deal, primaryContactId };
  } catch (err) {
    console.warn("[deal-service] primaryContactId backfill failed:", err?.message || err);
    return { ...deal, primaryContactId };
  }
}

/**
 * Link contacts to an existing deal by id — the public route to the join for callers that
 * already have a deal and are not creating or bumping one (dual-write prep/post-call paths).
 *
 * @param {string|null} dealId
 * @param {{ contacts?: DealContactLink[], primaryContactId?: string|null }} [opts]
 * @returns {Promise<object|null>} the deal, re-patched if the pointer moved
 */
export async function linkContactsToDealRecord(dealId, opts = {}) {
  if (!dealId || !opts.contacts?.length) return null;
  const store = getStore();
  const deal = await store.getDeal(dealId);
  if (!deal) return null;
  return linkDealContacts(deal, normalizeContactLinks(opts.contacts, opts.primaryContactId));
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
    title: await resolveNewDealTitle(accountId, opts.title, ts, "new_business"),
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
    title: await resolveNewDealTitle(accountId, opts.title, ts, "expansion"),
    prepCount: 0,
    postCallCount: 0,
    openTaskCount: 0,
    latestQualityScore: null,
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
  });
}

/** Infer deal type from user-authored title segments. */
export function inferDealTypeFromTitle(title) {
  const t = String(title || "");
  if (/\s-\sExpansion(\s-\s|\s*$)/i.test(t)) return "expansion";
  return "new_business";
}

/**
 * Always create a new deal (post-call intake "+ New deal") — never reuse an existing active deal.
 * @param {import("./types.js").DealType} [opts.type]
 */
export async function createDealWithExplicitTitle(accountId, ownerId, teamId, orgId, opts = {}) {
  const dealOwnerId = opts.dealOwnerId || (await resolveDealOwnerId(accountId, ownerId));
  const ts = now();
  const dealType = opts.type || inferDealTypeFromTitle(opts.title) || "new_business";
  const explicit = String(opts.title || "").trim();
  const title = explicit || (await resolveNewDealTitle(accountId, opts.accountName, ts, dealType));
  const store = getStore();
  return store.createDeal({
    id: newId("deal"),
    accountId,
    type: dealType,
    stage: "research",
    status: "active",
    ownerId: dealOwnerId,
    teamId,
    orgId: orgId || null,
    primaryContactId: opts.primaryContactId ?? null,
    title,
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
 * All opportunities on an account (global — any SE's deal on the account).
 * Deals are account-scoped, not owner-scoped, so post-call / prep can link to the same opp.
 * @param {string} accountId
 */
export async function listDealsForAccount(accountId, opts = {}) {
  const store = getStore();
  if (!accountId || !store.listDealsByAccount) return [];
  const deals = await store.listDealsByAccount(accountId, null, opts);
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
    title: await resolveNewDealTitle(
      lifecycle.accountId,
      lifecycle.title,
      lifecycle.createdAt || ts,
      "new_business",
    ),
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
