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

/**
 * One person's link to one deal, as accepted by every deal-creating function here.
 * @typedef {{ contactId: string, role?: import("./types.js").DealContactRole|null, isPrimary?: boolean }} DealContactLink
 */

/**
 * Collapse a caller's contact list to unique contacts with exactly one primary.
 *
 * `primaryContactId` (the legacy opt, still passed by lifecycle/prep callers) wins the primary
 * flag, because it is the same value the caller writes into `Deal.primaryContactId` — letting a
 * different contact win here is what would make the join and the pointer disagree.
 *
 * `role: null` means "caller did not say" — kept distinct from "unknown" so we can preserve a
 * role already recorded on an existing join row instead of flattening it (see linkDealContacts).
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
 * Two representations of "who is on this deal" exist on purpose — this is the Salesforce
 * shape (`OpportunityContactRole` + `Opportunity.Primary_Contact__c`):
 *   - `dealContacts` is AUTHORITATIVE. One row per person per deal, carrying the buying-committee
 *     role and the single `isPrimary` flag. Read this for a deal's contact panel.
 *   - `Deal.primaryContactId` is a DENORMALISED cache of that one primary row, kept only because
 *     deal cards / prep / lifecycle read it synchronously off the deal doc.
 * So writes always go join-first, then patch the pointer. Never patch the pointer alone.
 *
 * Repointing is backfill-only: a deal that already names a primary keeps it, and the incoming
 * contact is linked as non-primary. Overwriting an SE-confirmed primary from a background
 * post-call path would be a silent data loss, and the join still records the new person.
 *
 * @param {object|null} deal
 * @param {DealContactLink[]} links already normalized by normalizeContactLinks
 * @returns {Promise<object|null>} the deal, re-patched if the pointer moved
 */
