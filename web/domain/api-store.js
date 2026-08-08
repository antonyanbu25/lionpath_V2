/**
 * Hybrid domain store — read mapped aggregates via worker API; delegate everything else to Firestore client SDK.
 */

import { createFirestoreStore } from "./firestore-store.js";
import { isHistoryStubId } from "./safe-store.js";

export { isHistoryStubId } from "./safe-store.js";

const DETAIL_TTL_MS = 30_000;
const DETAIL_MAX_ENTRIES = 64;
const DEALS_LIST_TTL_MS = 30_000;
let apiStoreUnavailable = false;
const deprecatedReadWarnings = new Set();

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

const CALL_DETAIL_WRITE_METHODS = new Set([
  "upsertPostCall",
  "upsertCallSummary",
  "upsertPostCallWithSummary",
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
  const firestoreDelegate = createFirestoreStore(fb);
  /** @type {Map<string, DetailCacheEntry>} */
  const callDetailCache = new Map();
  /** @type {Map<string, DetailCacheEntry>} */
  const dealDetailCache = new Map();
  /** @type {{ at: number, deals: object[] } | null} */
  let dealsListCache = null;

  async function apiFetch(path, init = {}) {
    if (apiStoreUnavailable) {
      throw new Error("Not found.");
    }
    const headers = { Accept: "application/json" };
    if (init.body) headers["Content-Type"] = "application/json";
    const token = getToken ? await getToken() : undefined;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${path}`, { ...init, headers, credentials: "include" });
    if (!res.ok) {
      if (res.status === 404) {
        apiStoreUnavailable = true;
        throw new Error("Not found.");
      }
      const body = await res.json().catch(() => ({}));
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
      const postCall = await firestoreDelegate.getPostCall(key);
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

  async function loadDealsList(limit = 300) {
    warnDeprecatedReadPath("listDeals");
    if (dealsListCache && Date.now() - dealsListCache.at < DEALS_LIST_TTL_MS) {
      return dealsListCache.deals;
    }
    const data = await apiFetch(`/api/deals?scope=own&limit=${encodeURIComponent(String(limit))}`);
    const deals = data.deals || [];
    dealsListCache = { at: Date.now(), deals };
    return deals;
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
    if (firestoreDelegate.listProductGapsByDeal) {
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
    if (firestoreDelegate.listWhatWorksByDeal) {
      return firestoreDelegate.listWhatWorksByDeal(dealId, limitCount);
    }
    return [];
  }

  const apiReads = {
    mode: "api",

    get readCacheEnabled() {
      return firestoreDelegate.readCacheEnabled;
    },
    set readCacheEnabled(v) {
      firestoreDelegate.readCacheEnabled = v;
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
      if (firestoreDelegate.listPostCallsByOwner) {
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
        if (firestoreDelegate.listPostCallsByOwner) {
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
      if (firestoreDelegate.listCallSummariesByOwner) {
        return firestoreDelegate.listCallSummariesByOwner(ownerId, limit);
      }
      const data = await apiFetch(`/api/calls?scope=own&limit=${encodeURIComponent(String(limit))}`);
      return data.calls || [];
    },

    async listCallSummariesByTeam(teamId, limit = 200) {
      if (firestoreDelegate.listCallSummariesByTeam) {
        return firestoreDelegate.listCallSummariesByTeam(teamId, limit);
      }
      const data = await apiFetch(`/api/calls?scope=team&limit=${encodeURIComponent(String(limit))}`);
      return data.calls || [];
    },

    async listCallSummariesByOrg(orgId, limit = 200) {
      if (firestoreDelegate.listCallSummariesByOrg) {
        return firestoreDelegate.listCallSummariesByOrg(orgId, limit);
      }
      const data = await apiFetch(`/api/calls?scope=org&limit=${encodeURIComponent(String(limit))}`);
      return data.calls || [];
    },

    async listCallSummariesByDeal(dealId, limit = 50) {
      return firestoreDelegate.listCallSummariesByDeal
        ? firestoreDelegate.listCallSummariesByDeal(dealId, limit)
        : [];
    },

    async listCallSummariesByAccount(accountId, limit = 80) {
      return firestoreDelegate.listCallSummariesByAccount
        ? firestoreDelegate.listCallSummariesByAccount(accountId, limit)
        : [];
    },

    async getAccount(id) {
      if (isHistoryStubId(id)) return null;
      try {
        const data = await apiFetch(`/api/accounts/${encodeURIComponent(String(id))}`);
        return data?.account || null;
      } catch (err) {
        const msg = String(err?.message || err);
        if (!/404|not found/i.test(msg)) {
          const fallback = await firestoreDelegate.getAccount(id);
          if (fallback) return fallback;
        }
        if (/404|not found/i.test(msg)) return null;
        throw err;
      }
    },

    async listAccounts() {
      try {
        const data = await apiFetch("/api/accounts");
        return data.accounts || [];
      } catch (err) {
        return firestoreDelegate.listAccounts ? firestoreDelegate.listAccounts() : [];
      }
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
      // Intake attach: account-scoped deals via client Firestore (global on account, not owner-only).
      if (firestoreDelegate.listDealsByAccount) {
        return firestoreDelegate.listDealsByAccount(accountId, ownerId, opts);
      }
      const all = await loadDealsList(300);
      const teamId = opts.teamId || null;
      const ownerFilter =
        typeof ownerId === "string" && ownerId ? ownerId : null;
      let rows = all.filter((d) => d.accountId === accountId);
      if (ownerFilter) rows = rows.filter((d) => d.ownerId === ownerFilter);
      if (teamId) rows = rows.filter((d) => d.teamId === teamId);
      rows.sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
      return rows;
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
        }
        return result;
      };
    }
  }

  return new Proxy(firestoreDelegate, {
    get(target, prop, receiver) {
      if (prop in apiReads) return apiReads[prop];
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      const method = String(prop);
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
