/**
 * New business vs expansion routing for deal association (ADR-003 + CRM plan).
 */

import { getStore } from "./store.js";
import { TEAM_AJAY_ID, TEAM_NIKIL_ID } from "./constants.js";
import { getAccountEngagementContext } from "./account-context.js";

export const NEW_BUSINESS_TEAM_IDS = new Set([TEAM_AJAY_ID, TEAM_NIKIL_ID]);

/** 90-day NB grace after closed_won — activities stay on won NB deal, then expansion routing. */
export const NB_GRACE_PERIOD_MS = 90 * 24 * 60 * 60 * 1000;

/** @type {{ accountIds: string[], slugs: string[] } | null} */
let allowlistCache = null;

/**
 * @returns {Promise<{ accountIds: Set<string>, slugs: Set<string> }>}
 */
export async function loadNbAccountAllowlist() {
  if (allowlistCache) {
    return {
      accountIds: new Set(allowlistCache.accountIds || []),
      slugs: new Set((allowlistCache.slugs || []).map((s) => String(s).toLowerCase())),
    };
  }
  try {
    const res = await fetch(new URL("../config/nb-account-allowlist.json", import.meta.url));
    if (res.ok) {
      allowlistCache = await res.json();
    } else {
      allowlistCache = { accountIds: [], slugs: [] };
    }
  } catch {
    allowlistCache = { accountIds: [], slugs: [] };
  }
  return {
    accountIds: new Set(allowlistCache.accountIds || []),
    slugs: new Set((allowlistCache.slugs || []).map((s) => String(s).toLowerCase())),
  };
}

/** @param {import("./types.js").Account | null | undefined} account */
export function isAccountOnNbAllowlistSync(account, allowlist) {
  if (!account || !allowlist) return false;
  if (allowlist.accountIds.has(account.id)) return true;
  const slug = String(account.slug || "").toLowerCase();
  return Boolean(slug && allowlist.slugs.has(slug));
}

/** @param {import("./types.js").User | null | undefined} user */
export function isNewBusinessActor(user) {
  if (!user) return false;
  if (user.teamId && NEW_BUSINESS_TEAM_IDS.has(user.teamId)) return true;
  return false;
}

/** @param {import("./types.js").Deal | null | undefined} deal */
export function getClosedWonAt(deal) {
  if (!deal) return null;
  const fromMeta = deal.metadata?.closedWonAt;
  if (typeof fromMeta === "number" && fromMeta > 0) return fromMeta;
  if (typeof deal.closedWonAt === "number" && deal.closedWonAt > 0) return deal.closedWonAt;
  return null;
}

/** @param {import("./types.js").Deal | null | undefined} deal @param {number} [asOfMs] */
export function isWithinNbGracePeriod(deal, asOfMs = Date.now()) {
  const wonAt = getClosedWonAt(deal);
  if (!wonAt || deal?.type !== "new_business" || deal?.stage !== "closed_won") return false;
  return asOfMs <= wonAt + NB_GRACE_PERIOD_MS;
}

/**
 * After grace expires, route new activities to expansion motion (not the won NB deal).
 * @param {import("./types.js").Deal | null | undefined} deal
 * @param {number} [asOfMs]
 * @returns {"new_business"|"expansion"|null}
 */
export function shouldRouteWonNbToExpansion(deal, asOfMs = Date.now()) {
  if (!deal || deal.type !== "new_business" || deal.stage !== "closed_won") return null;
  const wonAt = getClosedWonAt(deal);
  if (!wonAt) return null;
  return asOfMs > wonAt + NB_GRACE_PERIOD_MS ? "expansion" : "new_business";
}

/**
 * Prefer routing to archived won NB during grace (returns deal id).
 * @param {import("./types.js").Account | null | undefined} account
 * @param {import("./types.js").Deal | null | undefined} wonNbDeal
 * @param {number} [asOfMs]
 */
export function shouldUseWonNbDeal(account, wonNbDeal, asOfMs = Date.now()) {
  if (!wonNbDeal || !isWithinNbGracePeriod(wonNbDeal, asOfMs)) return null;
  return wonNbDeal.id;
}

/**
 * @typedef {'new_business' | 'expansion'} DealMotionType
 * @typedef {'manual' | 'account' | 'context' | 'allowlist' | 'phase' | 'actor' | 'default' | 'won_grace' | 'won_grace_expired'} DealMotionSource
 */

/**
 * Infer prep/deal type before creating deals.
 * @param {{
 *   account?: import("./types.js").Account | null,
 *   actor?: import("./types.js").User | null,
 *   explicitDealId?: string | null,
 *   explicitPrepType?: string | null,
 *   explicitDealType?: DealMotionType | null,
 *   sessionContext?: { dealId?: string, prepType?: string } | null,
 *   allowlist?: { accountIds: Set<string>, slugs: Set<string> },
 *   wonNbDealInGrace?: import("./types.js").Deal | null,
 *   asOfMs?: number,
 * }} input
 * @returns {{ prepType: DealMotionType, dealId: string | null, source: DealMotionSource }}
 */
