/**
 * New business vs expansion routing for deal association.
 * Order documented in docs/adr/003-account-deal-engagement.md — keep in sync.
 */

import { getStore } from "./store.js";
import { TEAM_AJAY_ID, TEAM_NIKIL_ID } from "./constants.js";
import { getAccountEngagementContext } from "./account-context.js";

export const NEW_BUSINESS_TEAM_IDS = new Set([TEAM_AJAY_ID, TEAM_NIKIL_ID]);
export const NB_GRACE_DAYS = 90;
const ALLOWLIST_TTL_MS = 5 * 60 * 1000;

/** @type {{ data: { accountIds: string[], slugs: string[] }, loadedAt: number } | null} */
let allowlistCache = null;

/**
 * @returns {Promise<{ accountIds: Set<string>, slugs: Set<string>, loaded: boolean }>}
 */
export async function loadNbAccountAllowlist() {
  const now = Date.now();
  if (allowlistCache && now - allowlistCache.loadedAt < ALLOWLIST_TTL_MS) {
    const { accountIds, slugs } = allowlistCache.data;
    return {
      accountIds: new Set(accountIds || []),
      slugs: new Set((slugs || []).map((s) => String(s).toLowerCase())),
      loaded: true,
    };
  }
  try {
    const res = await fetch(new URL("../config/nb-account-allowlist.json", import.meta.url));
    if (res.ok) {
      const data = await res.json();
      allowlistCache = { data, loadedAt: now };
      return {
        accountIds: new Set(data.accountIds || []),
        slugs: new Set((data.slugs || []).map((s) => String(s).toLowerCase())),
        loaded: true,
      };
    }
  } catch {
    // Do not cache failures — next call retries.
  }
  return { accountIds: new Set(), slugs: new Set(), loaded: false };
}

/** @param {import("./types.js").Account | null | undefined} account @param {{ accountIds: Set<string>, slugs: Set<string> }} allowlist */
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

/**
 * @typedef {'new_business' | 'expansion'} DealMotionType
 * @typedef {'manual' | 'account' | 'context' | 'allowlist' | 'phase' | 'grace' | 'actor' | 'default'} DealMotionSource
 */

/**
 * @param {{ wonNbDeal?: import("./types.js").Deal|null, now?: number, graceDays?: number }}
 * @returns {{ useWonNb: boolean, dealId: string|null, daysSinceWon: number|null, reason: string }}
 */
export function shouldUseWonNbDeal({ wonNbDeal, now = Date.now(), graceDays = NB_GRACE_DAYS }) {
  if (!wonNbDeal?.wonAt) {
    return { useWonNb: false, dealId: null, daysSinceWon: null, reason: "no_won_at" };
  }
  const msPerDay = 86400000;
  const daysSinceWon = Math.floor((now - wonNbDeal.wonAt) / msPerDay);
  const useWonNb = daysSinceWon <= graceDays;
  return {
    useWonNb,
    dealId: useWonNb ? wonNbDeal.id : null,
    daysSinceWon,
    reason: useWonNb ? "within_grace" : "grace_expired",
  };
}

/**
 * Infer prep/deal type before creating deals.
 * @param {{
 *   account?: import("./types.js").Account | null,
 *   actor?: import("./types.js").User | null,
 *   explicitDeal?: import("./types.js").Deal | null,
 *   explicitDealId?: string | null,
 *   explicitPrepType?: string | null,
 *   sessionContext?: { dealId?: string, prepType?: string } | null,
 *   allowlist?: { accountIds: Set<string>, slugs: Set<string>, loaded?: boolean },
 *   wonNbDeal?: import("./types.js").Deal | null,
 *   now?: number,
 * }} input
 */
export function resolveEngagementDealInput(input) {
  const {
    account,
    actor,
    explicitDeal,
    explicitDealId,
    explicitPrepType,
    sessionContext,
    allowlist,
    wonNbDeal,
    now,
  } = input;

  if (explicitDealId || explicitDeal) {
    const deal = explicitDeal || null;
    const prepType = deal?.type === "expansion" || deal?.type === "new_business"
      ? deal.type
      : explicitPrepType === "expansion"
        ? "expansion"
        : "new_business";
    return {
      prepType,
      dealId: explicitDealId || deal?.id || null,
      source: "manual",
    };
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
    return { prepType: sessionContext.prepType, dealId: null, source: "context" };
  }

  if (explicitPrepType === "expansion" || explicitPrepType === "new_business") {
    return { prepType: explicitPrepType, dealId: null, source: "manual" };
  }

  const grace = shouldUseWonNbDeal({ wonNbDeal, now });
  if (grace.useWonNb && grace.dealId) {
    return { prepType: "new_business", dealId: grace.dealId, source: "grace" };
  }

  if (account?.programPhase === "expansion") {
    return { prepType: "expansion", dealId: null, source: "phase" };
  }

  if (allowlist?.loaded !== false && allowlist && isAccountOnNbAllowlistSync(account, allowlist)) {
    return { prepType: "new_business", dealId: null, source: "allowlist" };
  }

  if (isNewBusinessActor(actor)) {
    return { prepType: "new_business", dealId: null, source: "actor" };
  }

  return { prepType: "expansion", dealId: null, source: "default" };
}

/** @param {string} accountId @param {string} actorId @param {object} [opts] */
export async function resolveEngagementMotion(accountId, actorId, opts = {}) {
  const store = getStore();
  const account = accountId ? await store.getAccount(accountId) : null;
  const actor = actorId ? await store.getUser(actorId) : null;
  const allowlist = await loadNbAccountAllowlist();

  let explicitDeal = null;
  if (opts.explicitDealId && store.getDeal) {
    explicitDeal = await store.getDeal(opts.explicitDealId);
  }

  let wonNbDeal = null;
  if (store.findActiveDeal) {
    wonNbDeal = await store.findActiveDeal(accountId, "new_business", {
      ownerId: actorId,
      teamId: actor?.teamId,
      includeGrace: true,
    });
  }

  const sessionContext = opts.useSessionContext !== false ? getAccountEngagementContext() : null;

  return resolveEngagementDealInput({
    account,
    actor,
    explicitDeal,
    explicitDealId: opts.explicitDealId,
    explicitPrepType: opts.explicitPrepType,
    sessionContext,
    allowlist,
    wonNbDeal,
  });
}

/**
 * Deal document owner for shared account-level deals (BY-DESIGN: primary SE owns deal doc).
 * Coaching attribution uses lifecycle owner or lastActorId, not deal.ownerId alone.
 */
export async function resolveDealOwnerId(accountId, actorId) {
  const store = getStore();
  const account = accountId ? await store.getAccount(accountId) : null;
  return account?.primarySeUserId || actorId;
}
