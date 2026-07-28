/**
 * New business vs expansion routing for deal association (ADR-003 + CRM plan).
 */

import { getStore } from "./store.js";
import { TEAM_AJAY_ID, TEAM_NIKIL_ID } from "./constants.js";
import { getAccountEngagementContext } from "./account-context.js";

export const NEW_BUSINESS_TEAM_IDS = new Set([TEAM_AJAY_ID, TEAM_NIKIL_ID]);

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

/**
 * @typedef {'new_business' | 'expansion'} DealMotionType
 * @typedef {'manual' | 'account' | 'context' | 'allowlist' | 'phase' | 'actor' | 'default'} DealMotionSource
 */

/**
 * Infer prep/deal type before creating deals.
 * @param {{
 *   account?: import("./types.js").Account | null,
 *   actor?: import("./types.js").User | null,
 *   explicitDealId?: string | null,
 *   explicitPrepType?: string | null,
 *   sessionContext?: { dealId?: string, prepType?: string } | null,
 *   allowlist?: { accountIds: Set<string>, slugs: Set<string> },
 * }} input
 * @returns {{ prepType: DealMotionType, dealId: string | null, source: DealMotionSource }}
 */
export function resolveEngagementDealInput(input) {
  const {
    account,
    actor,
    explicitDealId,
    explicitPrepType,
    sessionContext,
    allowlist,
  } = input;

  if (explicitDealId) {
    return {
      prepType: explicitPrepType === "expansion" ? "expansion" : "new_business",
      dealId: explicitDealId,
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
    return {
      prepType: sessionContext.prepType,
      dealId: null,
      source: "context",
    };
  }

  if (explicitPrepType === "expansion" || explicitPrepType === "new_business") {
    return { prepType: explicitPrepType, dealId: null, source: "manual" };
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
 * @param {{ explicitDealId?: string|null, explicitPrepType?: string|null, useSessionContext?: boolean }} opts
 */
export async function resolveEngagementMotion(accountId, actorId, opts = {}) {
  const store = getStore();
  const account = accountId ? await store.getAccount(accountId) : null;
  const actor = actorId ? await store.getUser(actorId) : null;
  const allowlist = await loadNbAccountAllowlist();
  const sessionContext = opts.useSessionContext !== false ? getAccountEngagementContext() : null;

  return resolveEngagementDealInput({
    account,
    actor,
    explicitDealId: opts.explicitDealId,
    explicitPrepType: opts.explicitPrepType,
    sessionContext,
    allowlist,
  });
}

/** Deal document owner for shared account-level deals. */
export async function resolveDealOwnerId(accountId, actorId) {
  const store = getStore();
  const account = accountId ? await store.getAccount(accountId) : null;
  return account?.primarySeUserId || actorId;
}
