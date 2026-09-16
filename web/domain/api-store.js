/**
 * Hybrid domain store — read mapped aggregates via worker API; delegate everything else to Firestore client SDK.
 */

import { createFirestoreStore } from "./firestore-store.js";
import { isHistoryStubId } from "./safe-store.js";
import { dispatchAssumeIdentityExpiredIfNeeded } from "../assume-identity-client.js";

export { isHistoryStubId } from "./safe-store.js";

const DETAIL_TTL_MS = 30_000;
const DETAIL_MAX_ENTRIES = 64;
const DEALS_LIST_TTL_MS = 30_000;
// A 404 on one endpoint must never disable every other apiFetch call for
// the rest of the page session -- a prior "silence repeated 404s" flag here
// did exactly that, and once apiFetch started carrying real writes
// (upsertScorecard, createDeal, etc.), it turned one dead, never-implemented
// endpoint (POST /api/postcall/cache/prepare) into a session-wide write
// blackout: every subsequent write threw client-side before ever reaching
// the server, with no server-side trace at all. Removed.
const deprecatedReadWarnings = new Set();

function allowScopedListFallback() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("ALLOW_LIST_FALLBACK") === "1";
  } catch {
    return false;
  }
}

function logScopedReadFailed(label, err) {
  console.warn(`[api-store] scoped read failed (${label}):`, err?.message || err);
}

const API_FIRST_LOOKUP_METHODS = new Set([
  "findAccountBySlug",
  "findAccountsByDomain",
  "findAccountsByName",
  "findContactsByEmail",
  "findContactByAccountEmail",
  "listContactsByAccount",
  "findDealContact",
  "listContactsByDeal",
  "findActiveLifecycle",
  "findActiveLifecycleByDeal",
  "findLifecycleByDealAndOwner",
  "listActiveLifecyclesForAccount",
  "getLifecycle",
  "listLifecycleEvents",
  "listPrepBriefsByLifecycle",
  "listPostCallsByLifecycle",
  "listPostCallsByAccount",
  "findPostCallByIdentity",
  "listTasksByLifecycle",
  "findActiveDeal",
  "findWonNbDealInGrace",
  "listDealsByAccount",
]);

/** @typedef {{ value: object, expiresAt: number }} DetailCacheEntry */

/** @param {Map<string, DetailCacheEntry>} cache @param {string} key */
function peekDetail(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

/** @param {Map<string, DetailCacheEntry>} cache @param {string} key @param {object} value */
function putDetail(cache, key, value) {
  if (cache.size >= DETAIL_MAX_ENTRIES && !cache.has(key)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + DETAIL_TTL_MS });
}

/** @param {Map<string, DetailCacheEntry>} cache @param {string} key */
function invalidateDetail(cache, key) {
  cache.delete(String(key || ""));
}

function warnDeprecatedReadPath(name) {
  if (deprecatedReadWarnings.has(name)) return;
  deprecatedReadWarnings.add(name);
  console.warn(`[api-store] ${name} is deprecated for read views; use Firestore realtime reads.`);
}

