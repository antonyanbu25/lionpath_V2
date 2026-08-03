/**
 * Client-side search index for accounts, discovery briefs, and call reviews.
 */

import { listAccountsForSession } from "./domain/account-service.js";
import { DEAL_TYPE_LABELS } from "./domain/deal-service.js";
import { getStore } from "./domain/store.js";
import { sessionUserId } from "./domain/session.js";
import { STAGE_LABELS } from "./domain/types.js";
import { loadLocalBriefs } from "./precall.js";
import { listPostCallAnalyses } from "./history.js";

/** @type {{ key: string|null, index: object[]|null }} */
const cache = { key: null, index: null };

function norm(s) {
  return String(s ?? "").trim().toLowerCase();
}

function tokenizeQuery(query) {
  return norm(query).split(/\s+/).filter(Boolean);
}

function collectTokens(parts) {
  const set = new Set();
  for (const p of parts) {
    const v = norm(p);
    if (v) set.add(v);
  }
  return [...set];
}

/** Build searchable token list for an account row. */
export function accountRowTokens(row, contacts = []) {
  const { account, lifecycle, seTeamDisplay, dealTypeLabel, dealStage } = row;
  const stageLabel = STAGE_LABELS[dealStage || lifecycle?.stage] || lifecycle?.stage || "";
  const parts = [
    account?.name,
    account?.domain,
    lifecycle?.title,
    stageLabel,
    dealStage || lifecycle?.stage,
    dealTypeLabel,
  ];
  for (const m of seTeamDisplay || []) {
    parts.push(m.user?.displayName, m.user?.jobTitle);
  }
  for (const c of contacts) {
    parts.push(c.name, c.email, c.title);
  }
  return collectTokens(parts);
}

/** Filter account rows by query (name, domain, contact, stage). */
export function filterAccountRows(rows, query, contactsByAccountId = {}) {
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return rows;
  return rows.filter((row) => {
    const contacts = row.contacts || contactsByAccountId[row.account?.id] || [];
    const rowTokens = accountRowTokens(row, contacts);
    return tokens.every((t) => rowTokens.some((rt) => rt.includes(t)));
  });
}

/** Build searchable tokens for a deal list row. */
export function dealRowTokens(row) {
  const { deal, account, primarySeName } = row;
  const stageLabel = STAGE_LABELS[deal?.stage] || deal?.stage || "";
  const typeLabel = DEAL_TYPE_LABELS[deal?.type] || deal?.type || "";
  const statusLabel =
    deal?.status === "archived" ? "archived"
    : deal?.status === "paused" ? "paused"
    : "active";
  return collectTokens([
    account?.name,
    account?.domain,
    deal?.title,
    typeLabel,
    stageLabel,
    statusLabel,
    primarySeName,
  ]);
}

/** Filter deal rows by query (account, deal title, stage, motion, SE). */
export function filterDealRows(rows, query) {
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return rows;
  return rows.filter((row) => {
    const rowTokens = dealRowTokens(row);
    return tokens.every((t) => rowTokens.some((rt) => rt.includes(t)));
  });
}

function scoreMatch(queryTokens, itemTokens, label, subtitle) {
  const labelNorm = norm(label);
  const subNorm = norm(subtitle);
  let score = 0;
  for (const t of queryTokens) {
    if (labelNorm === t || subNorm === t) score += 100;
    else if (labelNorm.startsWith(t) || subNorm.startsWith(t)) score += 50;
    else if (itemTokens.some((it) => it === t)) score += 40;
    else if (itemTokens.some((it) => it.includes(t))) score += 20;
  }
  return score;
}

/**
 * @param {object[]} index
 * @param {string} query
 * @param {{ types?: string[], limit?: number }} [opts]
 */
export function searchIndex(index, query, opts = {}) {
  const { types, limit = 12 } = opts;
  const queryTokens = tokenizeQuery(query);
  let pool = types?.length ? index.filter((i) => types.includes(i.type)) : index;

  if (!queryTokens.length) {
    return pool
      .slice()
      .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))
      .slice(0, limit);
  }

  const scored = pool
    .map((item) => ({
      item,
      score: scoreMatch(queryTokens, item.tokens, item.label, item.subtitle),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.item.lastActivityAt || 0) - (a.item.lastActivityAt || 0);
    });

  return scored.slice(0, limit).map((x) => x.item);
}

