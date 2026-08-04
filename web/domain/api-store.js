/**
 * Hybrid domain store — read mapped aggregates via worker API; delegate everything else to Firestore client SDK.
 */

import { createFirestoreStore } from "./firestore-store.js";

/** @param {{ workerBaseUrl: string, getToken?: () => Promise<string|undefined>, fb: object }} opts */
export function createApiStore({ workerBaseUrl, getToken, fb }) {
  const base = String(workerBaseUrl || "").replace(/\/$/, "");
  const firestoreDelegate = createFirestoreStore(fb);
  /** @type {Map<string, object>} */
  const callDetailCache = new Map();
  /** @type {Map<string, object>} */
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
    if (callDetailCache.has(key)) return callDetailCache.get(key);
    const detail = await apiFetch(`/api/calls/${encodeURIComponent(key)}`);
    callDetailCache.set(key, detail);
    return detail;
  }

  async function loadDealDetail(id) {
    const key = String(id || "");
    if (dealDetailCache.has(key)) return dealDetailCache.get(key);
    const detail = await apiFetch(`/api/deals/${encodeURIComponent(key)}`);
    dealDetailCache.set(key, detail);
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
      return typeof value === "function" ? value.bind(target) : value;
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
