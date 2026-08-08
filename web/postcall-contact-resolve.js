/**
 * Contact-primary CRM reverse lookup for the post-call intake form.
 *
 * Given the emails typed into the post-call form, find every existing Account and
 * Deal already associated with those contacts — so the SE can see "this person
 * already has a deal/account" before an analysis is run. Contacts are the primary
 * identifier: we resolve email -> contact(s) -> account(s) -> deals. When no contact
 * exists for that email, we fall back to an exact corporate-domain match on accounts
 * (never free-mail domains like gmail.com).
 *
 * Accounts and contacts are org-shared (readable by any signed-in user). Deals on an
 * account are global — any SE on the account sees the same opportunity list.
 *
 * FOLLOW-UP (DEAL-011): when firestore.rules tighten, add explicit "read account/deal for
 * attach" so SE-2 can read SE-1's deal during intake resolve-to-attach. Do not widen rules
 * in this change set.
 */

import { getStore } from "./domain/store.js";
import { domainFromEmail, normalizeAccountSlug } from "./domain/types.js";
import { isFreeMailDomain } from "./domain/constants.js";
import { listDealsFromHistory } from "./domain/account-service.js?v=2.1.14";
import { getSession } from "./auth.js";

function normalizeCompanyKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function histSlugFromAccountId(accountId) {
  return String(accountId || "")
    .replace(/^hist_/, "")
    .toLowerCase();
}

/**
 * Local history CRM rows (deal_hist_*, hist_*) — same source as My deals fallback.
 * Matches typed emails and/or company name so intake surfaces deals Firestore missed.
 * @param {object|null|undefined} session
 * @param {string[]} emails
 * @param {string} [companyName]
 */
export function resolveHistoryMatchesForIntake(session, emails, companyName = "") {
  const rows = listDealsFromHistory(session || getSession() || {});
  if (!rows.length) return { accounts: [], deals: [] };

  const emailSet = new Set(
    (emails || []).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean),
  );
  const companyNorm = normalizeCompanyKey(companyName);
  /** @type {Set<string>} */
  const domainKeys = new Set();
  for (const e of emailSet) {
    const dom = domainFromEmail(e);
    if (!dom || isFreeMailDomain(dom)) continue;
    domainKeys.add(normalizeCompanyKey(dom.split(".")[0]));
    domainKeys.add(histSlugFromAccountId(`hist_${dom.split(".")[0]}`));
    domainKeys.add(normalizeAccountSlug(dom.split(".")[0], dom));
  }

  /** @type {Map<string, object>} */
  const accountsById = new Map();
  /** @type {Map<string, object>} */
  const dealsById = new Map();

  for (const row of rows) {
    const deal = row.deal;
    const account = row.account;
    if (!deal?.id || !account?.id) continue;

    const acctNorm = normalizeCompanyKey(account.name);
    const acctHistSlug = histSlugFromAccountId(account.id);

    let matched = false;
    if (companyNorm && (acctNorm === companyNorm || acctNorm.includes(companyNorm))) {
      matched = true;
    }
    for (const dk of domainKeys) {
      if (!dk) continue;
      if (acctHistSlug === dk.replace(/[^a-z0-9]+/g, "-") || acctNorm.includes(dk)) {
        matched = true;
      }
    }
    if (!matched && companyNorm && acctHistSlug.replace(/-/g, " ") === companyNorm.replace(/ /g, "-")) {
      matched = true;
    }

    if (matched) {
      accountsById.set(account.id, account);
      dealsById.set(deal.id, { ...deal, _historyFallback: true });
    }
  }

  return { accounts: [...accountsById.values()], deals: [...dealsById.values()] };
}

/**
 * @typedef {Object} CrmMatchEntry
 * @property {string} email
 * @property {string|null} domain
 * @property {object|null} contact   first matching Contact doc (if any)
 * @property {object[]} accounts     Account docs linked to this email
 * @property {object[]} deals        Deal docs on those accounts
 * @property {boolean} matched       true when at least one account was found
 */

/** Best-effort owner display names for intake "existing (owner: …)" badges. */
export async function enrichDealOwnerNames(deals) {
  const list = Array.isArray(deals) ? deals : [];
  if (!list.length) return list;
  const store = getStore();
  if (!store?.getUser) return list;

  /** @type {Map<string, string|null>} */
  const cache = new Map();
  async function ownerLabel(ownerId) {
    const id = String(ownerId || "").trim();
    if (!id) return null;
    if (cache.has(id)) return cache.get(id);
    let label = null;
    try {
      const user = await store.getUser(id);
      label = user?.displayName || user?.email || null;
    } catch {
      label = null;
    }
    cache.set(id, label);
    return label;
  }

  return Promise.all(
    list.map(async (deal) => {
      if (!deal || deal.ownerName) return deal;
      const name = await ownerLabel(deal.ownerId);
      return name ? { ...deal, ownerName: name } : deal;
    }),
  );
}

/**
 * Resolve typed emails to existing accounts/deals.
 * @param {string[]} emails
 * @returns {Promise<{ byEmail: CrmMatchEntry[], accounts: object[], deals: object[] }>}
 */
