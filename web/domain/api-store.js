/**
 * Hybrid domain store — read mapped aggregates via worker API; delegate everything else to Firestore client SDK.
 */

import { createFirestoreStore } from "./firestore-store.js";

const DETAIL_TTL_MS = 30_000;
const DETAIL_MAX_ENTRIES = 64;

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

  async function apiFetch(path) {
    const headers = { Accept: "application/json" };
    const token = getToken ? await getToken() : undefined;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${base}${path}`, { headers, credentials: "include" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `API ${res.status}: ${path}`);
    }
    return res.json();
  }

  async function loadCallDetail(id) {
    const key = String(id || "");
    const cached = peekDetail(callDetailCache, key);
    if (cached) return cached;
    const detail = await apiFetch(`/api/calls/${encodeURIComponent(key)}`);
    putDetail(callDetailCache, key, detail);
    return detail;
  }

  async function loadDealDetail(id) {
    const key = String(id || "");
    const cached = peekDetail(dealDetailCache, key);
    if (cached) return cached;
    const detail = await apiFetch(`/api/deals/${encodeURIComponent(key)}`);
    putDetail(dealDetailCache, key, detail);
    return detail;
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
      const detail = await loadCallDetail(id);
      return detail?.postCall || null;
    },

    async getCall(id) {
      return this.getPostCall(id);
    },

    async listPostCallsByOwner(_ownerId, limit = 200) {
      const data = await apiFetch(`/api/calls?scope=own&limit=${encodeURIComponent(String(limit))}`);
      return data.calls || [];
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
      const data = await apiFetch(`/api/accounts/${encodeURIComponent(String(id))}`);
      return data?.account || null;
    },

    async listAccounts() {
      const data = await apiFetch("/api/accounts");
      return data.accounts || [];
    },

    async getDeal(id) {
      const detail = await loadDealDetail(id);
      return detail?.deal || null;
    },

    async listDealsByOwner(_ownerId, limit = 300) {
      const data = await apiFetch(`/api/deals?scope=own&limit=${encodeURIComponent(String(limit))}`);
      return data.deals || [];
    },

    async listScorecardsByCall(callId) {
      const detail = await loadCallDetail(callId);
      return detail?.scorecards || [];
    },

    async listVideoFactsByCall(callId) {
      const detail = await loadCallDetail(callId);
      return detail?.videoFacts || [];
    },

    async listTimelineSegmentsByCall(callId) {
      const detail = await loadCallDetail(callId);
      return detail?.timelineSegments || [];
    },

    async listTimelineMarkersByCall(callId) {
      const detail = await loadCallDetail(callId);
      return detail?.timelineMarkers || [];
    },

    async listFollowUpsByCall(callId) {
      const detail = await loadCallDetail(callId);
      return detail?.followUps || [];
    },

    async listObjectionsByCall(callId) {
      const detail = await loadCallDetail(callId);
      return detail?.objections || [];
    },

    async listMomDraftsByCall(callId) {
      const detail = await loadCallDetail(callId);
      return detail?.momDrafts || [];
    },

    async listMeddpiccDeltasByCall(callId) {
      const detail = await loadCallDetail(callId);
      return detail?.meddpiccDeltas || [];
    },

    async listTcDeltasByCall(callId) {
      const detail = await loadCallDetail(callId);
      return detail?.tcDeltas || [];
    },

    async listArrLinesByCall(callId) {
      const detail = await loadCallDetail(callId);
      return detail?.arrLines || [];
    },

    async listDealSignalsByCall(callId) {
      const detail = await loadCallDetail(callId);
      return detail?.dealSignals || [];
    },
  };

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