async function linkDealContacts(deal, links) {
  if (!deal?.id || !links?.length) return deal;
  const store = getStore();
  // Stores gain the whole dealContacts API together; an older store must not fail a deal
  // create/bump that has already succeeded.
  if (typeof store.createDealContact !== "function") return deal;

  const nominatesPrimary = links.some((l) => l.isPrimary);
  let requestedPrimary = null;
  for (const link of links) {
    try {
      // Only send a role when we have one: createDealContact upserts by `${dealId}_${contactId}`
      // and would otherwise coerce a previously recorded role back to "unknown".
      const prev = store.findDealContact ? await store.findDealContact(deal.id, link.contactId) : null;
      await store.createDealContact({
        dealId: deal.id,
        contactId: link.contactId,
        accountId: deal.accountId,
        role: link.role || prev?.role || "unknown",
        // Nobody nominated in this batch → leave an existing primary row alone.
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
    // Backfill-only: the pointer stands, so demote the row we just wrote to keep the join
    // agreeing with it, and make sure the pointer's own person actually has a row — a deal
    // created before this join existed has a primaryContactId and no rows at all.
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
    // createDealContact upserts one row; only setPrimaryDealContact demotes the deal's others,
    // which is what guarantees a single primary in the join before we cache it on the deal.
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
 * @typedef {{ title?: string, primaryContactId?: string|null, dealOwnerId?: string,
 *             contacts?: (DealContactLink|string)[], type?: import("./types.js").DealType,
 *             stage?: import("./types.js").LifecycleStage }} CreateDealOpts
 */

/**
 * Create one deal row and its contact links. No findActiveDeal check — every caller that wants
 * the "reuse the open one" behaviour does that check itself, so this stays the single place that
 * knows the shape of a new deal.
 *
 * Titling is per account and never per type: dealSequenceNumber counts every deal on the account
 * (all types, all statuses) and adds 1, so the 2nd, 3rd… deal reads "<Account> - Deal 2/3 - <date>"
 * with no change needed for multiple concurrent deals.
 *
 * @param {string} accountId
 * @param {string} ownerId
 * @param {string} teamId
 * @param {string|null} orgId
 * @param {import("./types.js").DealType} type
 * @param {CreateDealOpts} opts
 */
async function createDealRow(accountId, ownerId, teamId, orgId, type, opts = {}) {
  const store = getStore();
  const dealOwnerId = opts.dealOwnerId || (await resolveDealOwnerId(accountId, ownerId));
  const ts = now();
  const links = normalizeContactLinks(opts.contacts, opts.primaryContactId);
  const primaryContactId = links.find((l) => l.isPrimary)?.contactId ?? opts.primaryContactId ?? null;
  const deal = await store.createDeal({
    id: newId("deal"),
    accountId,
    type,
    stage: opts.stage || "research",
    status: "active",
    ownerId: dealOwnerId,
    teamId,
    orgId: orgId || null,
    primaryContactId,
    title: await resolveNewDealTitle(accountId, opts.title, ts),
    prepCount: 0,
    postCallCount: 0,
    openTaskCount: 0,
    latestQualityScore: null,
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
  });
  return linkDealContacts(deal, links);
}

/**
 * Link contacts to an existing deal by id — the one public route to the join for callers that
 * already have a deal and are not creating or bumping one (dual-write's post-call and prep paths).
 *
 * Exists so nothing outside this module writes the join or the pointer directly: `Deal` is this
 * module's aggregate, and `linkDealContacts` holds the only policy that keeps
 * `dealContacts.isPrimary` and `Deal.primaryContactId` agreeing.
 *
 * @param {string|null} dealId
 * @param {{ contacts?: DealContactInput[], primaryContactId?: string|null }} [opts]
 * @returns {Promise<object|null>} the deal, re-patched if the pointer moved
 */
export async function linkContactsToDealRecord(dealId, opts = {}) {
  if (!dealId || !opts.contacts?.length) return null;
  const store = getStore();
  const deal = await store.getDeal(dealId);
  if (!deal) return null;
  return linkDealContacts(deal, normalizeContactLinks(opts.contacts, opts.primaryContactId));
}

/**
 * Reuse the account's open new-business deal, or create the first one.
 *
 * Deliberately unchanged in its reuse behaviour — prep/post-call callers rely on "one implicit
 * open NB deal per account". Use createAdditionalDeal for a second concurrent deal.
 *
 * @param {string} accountId
 * @param {string} ownerId
 * @param {string} teamId
 * @param {string|null} orgId
 * @param {CreateDealOpts} [opts]
 */
export async function getOrCreateNewBusinessDeal(accountId, ownerId, teamId, orgId, opts = {}) {
  const store = getStore();
  const existing = await store.findActiveDeal(accountId, "new_business");
  // Still link the passed contacts: the people on this call belong on the deal we hand back,
  // even though we did not create it.
  if (existing) {
    return linkDealContacts(existing, normalizeContactLinks(opts.contacts, opts.primaryContactId));
  }

  return createDealRow(accountId, ownerId, teamId, orgId, opts.type || "new_business", opts);
}

/**
 * @param {string} accountId
 * @param {string} ownerId
 * @param {string} teamId
 * @param {string|null} orgId
 * @param {CreateDealOpts} [opts]
 */
export async function createExpansionDeal(accountId, ownerId, teamId, orgId, opts = {}) {
  const store = getStore();
  const existing = await store.findActiveDeal(accountId, "expansion");
  if (existing) {
    return linkDealContacts(existing, normalizeContactLinks(opts.contacts, opts.primaryContactId));
  }

  return createDealRow(accountId, ownerId, teamId, orgId, "expansion", opts);
}

/**
 * "Create another deal on this account" — the explicit multi-deal path.
 *
 * An account may hold any number of open deals (different buying centre, different product line,
 * a second land while the first is still in flight). getOrCreateNewBusinessDeal/createExpansionDeal
 * short-circuit on findActiveDeal and so cap the account at one open deal per type; this one never
 * looks, because the caller has already said "another".
 *
 * @param {string} accountId
 * @param {string} ownerId
 * @param {string} teamId
 * @param {string|null} orgId
 * @param {CreateDealOpts} [opts]
 */
export async function createAdditionalDeal(accountId, ownerId, teamId, orgId, opts = {}) {
  if (!accountId) throw new Error("createAdditionalDeal requires an accountId");
  return createDealRow(accountId, ownerId, teamId, orgId, opts.type || "new_business", opts);
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

/**
 * Increment deal counters after artifact attach; lifecycle mirrors via sync.
 * @param {string} dealId
 * @param {{ primaryContactId?: string|null, contacts?: (DealContactLink|string)[] }} [patch]
 *        remaining keys are passed straight through to updateDeal
 */
export async function bumpDealAfterPrep(dealId, patch = {}) {
  const store = getStore();
  const deal = await store.getDeal(dealId);
  if (!deal) return null;
  const ts = now();
  const { contacts, primaryContactId, ...dealPatch } = patch;
  const updated = await store.updateDeal(dealId, {
    prepCount: (deal.prepCount || 0) + 1,
    lastActivityAt: ts,
    ...dealPatch,
    // After the spread on purpose: patch.primaryContactId is routinely undefined (prep briefs
    // without a contact), and letting that land in the patch wiped a pointer we already had.
    primaryContactId: deal.primaryContactId || primaryContactId || null,
  });
  // The prep brief's contacts are the first people we know about on this deal — record them in
  // the join, not only as the denormalised pointer that updateDeal just set.
  const linked = await linkDealContacts(updated, normalizeContactLinks(contacts, primaryContactId));
  await syncLifecycleFromDeal(linked || updated);
  return linked || updated;
}

/**
 * @param {string} dealId
 * @param {{ isNew?: boolean, stage?: import("./types.js").LifecycleStage,
 *           primaryContactId?: string|null, contacts?: (DealContactLink|string)[] }} opts
 *        `contacts`/`primaryContactId` backfill the buying committee for a deal that was created
 *        by an earlier post-call, when no contact was known yet — such deals otherwise keep
 *        `primaryContactId: null` for their whole life. Backfill only: an existing primary stands.
 */
export async function bumpDealAfterPostCall(dealId, { isNew, stage, primaryContactId, contacts } = {}) {
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
  const linked = await linkDealContacts(updated, normalizeContactLinks(contacts, primaryContactId));
  await syncLifecycleFromDeal(linked || updated);
  return linked || updated;
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
 * @param {{ contacts?: (DealContactLink|string)[] }} [opts]
 */
export async function ensureDealForLifecycle(lifecycle, opts = {}) {
  // The lifecycle's own primary contact is a link too — it is the same person the deal will point at.
  const links = normalizeContactLinks(opts.contacts, lifecycle.primaryContactId);

  if (lifecycle.dealId) {
    const store = getStore();
    const deal = await store.getDeal(lifecycle.dealId);
    if (deal) return linkDealContacts(deal, links);
  }

  const store = getStore();
  const existingNb = await store.findActiveDeal(lifecycle.accountId, "new_business");
  if (existingNb) {
    await store.updateLifecycle(lifecycle.id, { dealId: existingNb.id });
    return linkDealContacts(existingNb, links);
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
  return (await linkDealContacts(deal, links)) || deal;
}

/**
 * Resolve deal for prep/post-call (NB or expansion).
 * @param {string} accountId
 * @param {string} ownerId
 * @param {string} teamId
 * @param {string|null} orgId
 * @param {{ prepType?: string, dealId?: string|null, title?: string, primaryContactId?: string|null,
 *           contacts?: (DealContactLink|string)[], createNewDeal?: boolean }} opts
 */
export async function resolveDealForEngagement(accountId, ownerId, teamId, orgId, opts = {}) {
  const store = getStore();
  // An explicitly chosen deal is still a deal the call's people belong on, so link on every
  // branch — not only when we end up creating the deal.
  const links = normalizeContactLinks(opts.contacts, opts.primaryContactId);

  // "+ New deal" is an explicit instruction to open a deal alongside whatever is already active,
  // so every reuse branch below is skipped. Without this the request fell through to
  // getOrCreateNewBusinessDeal, whose findActiveDeal short-circuit handed back the existing deal —
  // so the UI promised "Will be created on generate" and silently reused instead.
  if (opts.createNewDeal && accountId) {
    return createAdditionalDeal(accountId, ownerId, teamId, orgId, {
      title: opts.title,
      primaryContactId: opts.primaryContactId,
      contacts: opts.contacts,
      type: opts.prepType === "expansion" ? "expansion" : "new_business",
      dealOwnerId: await resolveDealOwnerId(accountId, ownerId),
    });
  }

  if (opts.dealId) {
    const deal = await store.getDeal(opts.dealId);
    if (deal && deal.accountId === accountId) return linkDealContacts(deal, links);
  }

  const motion = await resolveEngagementMotion(accountId, ownerId, {
    explicitDealId: opts.dealId,
    explicitPrepType: opts.prepType,
    useSessionContext: opts.useSessionContext !== false,
  });

  if (motion.dealId) {
    const deal = await store.getDeal(motion.dealId);
    if (deal && deal.accountId === accountId) return linkDealContacts(deal, links);
  }

  const prepType = motion.prepType;
  const dealOwnerId = await resolveDealOwnerId(accountId, ownerId);
  const common = {
    title: opts.title,
    primaryContactId: opts.primaryContactId,
    contacts: opts.contacts,
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