function normalizeDomain(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

function normalizeName(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sortByUpdated(rows) {
  return [...(rows || [])].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function sortByActivity(rows) {
  return [...(rows || [])].sort(
    (a, b) =>
      (b.lastActivityAt || b.updatedAt || b.createdAt || 0) -
      (a.lastActivityAt || a.updatedAt || a.createdAt || 0),
  );
}

const CALL_DETAIL_WRITE_METHODS = new Set([
  "upsertPostCall",
  "upsertCallSummary",
  "deleteTranscriptTimelineByCall",
  "upsertScorecard",
  "upsertScorecardLine",
  "deleteScorecard",
  "deleteScorecardLinesByScorecardId",
  "upsertVideoFacts",
  "deleteVideoFacts",
  "upsertTimelineSegment",
  "deleteTimelineSegmentsByVideoFactsId",
  "upsertTimelineMarker",
  "upsertFollowUp",
  "deleteFollowUp",
  "upsertObjection",
  "deleteObjection",
  "upsertMomDraft",
  "deleteMomDraft",
  "upsertMeddpiccDelta",
  "deleteMeddpiccDelta",
  "upsertDealSignal",
  "deleteDealSignal",
  "upsertArrLine",
  "deleteArrLine",
  "upsertTcDelta",
  "deleteTcDelta",
  "upsertProductGap",
  "upsertWhatWorks",
]);

const DEAL_DETAIL_WRITE_METHODS = new Set([
  "updateDeal",
  "upsertDealSummary",
  "setPrimaryDealContact",
  "upsertTechnicalCommit",
  "upsertArrOverride",
]);

const ADMIN_WRITE_METHODS = new Set([
  "createAccount",
  "updateAccount",
  "createContact",
  "updateContact",
  "createDeal",
  "updateDeal",
  "createDealContact",
  "setPrimaryDealContact",
  "removeDealContact",
  "addContactEvent",
  "createLifecycle",
  "updateLifecycle",
  "addLifecycleEvent",
  "createPrepBrief",
  "createTask",
  "updateTask",
  "deleteTask",
  "upsertPostCall",
  "upsertCallSummary",
  "upsertPostCallWithSummary",
  "upsertScorecard",
  "upsertScorecardLine",
  "deleteScorecard",
  "deleteScorecardLinesByScorecardId",
  "upsertVideoFacts",
  "deleteVideoFacts",
  "deleteTimelineSegmentsByVideoFactsId",
  "deleteTranscriptTimelineByCall",
  "upsertTimelineSegment",
  "upsertTimelineMarker",
  "upsertFollowUp",
  "deleteFollowUp",
  "upsertObjection",
  "deleteObjection",
  "upsertMomDraft",
  "deleteMomDraft",
  "upsertMeddpiccDelta",
  "deleteMeddpiccDelta",
  "upsertDealSignal",
  "deleteDealSignal",
  "upsertArrLine",
  "deleteArrLine",
  "upsertTcDelta",
  "deleteTcDelta",
  "upsertTechnicalCommit",
  "upsertArrOverride",
  "upsertProductGap",
  "upsertWhatWorks",
  "upsertGapCluster",
  "upsertClusteringState",
]);

/** @param {string} method @param {unknown[]} args */
function invalidateAfterWrite(method, args, callDetailCache, dealDetailCache) {
  if (method === "upsertPostCallWithSummary") {
    invalidateDetail(callDetailCache, args[0]?.id);
    return;
  }
  if (method === "deleteTranscriptTimelineByCall") {
    invalidateDetail(callDetailCache, args[0]);
    return;
  }
  if (method === "upsertPostCall" || method === "upsertCallSummary") {
    invalidateDetail(callDetailCache, args[0]?.id);
    return;
  }
  if (method === "updateDeal" || method === "setPrimaryDealContact") {
    invalidateDetail(dealDetailCache, args[0]);
    return;
  }
  if (method === "upsertDealSummary") {
    invalidateDetail(dealDetailCache, args[0]?.id || args[0]?.dealId);
    return;
  }
  const doc = args[0];
  if (doc && typeof doc === "object") {
    const callId = doc.callId || doc.postCallId;
    if (callId) invalidateDetail(callDetailCache, callId);
    const dealId = doc.dealId;
    if (dealId && (method === "upsertArrLine" || method === "upsertDealSignal" || method === "upsertTechnicalCommit")) {
      invalidateDetail(dealDetailCache, dealId);
    }
  }
}

/** @param {{ workerBaseUrl: string, getToken?: () => Promise<string|undefined>, fb: object }} opts */
export function createApiStore({ workerBaseUrl, getToken, fb }) {
  const base = String(workerBaseUrl || "").replace(/\/$/, "");
  const firestoreDelegate = fb?.db ? createFirestoreStore(fb) : null;
  /** @type {Map<string, DetailCacheEntry>} */
  const callDetailCache = new Map();
  /** @type {Map<string, DetailCacheEntry>} */
  const dealDetailCache = new Map();
  /** @type {{ at: number, deals: object[] } | null} */
  let dealsListCache = null;
  /** @type {Promise<object[]> | null} in-flight de-dupe — see loadDealsList. */
  let dealsListInflight = null;
  /** @type {{ at: number, accounts: object[] } | null} */
  let accountsListCache = null;
  /** @type {Promise<object[]> | null} in-flight de-dupe — see loadAccountsList. */
  let accountsListInflight = null;
  /** @type {Map<string, Promise<object[]>>} */
  const dealsByAccountInflight = new Map();

  async function apiFetch(path, init = {}) {
    const headers = { Accept: "application/json" };
    if (init.body) headers["Content-Type"] = "application/json";
    const token = getToken ? await getToken() : undefined;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${path}`, { ...init, headers, credentials: "include" });
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error("Not found.");
      }
      const body = await res.json().catch(() => ({}));
      dispatchAssumeIdentityExpiredIfNeeded(res, body);
      throw new Error(body?.error || `API ${res.status}: ${path}`);
    }
    return res.json();
  }

  async function adminWrite(method, args) {
    const data = await apiFetch("/api/domain-write", {
      method: "POST",
      body: JSON.stringify({ method, args }),
    });
    return data?.result ?? null;
  }

  async function loadCallDetail(id) {
    warnDeprecatedReadPath("getPostCallDetail");
    const key = String(id || "");
    if (isHistoryStubId(key)) return { postCall: null };
    const cached = peekDetail(callDetailCache, key);
    if (cached) return cached;
    try {
      const detail = await apiFetch(`/api/calls/${encodeURIComponent(key)}`);
      putDetail(callDetailCache, key, detail);
      return detail;
    } catch (err) {
      const msg = String(err?.message || err);
      if (!/404|not found/i.test(msg)) throw err;
      const postCall = await firestoreDelegate?.getPostCall(key);
      if (!postCall) throw err;
      const detail = { postCall, ...(postCall.detail || {}) };
      putDetail(callDetailCache, key, detail);
      return detail;
    }
  }

  async function loadDealDetail(id) {
    warnDeprecatedReadPath("getDealDetail");
    const key = String(id || "");
    const cached = peekDetail(dealDetailCache, key);
    if (cached) return cached;
    const detail = await apiFetch(`/api/deals/${encodeURIComponent(key)}`);
    putDetail(dealDetailCache, key, detail);
    return detail;
  }

  // UAT-007 note: loadDealsList/loadAccountsList are called once per unique
  // account from calls-list-view.js's enrichDealsAndAccounts (via
  // listDealsForAccount -> listDealsByAccount -> loadDealsList, and now also
  // via listAccounts -> loadAccountsList), fired concurrently with
  // Promise.all. The at-timestamp cache below only protects repeat calls
  // that arrive AFTER a fetch has resolved -- concurrent callers that all
  // see a cold/expired cache in the same tick each start their own fetch to
  // the identical URL, which is exactly the "one network round trip per
  // unique account" fan-out from the UAT-007 report. dealsListInflight /
  // accountsListInflight close that race: every caller that arrives while a
  // fetch is already in flight awaits that SAME promise instead of starting
  // a new request, so N concurrent callers cost one real round trip.
  async function loadDealsList(limit = 300) {
    warnDeprecatedReadPath("listDeals");
    if (dealsListCache && Date.now() - dealsListCache.at < DEALS_LIST_TTL_MS) {
      return dealsListCache.deals;
    }
    if (dealsListInflight) return dealsListInflight;
    dealsListInflight = (async () => {
      try {
        const data = await apiFetch(`/api/deals?scope=own&limit=${encodeURIComponent(String(limit))}`);
        const deals = data.deals || [];
        dealsListCache = { at: Date.now(), deals };
        return deals;
      } finally {
        dealsListInflight = null;
      }
    })();
    return dealsListInflight;
  }

  async function loadAccountsList() {
    if (accountsListCache && Date.now() - accountsListCache.at < DEALS_LIST_TTL_MS) {
      return accountsListCache.accounts;
    }
    if (accountsListInflight) return accountsListInflight;
    accountsListInflight = (async () => {
      try {
        const data = await apiFetch("/api/accounts");
        const accounts = data.accounts || [];
        accountsListCache = { at: Date.now(), accounts };
        return accounts;
      } finally {
        accountsListInflight = null;
      }
    })();
    return accountsListInflight;
  }

  async function loadDealsByAccount(accountId) {
    const key = String(accountId || "");
    if (!key || isHistoryStubId(key)) return [];
    if (dealsByAccountInflight.has(key)) return dealsByAccountInflight.get(key);
    const promise = (async () => {
      try {
        const data = await apiFetch(`/api/accounts/${encodeURIComponent(key)}/deals`);
        return sortByActivity(data.deals || []);
      } catch (err) {
        logScopedReadFailed(`dealsByAccount:${key}`, err);
        if (allowScopedListFallback()) {
          const all = await loadDealsList(300);
          return sortByActivity(all.filter((d) => d.accountId === key));
        }
        return [];
      } finally {
        dealsByAccountInflight.delete(key);
      }
    })();
    dealsByAccountInflight.set(key, promise);
    return promise;
  }

  async function loadAccountsByDomain(domain) {
    const key = normalizeDomain(domain);
    if (!key) return [];
    try {
      const data = await apiFetch(`/api/accounts?domain=${encodeURIComponent(key)}`);
      return sortByUpdated(data.accounts || []);
    } catch (err) {
      logScopedReadFailed(`accountsByDomain:${key}`, err);
      if (allowScopedListFallback()) {
        const accounts = await loadAccountsList();
        return sortByUpdated(accounts.filter((a) => normalizeDomain(a.domain) === key));
      }
      return [];
    }
  }

  async function loadAccountsByName(nameQuery) {
    const key = normalizeName(nameQuery);
    if (!key) return [];
    try {
      const data = await apiFetch(`/api/accounts?name=${encodeURIComponent(nameQuery.trim())}`);
      return sortByUpdated(data.accounts || []);
    } catch (err) {
      logScopedReadFailed(`accountsByName:${key}`, err);
      if (allowScopedListFallback()) {
        const accounts = await loadAccountsList();
        return sortByUpdated(accounts.filter((a) => normalizeName(a.name) === key));
      }
      return [];
    }
  }

  async function loadAccountBySlug(slug) {
    const key = String(slug || "").trim();
    if (!key) return null;
    try {
      const data = await apiFetch(`/api/accounts?slug=${encodeURIComponent(key)}`);
      const rows = data.accounts || [];
      return rows[0] || null;
    } catch (err) {
      logScopedReadFailed(`accountBySlug:${key}`, err);
      if (allowScopedListFallback()) {
        const accounts = await loadAccountsList();
        return (
          accounts.find((a) => String(a.slug || "").trim() === key) ||
          accounts.find((a) => (a.metadata?.slugAliases || []).some((alias) => String(alias || "").trim() === key)) ||
          null
        );
      }
      return null;
    }
  }

  async function loadCallsList(scope = "own", limit = 200) {
    const data = await apiFetch(
      `/api/calls?scope=${encodeURIComponent(scope)}&limit=${encodeURIComponent(String(limit))}`,
    );
    return data.calls || [];
  }

  async function listDealSignalsByDealApi(dealId, limitCount = 50) {
    if (isHistoryStubId(dealId)) return [];
    try {
      const detail = await loadDealDetail(dealId);
      return (detail?.dealSignals || []).slice(0, limitCount);
    } catch {
      return [];
    }
  }

  async function listArrLinesByDealApi(dealId, limitCount = 200) {
    warnDeprecatedReadPath("listArrLinesByDeal");
    if (isHistoryStubId(dealId)) return [];
    try {
      const detail = await loadDealDetail(dealId);
      return (detail?.arrLines || []).slice(0, limitCount);
    } catch {
      return [];
    }
  }

  async function listProductGapsByDealApi(dealId, limitCount = 500) {
    if (isHistoryStubId(dealId)) return [];
    try {
      const detail = await loadDealDetail(dealId);
      if (detail?.productGaps?.length) return detail.productGaps.slice(0, limitCount);
    } catch {
      /* fall through */
    }
    if (firestoreDelegate?.listProductGapsByDeal) {
      return firestoreDelegate.listProductGapsByDeal(dealId, limitCount);
    }
    return [];
  }

  async function listWhatWorksByDealApi(dealId, limitCount = 500) {
    if (isHistoryStubId(dealId)) return [];
    try {
      const detail = await loadDealDetail(dealId);
      if (detail?.whatWorks?.length) return detail.whatWorks.slice(0, limitCount);
    } catch {
      /* fall through */
    }
    if (firestoreDelegate?.listWhatWorksByDeal) {
      return firestoreDelegate.listWhatWorksByDeal(dealId, limitCount);
    }
    return [];
  }

  const apiReads = {
    mode: "api",

    get readCacheEnabled() {
      return firestoreDelegate?.readCacheEnabled ?? false;
    },
    set readCacheEnabled(v) {
      if (firestoreDelegate) firestoreDelegate.readCacheEnabled = v;
    },

    async getPostCall(id) {
      if (isHistoryStubId(id)) return null;
      const detail = await loadCallDetail(id);
      return detail?.postCall || null;
    },

    async getPostCallDetail(id) {
      if (isHistoryStubId(id)) return null;
      return loadCallDetail(id);
    },

    async getCall(id) {
      return this.getPostCall(id);
    },

    async listPostCallsByOwner(ownerId, limit = 200) {
      if (firestoreDelegate?.listPostCallsByOwner) {
        try {
          return await firestoreDelegate.listPostCallsByOwner(ownerId, limit);
        } catch (err) {
          const msg = String(err?.message || err);
          if (!/permission|denied|unavailable|index/i.test(msg)) {
            console.warn("[api-store] listPostCallsByOwner firestore failed:", msg);
          }
        }
      }
      try {
        const data = await apiFetch(`/api/calls?scope=own&limit=${encodeURIComponent(String(limit))}`);
        return data.calls || [];
      } catch (err) {
        if (firestoreDelegate?.listPostCallsByOwner) {
          return firestoreDelegate.listPostCallsByOwner(ownerId, limit);
        }
        throw err;
      }
    },

    async listPostCallsByTeam(_teamId, limit = 200) {
      const data = await apiFetch(`/api/calls?scope=team&limit=${encodeURIComponent(String(limit))}`);
      return data.calls || [];
    },

    async listPostCallsByOrg(_orgId, limit = 200) {
      const data = await apiFetch(`/api/calls?scope=org&limit=${encodeURIComponent(String(limit))}`);
      return data.calls || [];
    },

    async listCallSummariesByOwner(ownerId, limit = 200) {
      if (firestoreDelegate?.listCallSummariesByOwner) {
        return firestoreDelegate.listCallSummariesByOwner(ownerId, limit);
      }
      const data = await apiFetch(`/api/calls?scope=own&limit=${encodeURIComponent(String(limit))}`);
      return data.calls || [];
    },

    async listCallSummariesByTeam(teamId, limit = 200) {
      if (firestoreDelegate?.listCallSummariesByTeam) {
        return firestoreDelegate.listCallSummariesByTeam(teamId, limit);
      }
      const data = await apiFetch(`/api/calls?scope=team&limit=${encodeURIComponent(String(limit))}`);
      return data.calls || [];
    },

    async listCallSummariesByOrg(orgId, limit = 200) {
      if (firestoreDelegate?.listCallSummariesByOrg) {
        return firestoreDelegate.listCallSummariesByOrg(orgId, limit);
      }
      const data = await apiFetch(`/api/calls?scope=org&limit=${encodeURIComponent(String(limit))}`);
      return data.calls || [];
    },

    // SQL-backed, not Firestore: buildSummariesContext (summaries-service.js)
    // used to read Firestore's callSummaries thin-list projection, which had
    // no security rule at all -- every client read was silently denied. This
    // reads directly from Postgres via worker/src/routes/domain-reads.ts's
    // handleDealCallsGet/handleAccountCallsGet.
    async listCallSummariesByDeal(dealId, limit = 50) {
      if (isHistoryStubId(dealId)) return [];
      const data = await apiFetch(`/api/deals/${encodeURIComponent(dealId)}/calls?limit=${encodeURIComponent(String(limit))}`);
      return data?.calls || [];
    },

    async listCallSummariesByAccount(accountId, limit = 80) {
      if (isHistoryStubId(accountId)) return [];
      const data = await apiFetch(`/api/accounts/${encodeURIComponent(accountId)}/calls?limit=${encodeURIComponent(String(limit))}`);
      return data?.calls || [];
    },

    async findPostCallByIdentity(ownerId, callIdentityKey) {
      const key = String(callIdentityKey || "");
      if (!ownerId || !key) return null;
      const calls = await loadCallsList("own", 200);
      return calls.find((c) => c.ownerId === ownerId && c.callIdentityKey === key) || null;
    },

    async listPostCallsByLifecycle(lifecycleId, limit = 200) {
      if (!lifecycleId) return [];
      const calls = await loadCallsList("own", limit);
      return calls.filter((c) => c.lifecycleId === lifecycleId).slice(0, limit);
    },

    async listPostCallsByAccount(accountId, limit = 80) {
      if (!accountId) return [];
      const calls = await loadCallsList("own", Math.max(limit, 200));
      return calls.filter((c) => c.accountId === accountId).slice(0, limit);
    },

    // getUserByEmail/getUserIdByAuthUid/getUser were never implemented here
    // (added 2026-09-08) -- enrichSessionFromStore (user-resolve.js) depends
    // on them to resolve session.userId at login, and with all three
    // undefined it silently failed for every SE session, every login.
    // session.userId never got set, so every fallback throughout the app
    // (effectiveSessionUserId, resolveEffectiveOwnerId included) computed
    // the same usr_dummy_<email> placeholder -- the source of the
    // "id_registry: no mapping for app_user/usr_dummy_..." errors seen
    // throughout staging. /api/users/me is self-only (resolved from the
    // caller's own verified identity), so these can only ever resolve the
    // current session's own record -- a lookup for anyone else correctly
    // misses and falls through to firestoreDelegate, same as before.
    async getUserByEmail(email) {
      const key = String(email || "").trim().toLowerCase();
      try {
        const me = await apiFetch("/api/users/me");
        if (me?.id && String(me.email || "").trim().toLowerCase() === key) return me;
      } catch (err) {
        /* fall through */
      }
      return firestoreDelegate?.getUserByEmail ? firestoreDelegate.getUserByEmail(email) : null;
    },

    async getUserIdByAuthUid(authUid) {
      try {
        const me = await apiFetch("/api/users/me");
        if (me?.id && me.authUid === authUid) return me.id;
      } catch (err) {
        /* fall through */
      }
      return firestoreDelegate?.getUserIdByAuthUid ? firestoreDelegate.getUserIdByAuthUid(authUid) : null;
    },

    async getUser(id) {
      try {
        const me = await apiFetch("/api/users/me");
        if (me?.id && me.id === id) return me;
      } catch (err) {
        /* fall through */
      }
      return firestoreDelegate?.getUser ? firestoreDelegate.getUser(id) : null;
    },

    // upsertFirebaseUser (user-resolve.js) calls both of these
    // unconditionally after resolving the real profile via getUserByEmail/
    // getUser above, and its caller (persistFirebaseSession, auth.js)
    // discards that whole resolution -- falling back to the
    // usr_dummy_<email> placeholder -- if either throws. For managers
    // (firestoreDelegate present) keep the existing Firestore write exactly
    // as before; for SE/API-only sessions there's nothing to upsert
    // client-side (app_user rows are provisioned server-side via migration/
    // admin), so these must just not throw.
    async upsertUser(profile) {
      if (firestoreDelegate?.upsertUser) return firestoreDelegate.upsertUser(profile);
      return profile;
    },

    async upsertAuthIndex(authUid, userId, email) {
      if (firestoreDelegate?.upsertAuthIndex) return firestoreDelegate.upsertAuthIndex(authUid, userId, email);
    },

    async getAccount(id) {
      if (isHistoryStubId(id)) return null;
      try {
        const data = await apiFetch(`/api/accounts/${encodeURIComponent(String(id))}`);
        return data?.account || null;
      } catch (err) {
        const msg = String(err?.message || err);
        if (!/404|not found/i.test(msg)) {
          const fallback = await firestoreDelegate?.getAccount(id);
          if (fallback) return fallback;
        }
        if (/404|not found/i.test(msg)) return null;
        throw err;
      }
    },

    async listAccounts() {
      try {
        return await loadAccountsList();
      } catch (err) {
        return firestoreDelegate?.listAccounts ? firestoreDelegate.listAccounts() : [];
      }
    },

    async findAccountBySlug(slug) {
      return loadAccountBySlug(slug);
    },

    async findAccountsByDomain(domain) {
      return loadAccountsByDomain(domain);
    },

    async findAccountsByName(nameQuery) {
      return loadAccountsByName(nameQuery);
    },

    // These three now call the Postgres-backed /api/contacts routes (added
    // 2026-09-08 -- contacts had no read repository wired up at all before
    // this, so they went straight to Firestore regardless of PERSISTENCE_MODE).
    // Firestore fallback stays as a safety net for a genuine API failure,
    // same pattern as getAccount above.
    async findContactsByEmail(email) {
      try {
        const data = await apiFetch(`/api/contacts?email=${encodeURIComponent(email)}`);
        return data?.contacts || [];
      } catch (err) {
        return firestoreDelegate?.findContactsByEmail
          ? firestoreDelegate.findContactsByEmail(email)
          : [];
      }
    },

    async findContactByAccountEmail(accountId, email) {
      try {
        const data = await apiFetch(
          `/api/accounts/${encodeURIComponent(accountId)}/contacts?email=${encodeURIComponent(email)}`,
        );
        return data?.contact || null;
      } catch (err) {
        return firestoreDelegate?.findContactByAccountEmail
          ? firestoreDelegate.findContactByAccountEmail(accountId, email)
          : null;
      }
    },

    async listContactsByAccount(accountId) {
      try {
        const data = await apiFetch(`/api/accounts/${encodeURIComponent(accountId)}/contacts`);
        return data?.contacts || [];
      } catch (err) {
        return firestoreDelegate?.listContactsByAccount
          ? firestoreDelegate.listContactsByAccount(accountId)
          : [];
      }
    },

    async findDealContact(_dealId, _contactId) {
      return null;
    },

    async listContactsByDeal(_dealId) {
      return [];
    },

    async getDeal(id) {
      if (isHistoryStubId(id)) return null;
      const detail = await loadDealDetail(id);
      return detail?.deal || null;
    },

    async getDealDetail(id) {
      if (isHistoryStubId(id)) return null;
      return loadDealDetail(id);
    },

    async listDealsByAccount(accountId, ownerId, opts = {}) {
      if (isHistoryStubId(accountId)) return [];
      const teamId = opts.teamId || null;
      const ownerFilter =
        typeof ownerId === "string" && ownerId ? ownerId : null;
      let rows = await loadDealsByAccount(accountId);
      if (ownerFilter) rows = rows.filter((d) => d.ownerId === ownerFilter);
      if (teamId) rows = rows.filter((d) => d.teamId === teamId);
      return sortByActivity(rows);
    },

    async findActiveDeal(accountId, type, opts = {}) {
      if (!accountId || !type) return null;
      const rows = await this.listDealsByAccount(accountId, opts.ownerId || null, opts);
      const statuses = opts.includeGrace === true ? ["active", "closed_won_grace"] : ["active"];
      return rows.find((d) => d.type === type && statuses.includes(d.status || "active")) || null;
    },

    async findWonNbDealInGrace(_accountId, _asOfMs = Date.now()) {
      return null;
    },

    async getLifecycle(_id) {
      return null;
    },

    async findActiveLifecycle(_ownerId, _accountId) {
      return null;
    },

    async findActiveLifecycleByDeal(_ownerId, _accountId, _dealId) {
      return null;
    },

    async findLifecycleByDealAndOwner(_dealId, _ownerId) {
      return null;
    },

    async listActiveLifecyclesForAccount(_accountId, _opts = {}) {
      return [];
    },

    async listLifecycleEvents(_lifecycleId) {
      return [];
    },

    async listPrepBriefsByLifecycle(_lifecycleId, _ownerId) {
      return [];
    },

    async listTasksByLifecycle(_lifecycleId) {
      return [];
    },

    async listDealsByOwner(_ownerId, limit = 300) {
      warnDeprecatedReadPath("listDeals");
      const data = await apiFetch(`/api/deals?scope=own&limit=${encodeURIComponent(String(limit))}`);
      return data.deals || [];
    },

    async createDealViaWorker(deal) {
      const data = await apiFetch("/api/deals", {
        method: "POST",
        body: JSON.stringify(deal || {}),
      });
      dealsListCache = null;
      return {
        ...deal,
        id: data.dealId,
        ownerId: data.ownerId || deal?.ownerId,
      };
    },

    async getReadModel(collection, id) {
      if (!id) return null;
      try {
        return await apiFetch(`/api/read-models/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`);
      } catch {
        return null;
      }
    },

    async getReadModels(collection, ids) {
      const unique = [...new Set((ids || []).filter(Boolean))];
      if (!unique.length) return [];
      const rows = await Promise.all(
        unique.map((id) =>
          apiFetch(
            `/api/read-models/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
          ).catch(() => null),
        ),
      );
      return rows.filter(Boolean);
    },

    async listDealSignalsByDeal(dealId, limitCount = 50) {
      return listDealSignalsByDealApi(dealId, limitCount);
    },

    async listDealSignalsForDeals(dealIds, perDealLimit = 1) {
      const ids = [...new Set((dealIds || []).filter(Boolean))];
      /** @type {Map<string, object[]>} */
      const byDeal = new Map();
      if (!ids.length) return byDeal;
      await Promise.all(
        ids.map(async (dealId) => {
          const signals = await listDealSignalsByDealApi(dealId, perDealLimit);
          if (signals.length) byDeal.set(dealId, signals);
        }),
      );
      return byDeal;
    },

    async listArrLinesByDeal(dealId, limitCount = 200) {
      return listArrLinesByDealApi(dealId, limitCount);
    },

    async listArrLinesForDeals(dealIds) {
      const ids = [...new Set((dealIds || []).filter(Boolean))];
      /** @type {Map<string, object[]>} */
      const byDeal = new Map();
      if (!ids.length) return byDeal;
      await Promise.all(
        ids.map(async (dealId) => {
          const lines = await listArrLinesByDealApi(dealId, 200);
          if (lines.length) byDeal.set(dealId, lines);
        }),
      );
      return byDeal;
    },

    async listTechnicalCommitsByOrg(_orgId, _limitCount = 500) {
      return [];
    },

    async listScorecardsByCall(callId) {
      if (isHistoryStubId(callId)) return [];
      const detail = await loadCallDetail(callId);
      return detail?.scorecards || [];
    },

    async listVideoFactsByCall(callId) {
      if (isHistoryStubId(callId)) return [];
      const detail = await loadCallDetail(callId);
      return detail?.videoFacts || [];
    },

    async listTimelineSegmentsByCall(callId) {
      if (isHistoryStubId(callId)) return [];
      const detail = await loadCallDetail(callId);
      return detail?.timelineSegments || [];
    },

    async listTimelineMarkersByCall(callId) {
      if (isHistoryStubId(callId)) return [];
      const detail = await loadCallDetail(callId);
      return detail?.timelineMarkers || [];
    },

    async listFollowUpsByCall(callId) {
      if (isHistoryStubId(callId)) return [];
      const detail = await loadCallDetail(callId);
      return detail?.followUps || [];
    },

    async listObjectionsByCall(callId) {
      if (isHistoryStubId(callId)) return [];
      const detail = await loadCallDetail(callId);
      return detail?.objections || [];
    },

    async listMomDraftsByCall(callId) {
      if (isHistoryStubId(callId)) return [];
      const detail = await loadCallDetail(callId);
      return detail?.momDrafts || [];
    },

    async listMeddpiccDeltasByCall(callId) {
      if (isHistoryStubId(callId)) return [];
      const detail = await loadCallDetail(callId);
      return detail?.meddpiccDeltas || [];
    },

    async listTcDeltasByCall(callId) {
      if (isHistoryStubId(callId)) return [];
      const detail = await loadCallDetail(callId);
      return detail?.tcDeltas || [];
    },

    async listArrLinesByCall(callId) {
      if (isHistoryStubId(callId)) return [];
      const detail = await loadCallDetail(callId);
      return detail?.arrLines || [];
    },

    async listDealSignalsByCall(callId) {
      if (isHistoryStubId(callId)) return [];
      const detail = await loadCallDetail(callId);
      return detail?.dealSignals || [];
    },

    async listProductGapsByDeal(dealId, limitCount = 500) {
      return listProductGapsByDealApi(dealId, limitCount);
    },

    async listWhatWorksByDeal(dealId, limitCount = 500) {
      return listWhatWorksByDealApi(dealId, limitCount);
    },
  };

  for (const method of ADMIN_WRITE_METHODS) {
    if (!(method in apiReads)) {
      apiReads[method] = async (...args) => {
        const result = await adminWrite(method, args);
        invalidateAfterWrite(method, args, callDetailCache, dealDetailCache);
        if (method.startsWith("create") || method.startsWith("update") || method.startsWith("upsert")) {
          dealsListCache = null;
          accountsListCache = null;
        }
        return result;
      };
    }
  }

  if (!firestoreDelegate) {
    // SE users (fb.db === null) have no Firestore delegate — return API reads directly.
    return Object.assign(Object.create(null), {
      readMode: "api",
      mode: "api",
      ...apiReads,
    });
  }

  return new Proxy(firestoreDelegate, {
    get(target, prop, receiver) {
      if (prop in apiReads) return apiReads[prop];
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      const method = String(prop);
      if (API_FIRST_LOOKUP_METHODS.has(method)) return undefined;
      if (!CALL_DETAIL_WRITE_METHODS.has(method) && !DEAL_DETAIL_WRITE_METHODS.has(method)) {
        return value.bind(target);
      }
      return async (...args) => {
        const result = await value.apply(target, args);
        invalidateAfterWrite(method, args, callDetailCache, dealDetailCache);
        return result;
      };
    },
    set(target, prop, value, receiver) {
      if (prop === "readCacheEnabled") {
        target.readCacheEnabled = value;
        return true;
      }
      return Reflect.set(target, prop, value, receiver);
    },
  });
}