/** Recent items when query is empty (top 5 each type cap). */
export function recentFromIndex(index, limit = 5) {
  const byType = { account: [], contact: [], brief: [], call: [] };
  const sorted = index.slice().sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  for (const item of sorted) {
    if (byType[item.type]?.length < limit) byType[item.type].push(item);
  }
  return [...byType.account, ...byType.contact, ...byType.brief, ...byType.call].slice(0, limit * 4);
}

export function invalidateSearchIndex() {
  cache.key = null;
  cache.index = null;
}

/**
 * Contact typeahead — debounced search over the contact slice of the index.
 * @param {object[]} index
 * @param {string} query
 * @param {{ accountId?: string, limit?: number }} [opts]
 */
export function searchContacts(index, query, opts = {}) {
  const { accountId, limit = 8 } = opts;
  let pool = index.filter((i) => i.type === "contact");
  if (accountId) pool = pool.filter((i) => i.accountId === accountId);
  const q = String(query || "").trim();
  if (!q) return [];
  return searchIndex(pool, q, { limit });
}

/** @param {object|null} session */
export async function buildSearchIndex(session) {
  const userId = sessionUserId(session);
  const email = session?.email ? String(session.email).trim().toLowerCase() : "";
  const cacheKey = `${userId || ""}|${email}`;
  if (cache.key === cacheKey && cache.index) return cache.index;

  const index = [];
  const store = getStore();

  if (userId) {
    const rows = await listAccountsForSession(session);
    await Promise.all(
      rows.map(async (row) => {
        const contacts = await store.listContactsByAccount(row.account.id);
        const label = row.account.name || row.lifecycle.title || "Account";
        const subtitle = [row.account.domain, STAGE_LABELS[row.lifecycle.stage]]
          .filter(Boolean)
          .join(" · ");
        index.push({
          type: "account",
          id: row.account.id,
          accountId: row.account.id,
          label,
          subtitle,
          tokens: accountRowTokens(row, contacts),
          lastActivityAt: row.lifecycle.lastActivityAt || 0,
        });

        // Contact-primary: index each contact as its own result (email is the key).
        for (const c of contacts) {
          const contactLabel = c.name || c.email || "Contact";
          const contactSub = [c.title, c.email && c.email !== contactLabel ? c.email : "", row.account.name]
            .filter(Boolean)
            .join(" · ");
          index.push({
            type: "contact",
            id: c.id,
            accountId: row.account.id,
            contactId: c.id,
            email: c.email || null,
            label: contactLabel,
            subtitle: contactSub,
            tokens: collectTokens([c.name, c.email, c.title, c.role, row.account.name, "contact"]),
            lastActivityAt: c.updatedAt || row.lifecycle.lastActivityAt || 0,
          });
        }
      }),
    );
  }

  for (const b of loadLocalBriefs()) {
    const label = b.company || b.meta?.company || "Discovery brief";
    const domain = b.meta?.domain || b.meta?.companyDomain || "";
    const subtitle = [domain, b.when, "Discovery brief"].filter(Boolean).join(" · ");
    index.push({
      type: "brief",
      id: b.id,
      accountId: null,
      label,
      subtitle,
      tokens: collectTokens([label, domain, b.when, "brief", "discovery"]),
      lastActivityAt: b.savedAt || Date.parse(b.when) || 0,
    });
  }

  if (email) {
    for (const r of listPostCallAnalyses(email)) {
      const headline = r.analysis?.callSummary?.headline || "";
      const label = r.title || headline || "Call review";
      const subtitle = [headline, r.timestamp ? new Date(r.timestamp).toLocaleDateString() : ""]
        .filter(Boolean)
        .join(" · ");
      index.push({
        type: "call",
        id: r.id,
        accountId: null,
        label,
        subtitle,
        tokens: collectTokens([label, headline, "call", "review"]),
        lastActivityAt: r.timestamp || 0,
      });
    }
  }

  cache.key = cacheKey;
  cache.index = index;
  return index;
}