export function resolveEngagementDealInput(input) {
  const {
    account,
    actor,
    explicitDealId,
    explicitPrepType,
    explicitDealType,
    sessionContext,
    allowlist,
    wonNbDealInGrace,
    asOfMs = Date.now(),
  } = input;

  if (explicitDealId) {
    let prepType = "new_business";
    if (explicitPrepType === "expansion" || explicitDealType === "expansion") {
      prepType = "expansion";
    } else if (explicitPrepType === "new_business" || explicitDealType === "new_business") {
      prepType = "new_business";
    }
    return {
      prepType,
      dealId: explicitDealId,
      source: "manual",
    };
  }

  const graceDealId = shouldUseWonNbDeal(account, wonNbDealInGrace, asOfMs);
  if (graceDealId) {
    return { prepType: "new_business", dealId: graceDealId, source: "won_grace" };
  }

  const accountOverride = account?.metadata?.engagementOverride;
  if (accountOverride?.dealId) {
    return {
      prepType: accountOverride.dealType === "expansion" ? "expansion" : "new_business",
      dealId: accountOverride.dealId,
      source: "account",
    };
  }
  if (accountOverride?.dealType) {
    return {
      prepType: accountOverride.dealType === "expansion" ? "expansion" : "new_business",
      dealId: null,
      source: "account",
    };
  }

  if (sessionContext?.dealId) {
    return {
      prepType: sessionContext.prepType === "expansion" ? "expansion" : "new_business",
      dealId: sessionContext.dealId,
      source: "context",
    };
  }
  if (sessionContext?.prepType === "expansion" || sessionContext?.prepType === "new_business") {
    return {
      prepType: sessionContext.prepType,
      dealId: null,
      source: "context",
    };
  }

  if (explicitPrepType === "expansion" || explicitPrepType === "new_business") {
    return { prepType: explicitPrepType, dealId: null, source: "manual" };
  }

  if (wonNbDealInGrace && shouldRouteWonNbToExpansion(wonNbDealInGrace, asOfMs) === "expansion") {
    // Distinct from the still-in-grace branch above: this fires once the
    // grace window has EXPIRED and we're deliberately routing to expansion
    // motion instead of reusing the won NB deal. Was mislabeled "won_grace"
    // (same as the still-in-grace case) until 2026-08-09 — no current caller
    // branches on this specific string (checked), so this is a diagnostic-
    // accuracy fix, not a behavior change: dealId/prepType are unaffected.
    return { prepType: "expansion", dealId: null, source: "won_grace_expired" };
  }

  if (account?.programPhase === "expansion") {
    return { prepType: "expansion", dealId: null, source: "phase" };
  }

  if (allowlist && isAccountOnNbAllowlistSync(account, allowlist)) {
    return { prepType: "new_business", dealId: null, source: "allowlist" };
  }

  if (isNewBusinessActor(actor)) {
    return { prepType: "new_business", dealId: null, source: "actor" };
  }

  return { prepType: "expansion", dealId: null, source: "default" };
}

/**
 * Full async resolution for link flows.
 * @param {string} accountId
 * @param {string} actorId
 * @param {{ explicitDealId?: string|null, explicitPrepType?: string|null, useSessionContext?: boolean, asOfMs?: number }} opts
 */
export async function resolveEngagementMotion(accountId, actorId, opts = {}) {
  const store = getStore();
  const account = accountId ? await store.getAccount(accountId) : null;
  const actor = actorId ? await store.getUser(actorId) : null;
  const allowlist = await loadNbAccountAllowlist();
  const sessionContext = opts.useSessionContext !== false ? getAccountEngagementContext() : null;
  const wonNbDealInGrace = store.findWonNbDealInGrace
    ? await store.findWonNbDealInGrace(accountId, opts.asOfMs)
    : null;

  let explicitDealType = null;
  if (opts.explicitDealId && store.getDeal) {
    const pinned = await store.getDeal(opts.explicitDealId);
    if (pinned?.type === "expansion" || pinned?.type === "new_business") {
      explicitDealType = pinned.type;
    }
  }

  return resolveEngagementDealInput({
    account,
    actor,
    explicitDealId: opts.explicitDealId,
    explicitPrepType: opts.explicitPrepType,
    explicitDealType,
    sessionContext,
    allowlist,
    wonNbDealInGrace,
    asOfMs: opts.asOfMs,
  });
}

/** Deal document owner for shared account-level deals. */
export async function resolveDealOwnerId(accountId, actorId) {
  const store = getStore();
  const account = accountId ? await store.getAccount(accountId) : null;
  return account?.primarySeUserId || actorId;
}
