/**
 * Client-side search index + RAG rerank for accounts, deals, briefs, calls, contacts, tasks.
 */

import {
  historyPreviewContactsForSession,
  listAccountRowsFromHistory,
  listAccountsForSession,
  listDealsForSession,
  listDealsFromHistory,
} from "./domain/account-service.js?v=2.1";
import { DEAL_TYPE_LABELS } from "./domain/deal-service.js";
import { getStore } from "./domain/store.js";
import { effectiveSessionUserId, withEffectiveUserId } from "./domain/session.js";
import { STAGE_LABELS } from "./domain/types.js";
import { loadLocalBriefs } from "./precall.js";
import { listPostCallAnalyses } from "./history.js";
import { WORKER_BASE_URL } from "./firebase-config.js";

/** @type {{ key: string|null, index: object[]|null, builtAt: number }} */
const cache = { key: null, index: null, builtAt: 0 };

/** @type {Promise<object[]>|null} */
let buildInFlight = null;

/** @type {string|null} */
let buildInFlightKey = null;

export const SEARCH_TYPES = ["account", "contact", "deal", "brief", "call", "task"];

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

function itemSearchText(item) {
  return [item.label, item.subtitle, ...(item.tokens || [])].filter(Boolean).join(" ");
}

function sessionCacheKey(session) {
  const normalized = withEffectiveUserId(session);
  const ownerId = effectiveSessionUserId(normalized);
  const email = normalized?.email ? String(normalized.email).trim().toLowerCase() : "";
  return `${ownerId || ""}|${email}`;
}

