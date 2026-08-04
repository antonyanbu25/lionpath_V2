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
 */

import { getStore } from "./domain/store.js";
import { domainFromEmail, normalizeAccountSlug } from "./domain/types.js";
import { isFreeMailDomain } from "./domain/constants.js";

/**
 * @typedef {Object} CrmMatchEntry
 * @property {string} email
 * @property {string|null} domain
 * @property {object|null} contact   first matching Contact doc (if any)
 * @property {object[]} accounts     Account docs linked to this email
 * @property {object[]} deals        Deal docs on those accounts
 * @property {boolean} matched       true when at least one account was found
 */

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
    } catch {
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

  return {
    byEmail,
    accounts: [...accountsById.values()],
    deals: [...dealsById.values()],
  };
}

/**
 * Resolve a company name (+ optional domain) to existing accounts/deals.
 * Used when the SE types a company they have researched before without a contact email match.
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

  if (store.findAccountBySlug) {
    const slug = normalizeAccountSlug(name, domain || null);
    const bySlug = await store.findAccountBySlug(slug);
    if (bySlug?.id) accountsById.set(bySlug.id, bySlug);
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

  const deals = [];
  for (const account of accountsById.values()) {
    try {
      const list = store.listDealsByAccount ? await store.listDealsByAccount(account.id) : [];
      for (const d of list) deals.push(d);
    } catch {
      /* best-effort */
    }
  }

  return { accounts: [...accountsById.values()], deals };
}