export async function resolveContactsForEmails(emails) {
  const list = [...new Set((emails || []).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean))];
  const empty = { byEmail: [], accounts: [], deals: [] };
  if (!list.length) return empty;

  const store = getStore();
  if (!store) return empty;

  const accountCache = new Map(); // accountId -> account doc (or null)
  const dealsCache = new Map(); // accountId -> deal[]

  async function loadAccount(accountId) {
    if (!accountId) return null;
    if (accountCache.has(accountId)) return accountCache.get(accountId);
    let account = null;
    try {
      account = store.getAccount ? await store.getAccount(accountId) : null;
    } catch {
      account = null;
    }
    accountCache.set(accountId, account);
    return account;
  }

  async function loadDeals(accountId) {
    if (!accountId) return [];
    if (dealsCache.has(accountId)) return dealsCache.get(accountId);
    let deals = [];
    try {
      // No owner filter: surface every readable deal on the account, not just the
      // current SE's, so shared/second-SE deals show up.
      deals = store.listDealsByAccount ? await store.listDealsByAccount(accountId) : [];
      deals = await enrichDealOwnerNames(deals);
    } catch (err) {
      console.warn(
        "[postcall-contact-resolve] listDealsByAccount failed:",
        accountId,
        err?.message || err,
      );
      deals = [];
    }
    dealsCache.set(accountId, deals);
    return deals;
  }

  const byEmail = await Promise.all(
    list.map(async (email) => {
      const domain = domainFromEmail(email);
      /** @type {Set<string>} */
      const accountIds = new Set();
      let contact = null;

      // 1. Direct contact match (email is the identifier).
      try {
        const contacts = store.findContactsByEmail ? await store.findContactsByEmail(email) : [];
        for (const c of contacts) {
          if (!contact) contact = c;
          if (c.accountId) accountIds.add(c.accountId);
        }
      } catch {
        /* best-effort */
      }

      // 2. Corporate-domain fallback only when no contact-linked account (skip free-mail).
      if (accountIds.size === 0 && domain && !isFreeMailDomain(domain)) {
        try {
          const domAccts = store.findAccountsByDomain ? await store.findAccountsByDomain(domain) : [];
          for (const a of domAccts) {
            if (a?.id) {
              accountIds.add(a.id);
              if (!accountCache.has(a.id)) accountCache.set(a.id, a);
            }
          }
        } catch {
          /* best-effort */
        }
      }

      const accounts = [];
      const deals = [];
      for (const accountId of accountIds) {
        const account = await loadAccount(accountId);
        if (!account) continue;
        accounts.push(account);
        for (const d of await loadDeals(accountId)) deals.push(d);
      }

      return {
        email,
        domain: domain || null,
        contact,
        accounts,
        deals,
        matched: accounts.length > 0,
      };
    }),
  );

  // Dedupe accounts/deals across all typed emails.
  const accountsById = new Map();
  const dealsById = new Map();
  for (const entry of byEmail) {
    for (const a of entry.accounts) if (a?.id && !accountsById.has(a.id)) accountsById.set(a.id, a);
    for (const d of entry.deals) if (d?.id && !dealsById.has(d.id)) dealsById.set(d.id, d);
  }

  // Ensure every matched account has deals loaded (per-email path can miss on partial errors).
  for (const accountId of accountsById.keys()) {
    const hasDeal = [...dealsById.values()].some((d) => d.accountId === accountId);
    if (hasDeal) continue;
    for (const d of await loadDeals(accountId)) {
      if (d?.id && !dealsById.has(d.id)) dealsById.set(d.id, d);
    }
  }

  const hist = (() => {
    try {
      const session = typeof sessionStorage !== "undefined" ? getSession() : null;
      if (!session?.email) return { accounts: [], deals: [] };
      return resolveHistoryMatchesForIntake(session, list);
    } catch {
      return { accounts: [], deals: [] };
    }
  })();
  for (const a of hist.accounts) {
    if (a?.id && !accountsById.has(a.id)) accountsById.set(a.id, a);
  }
  for (const d of hist.deals) {
    if (d?.id && !dealsById.has(d.id)) dealsById.set(d.id, d);
  }

  return {
    byEmail,
    accounts: [...accountsById.values()],
    deals: [...dealsById.values()],
  };
}

/**
 * Resolve a company name (+ optional domain) to existing accounts/deals.
 * Used when the SE types a company they have researched before without a contact email match.
 * Name, domain, and slug all resolve globally (no teamId / owner filter).
 * @param {string} companyName
 * @param {string} [companyDomain]
 * @returns {Promise<{ accounts: object[], deals: object[] }>}
 */
export async function resolveAccountsForCompany(companyName, companyDomain) {
  const store = getStore();
  const empty = { accounts: [], deals: [] };
  if (!store) return empty;

  const name = String(companyName || "").trim();
  const domain = String(companyDomain || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  if (!name && !domain) return empty;

  /** @type {Map<string, object>} */
  const accountsById = new Map();

  if (name && store.findAccountBySlug) {
    try {
      const slug = normalizeAccountSlug(name, domain || null);
      const bySlug = await store.findAccountBySlug(slug);
      if (bySlug?.id) accountsById.set(bySlug.id, bySlug);
    } catch {
      /* best-effort */
    }
  }

  if (domain && !isFreeMailDomain(domain) && store.findAccountsByDomain) {
    try {
      for (const a of await store.findAccountsByDomain(domain)) {
        if (a?.id) accountsById.set(a.id, a);
      }
    } catch {
      /* best-effort */
    }
  }

  if (name && store.findAccountsByName) {
    try {
      for (const a of await store.findAccountsByName(name)) {
        if (a?.id) accountsById.set(a.id, a);
      }
    } catch {
      /* best-effort */
    }
  }

  const deals = [];
  for (const account of accountsById.values()) {
    try {
      let list = store.listDealsByAccount ? await store.listDealsByAccount(account.id) : [];
      list = await enrichDealOwnerNames(list);
      for (const d of list) deals.push(d);
    } catch {
      /* best-effort */
    }
  }

  return { accounts: [...accountsById.values()], deals };
}