function companyFromCallRecord(rec) {
  const a = rec?.analysis || rec?.result?.analysis || {};
  const fromTitle = (rec?.title || a.callHeader?.title || "")
    .split(/[·|–—-]/)[0]
    ?.trim();
  return (
    a.company ||
    a.callHeader?.company ||
    a.callHeader?.account ||
    rec?.result?.confirmed?.company ||
    rec?.result?.resolve?.account?.name ||
    fromTitle ||
    ""
  ).trim();
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

/**
 * Optional RAG embedding rerank — does not block token search.
 * @param {object[]} tokenHits
 * @param {string} query
 * @param {number} [limit]
 */
export async function rerankWithRag(tokenHits, query, limit = 12) {
  const trimmed = String(query || "").trim();
  if (!trimmed || tokenHits.length < 2) return tokenHits.slice(0, limit);

  try {
    const res = await fetch(`${WORKER_BASE_URL}/api/search/rag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: trimmed,
        candidates: tokenHits.map((item) => ({
          id: `${item.type}:${item.id}`,
          type: item.type,
          text: itemSearchText(item),
        })),
      }),
    });
    if (!res.ok) return tokenHits.slice(0, limit);
    const data = await res.json();
    if (!data?.rag || !Array.isArray(data.ranked)) return tokenHits.slice(0, limit);

    const rankMap = new Map(data.ranked.map((r, i) => [r.id, r.score ?? 1 - i * 0.01]));
    const merged = tokenHits
      .map((item, i) => ({
        item,
        ragScore: rankMap.get(`${item.type}:${item.id}`) ?? 0,
        tokenRank: i,
      }))
      .sort((a, b) => {
        if (b.ragScore !== a.ragScore) return b.ragScore - a.ragScore;
        return a.tokenRank - b.tokenRank;
      })
      .map((x) => x.item);
    return merged.slice(0, limit);
  } catch {
    return tokenHits.slice(0, limit);
  }
}

/**
 * Hybrid search: token match first, then optional RAG embedding rerank via worker.
 * @param {object[]} index
 * @param {string} query
 * @param {{ types?: string[], limit?: number, useRag?: boolean }} [opts]
 */
export async function hybridSearch(index, query, opts = {}) {
  const { types, limit = 12, useRag = true } = opts;
  const trimmed = String(query || "").trim();
  if (!trimmed) {
    return searchIndex(index, "", { types, limit });
  }

  const tokenHits = searchIndex(index, trimmed, { types, limit: Math.max(limit * 3, 30) });
  if (!useRag) return tokenHits.slice(0, limit);
  return rerankWithRag(tokenHits, trimmed, limit);
}

/** Recent items when query is empty (top 5 each type cap). */
export function recentFromIndex(index, limit = 5) {
  const byType = { account: [], contact: [], deal: [], brief: [], call: [], task: [] };
  const sorted = index.slice().sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  for (const item of sorted) {
    if (byType[item.type]?.length < limit) byType[item.type].push(item);
  }
  return [
    ...byType.account,
    ...byType.contact,
    ...byType.deal,
    ...byType.brief,
    ...byType.call,
    ...byType.task,
  ].slice(0, limit * 6);
}

export function invalidateSearchIndex() {
  cache.key = null;
  cache.index = null;
  cache.builtAt = 0;
  buildInFlight = null;
  buildInFlightKey = null;
}

/** Cached index for the session, if warm. */
export function getCachedSearchIndex(session) {
  const cacheKey = sessionCacheKey(session);
  if (cache.key === cacheKey && cache.index?.length) return cache.index;
  return null;
}

/** Console-safe diagnostics for production debugging. */
export function getSearchIndexStats(session) {
  const cacheKey = session ? sessionCacheKey(session) : cache.key;
  const counts = {};
  for (const item of cache.index || []) {
    counts[item.type] = (counts[item.type] || 0) + 1;
  }
  return {
    cacheKey: cache.key,
    sessionKey: cacheKey,
    cached: !!(cache.key === cacheKey && cache.index?.length),
    size: cache.index?.length || 0,
    builtAt: cache.builtAt || 0,
    building: !!(buildInFlight && buildInFlightKey === cacheKey),
    counts,
  };
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

/**
 * Sync pass: localStorage history, briefs, and calls — available before Firestore resolves.
 * @param {object[]} index
 * @param {object} normalized
 * @param {Set<string>} seenItemKeys
 * @param {Set<string>} seenContactIds
 */
function indexLocalSources(index, normalized, seenItemKeys, seenContactIds) {
  const email = normalized?.email ? String(normalized.email).trim().toLowerCase() : "";

  function pushItem(item) {
    const key = `${item.type}:${item.id}`;
    if (seenItemKeys.has(key)) return;
    seenItemKeys.add(key);
    index.push(item);
  }

  for (const row of listAccountRowsFromHistory(normalized)) {
    if (!row?.account?.id) continue;
    const lifecycle = row.lifecycle || {};
    const label = row.account.name || lifecycle.title || "Account";
    const subtitle = [row.account.domain, STAGE_LABELS[lifecycle.stage] || lifecycle.stage]
      .filter(Boolean)
      .join(" · ");
    pushItem({
      type: "account",
      id: row.account.id,
      accountId: row.account.id,
      label,
      subtitle,
      tokens: accountRowTokens(row, row.contacts || []),
      lastActivityAt: lifecycle.lastActivityAt || row.lastActivityAt || 0,
    });
  }

  try {
    const { contacts: previewContacts, accountNameById } = historyPreviewContactsForSession(normalized);
    for (const c of previewContacts) {
      if (!c?.id || seenContactIds.has(c.id)) continue;
      seenContactIds.add(c.id);
      const accountName = accountNameById[c.accountId] || "";
      pushItem({
        type: "contact",
        id: c.id,
        accountId: c.accountId || null,
        contactId: c.id,
        email: c.email || null,
        label: c.name || c.email || "Contact",
        subtitle: [c.email, accountName].filter(Boolean).join(" · "),
        tokens: collectTokens([c.name, c.email, accountName, "contact"]),
        lastActivityAt: 0,
      });
    }
  } catch {
    /* history contacts optional */
  }

  for (const row of listDealsFromHistory(normalized)) {
    const { deal, account, primarySeName } = row;
    if (!deal?.id) continue;
    const stageLabel = STAGE_LABELS[deal.stage] || deal.stage || "";
    const typeLabel = DEAL_TYPE_LABELS[deal.type] || deal.type || "";
    pushItem({
      type: "deal",
      id: deal.id,
      accountId: account?.id || deal.accountId,
      dealId: deal.id,
      label: deal.title || account?.name || "Deal",
      subtitle: [account?.name, typeLabel, stageLabel, primarySeName].filter(Boolean).join(" · "),
      tokens: dealRowTokens(row),
      lastActivityAt: deal.lastActivityAt || deal.updatedAt || 0,
    });
  }

  for (const b of loadLocalBriefs()) {
    const label = b.company || b.meta?.company || "Discovery brief";
    const domain = b.meta?.domain || b.meta?.companyDomain || "";
    const subtitle = [domain, b.when, "Discovery brief"].filter(Boolean).join(" · ");
    pushItem({
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
      const company = companyFromCallRecord(r);
      const headline = r.analysis?.callSummary?.headline || r.result?.analysis?.callSummary?.headline || "";
      const label = r.title || headline || company || "Call review";
      const subtitle = [company, headline, r.timestamp ? new Date(r.timestamp).toLocaleDateString() : ""]
        .filter(Boolean)
        .join(" · ");
      pushItem({
        type: "call",
        id: r.id,
        accountId: r.accountId || null,
        label,
        subtitle,
        tokens: collectTokens([label, company, headline, "call", "review"]),
        lastActivityAt: r.timestamp || 0,
      });
    }
  }
}

/**
 * Async pass: Firestore/domain store rows (accounts, deals, tasks).
 * @param {object[]} index
 * @param {object} normalized
 * @param {string|null} ownerId
 * @param {Set<string>} seenItemKeys
 * @param {Set<string>} seenContactIds
 */
async function indexDomainSources(index, normalized, ownerId, seenItemKeys, seenContactIds) {
  const store = getStore();

  function pushItem(item) {
    const key = `${item.type}:${item.id}`;
    if (seenItemKeys.has(key)) return;
    seenItemKeys.add(key);
    index.push(item);
  }

  let rows = [];
  try {
    rows = await listAccountsForSession(normalized);
  } catch (err) {
    console.warn("[search] listAccountsForSession failed:", err?.message || err);
  }

  await Promise.all(
    rows.map(async (row) => {
      if (!row?.account?.id) return;
      try {
        const contacts = store.listContactsByAccount
          ? await store.listContactsByAccount(row.account.id)
          : [];
        const lifecycle = row.lifecycle || {};
        const label = row.account.name || lifecycle.title || "Account";
        const subtitle = [row.account.domain, STAGE_LABELS[lifecycle.stage] || lifecycle.stage]
          .filter(Boolean)
          .join(" · ");
        pushItem({
          type: "account",
          id: row.account.id,
          accountId: row.account.id,
          label,
          subtitle,
          tokens: accountRowTokens(row, contacts),
          lastActivityAt: lifecycle.lastActivityAt || row.lastActivityAt || 0,
        });

        for (const c of contacts) {
          if (!c?.id || seenContactIds.has(c.id)) continue;
          seenContactIds.add(c.id);
          const contactLabel = c.name || c.email || "Contact";
          const contactSub = [c.title, c.email && c.email !== contactLabel ? c.email : "", row.account.name]
            .filter(Boolean)
            .join(" · ");
          pushItem({
            type: "contact",
            id: c.id,
            accountId: row.account.id,
            contactId: c.id,
            email: c.email || null,
            label: contactLabel,
            subtitle: contactSub,
            tokens: collectTokens([c.name, c.email, c.title, c.role, row.account.name, "contact"]),
            lastActivityAt: c.updatedAt || lifecycle.lastActivityAt || row.lastActivityAt || 0,
          });
        }
      } catch (err) {
        console.warn("[search] account row index failed:", row.account?.id, err?.message || err);
      }
    }),
  );

  try {
    const dealRows = await listDealsForSession(normalized);
    for (const row of dealRows) {
      const { deal, account, primarySeName } = row;
      if (!deal?.id) continue;
      const stageLabel = STAGE_LABELS[deal.stage] || deal.stage || "";
      const typeLabel = DEAL_TYPE_LABELS[deal.type] || deal.type || "";
      pushItem({
        type: "deal",
        id: deal.id,
        accountId: account?.id || deal.accountId,
        dealId: deal.id,
        label: deal.title || account?.name || "Deal",
        subtitle: [account?.name, typeLabel, stageLabel, primarySeName].filter(Boolean).join(" · "),
        tokens: dealRowTokens(row),
        lastActivityAt: deal.lastActivityAt || deal.updatedAt || 0,
      });
    }
  } catch (err) {
    console.warn("[search] listDealsForSession failed:", err?.message || err);
  }

  if (ownerId && store.listLifecyclesByOwner) {
    try {
      const lifecycles = await store.listLifecyclesByOwner(ownerId);
      for (const lc of lifecycles) {
        const tasks = store.listTasksByLifecycle ? await store.listTasksByLifecycle(lc.id) : [];
        for (const t of tasks) {
          if (t.status === "completed" || t.status === "dismissed") continue;
          pushItem({
            type: "task",
            id: t.id,
            accountId: t.accountId || lc.accountId,
            lifecycleId: lc.id,
            label: t.title || "Task",
            subtitle: [t.status, lc.title].filter(Boolean).join(" · "),
            tokens: collectTokens([t.title, t.description, t.status, "task"]),
            lastActivityAt: t.updatedAt || t.createdAt || 0,
          });
        }
      }
    } catch {
      /* tasks optional */
    }
  }
}

async function buildSearchIndexInternal(normalized, cacheKey) {
  // #region agent log
  const perfStart = Date.now();
  // #endregion
  const ownerId = effectiveSessionUserId(normalized);
  const email = normalized?.email ? String(normalized.email).trim().toLowerCase() : "";
  const index = [];
  const seenItemKeys = new Set();
  const seenContactIds = new Set();

  indexLocalSources(index, normalized, seenItemKeys, seenContactIds);
  // #region agent log
  const localMs = Date.now() - perfStart;
  const domainStart = Date.now();
  // #endregion

  if (email || ownerId) {
    await indexDomainSources(index, normalized, ownerId, seenItemKeys, seenContactIds);
  }
  // #region agent log
  const domainMs = Date.now() - domainStart;
  fetch("http://127.0.0.1:7865/ingest/46e458f7-44ce-49a5-87ef-1bb8839e9c5e", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e10083" },
    body: JSON.stringify({
      sessionId: "e10083",
      runId: "perf-check",
      hypothesisId: "H1-skipCache",
      location: "search-service.js:buildSearchIndexInternal",
      message: "search index build timing",
      data: { localMs, domainMs, totalMs: Date.now() - perfStart, indexSize: index.length, ownerId: !!ownerId },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  if (index.length) {
    cache.key = cacheKey;
    cache.index = index;
    cache.builtAt = Date.now();
    if (typeof console !== "undefined" && console.debug) {
      console.debug("[search] index built", getSearchIndexStats(normalized));
    }
  } else {
    cache.key = null;
    cache.index = null;
    cache.builtAt = 0;
    console.warn("[search] index empty", { email, ownerId, cacheKey });
  }
  return index;
}

/** @param {object|null} session */
export async function buildSearchIndex(session) {
  const normalized = withEffectiveUserId(session);
  const cacheKey = sessionCacheKey(normalized);
  if (cache.key === cacheKey && cache.index?.length) return cache.index;

  if (buildInFlight && buildInFlightKey === cacheKey) {
    return buildInFlight;
  }

  buildInFlightKey = cacheKey;
  buildInFlight = buildSearchIndexInternal(normalized, cacheKey).finally(() => {
    if (buildInFlightKey === cacheKey) {
      buildInFlight = null;
      buildInFlightKey = null;
    }
  });
  return buildInFlight;
}
