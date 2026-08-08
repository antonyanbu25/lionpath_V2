/**
 * Post-call analysis history — localStorage cache + Worker KV sync per SE email.
 * localStorage is fast/offline; Worker KV survives incognito (reload on sign-in).
 */

import { WORKER_BASE_URL } from "./firebase-config.js";
import { newId } from "./domain/types.js";
import { normalizeUserEmail } from "./shared.js";
import { resolveCallTitleFromRecord } from "./call-type-labels.js";

export { normalizeUserEmail };

export const STORAGE_PREFIX = "se-singha-history:";
const LEGACY_PREFIX = "se-sp-postcalls:";
const EMERGENCY_PREFIX = "lionpath:emergency-call:";
const MAX_ENTRIES = 100;

function emergencyKey(email, id) {
  return `${EMERGENCY_PREFIX}${normalizeUserEmail(email)}:${id}`;
}

function stashEmergencyRecord(email, record) {
  if (!email || !record?.id) return;
  try {
    sessionStorage.setItem(emergencyKey(email, record.id), JSON.stringify(record));
  } catch (err) {
    console.warn("[history] emergency stash failed:", err?.message || err);
  }
}

function readEmergencyRecord(email, id) {
  if (!email || !id) return null;
  try {
    const raw = sessionStorage.getItem(emergencyKey(email, id));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @type {(() => Promise<string | null>) | null} */
let getAuthToken = null;

/** @param {() => Promise<string | null>} fn */
export function setHistoryAuthGetter(fn) {
  getAuthToken = fn;
}

export function clearHistoryAuthGetter() {
  getAuthToken = null;
}

/** @param {string} email */
export function storageKey(email) {
  return `${STORAGE_PREFIX}${normalizeUserEmail(email)}`;
}

function legacyStorageKey(email) {
  return `${LEGACY_PREFIX}${normalizeUserEmail(email)}`;
}

function migrateLegacyKey(email) {
  const key = storageKey(email);
  const legacyKey = legacyStorageKey(email);
  try {
    if (localStorage.getItem(key)) return;
    const legacy = localStorage.getItem(legacyKey);
    if (!legacy) return;
    localStorage.setItem(key, legacy);
    localStorage.removeItem(legacyKey);
  } catch {
    // ignore quota / private-mode errors during migration
  }
}

function readAll(email) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) return [];

  migrateLegacyKey(normalized);

  try {
    const raw = localStorage.getItem(storageKey(normalized));
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAll(email, list) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) return false;
  const key = storageKey(normalized);
  try {
    const payload = JSON.stringify(list);
    localStorage.setItem(key, payload);
    if (localStorage.getItem(key) !== payload) {
      console.warn("[history] write verification failed for", key);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("Could not persist post-call history:", err);
    return false;
  }
}

/** @param {object[]} lists */
export function mergeHistoryLists(...lists) {
  const byId = new Map();
  for (const list of lists) {
    for (const entry of list || []) {
      if (entry?.id) byId.set(entry.id, entry);
    }
  }
  return [...byId.values()]
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, MAX_ENTRIES);
}

async function historyHeaders() {
  const headers = { "content-type": "application/json" };
  if (getAuthToken) {
    try {
      const token = await getAuthToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } catch {
      // demo mode — email in body/query is enough
    }
  }
  return headers;
}

/** @param {string} email */
export async function fetchHistoryFromWorker(email) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) return [];
  const url = `${WORKER_BASE_URL}/api/history?email=${encodeURIComponent(normalized)}`;
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: await historyHeaders(),
      signal: AbortSignal.timeout(12000),
    });
  } catch (err) {
    console.error("[history] GET /api/history network error:", err.message || err);
    throw err;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error || `History fetch failed (${res.status})`;
    if (res.status === 404) {
      console.error("[history] GET /api/history returned 404. redeploy worker with history endpoints");
    } else {
      console.error(`[history] GET /api/history failed (${res.status}):`, msg);
    }
    throw new Error(msg);
  }
  const data = await res.json();
  return Array.isArray(data.entries) ? data.entries : [];
}

/** @param {string} email @param {object} entry @param {{ proxySeActing?: boolean }} [opts] */
async function pushRemoteEntry(email, entry, opts = {}) {
  const normalized = normalizeUserEmail(email);
  if (!normalized || !entry?.id) return false;
  const res = await fetch(`${WORKER_BASE_URL}/api/history`, {
    method: "POST",
    headers: await historyHeaders(),
    body: JSON.stringify({
      email: normalized,
      targetEmail: normalized,
      proxySeActing: opts.proxySeActing === true,
      entry,
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error || `History save failed (${res.status})`;
    console.error(`[history] POST /api/history entry failed (${res.status}):`, msg);
    throw new Error(msg);
  }
  return true;
}

/** @param {string} email @param {object[]} entries */
async function pushRemoteEntries(email, entries) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) return false;
  const res = await fetch(`${WORKER_BASE_URL}/api/history`, {
    method: "POST",
    headers: await historyHeaders(),
    body: JSON.stringify({ email: normalized, entries }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error || `History sync failed (${res.status})`;
    console.error(`[history] POST /api/history bulk failed (${res.status}):`, msg);
    throw new Error(msg);
  }
  return true;
}

/**
 * On sign-in: fetch server history, merge with local, persist both sides.
 * @param {string} email
 * @param {{ force?: boolean }} [opts]
 * @returns {Promise<object[]>}
 */
const HISTORY_SYNC_TTL_MS = 30_000;
/** @type {Map<string, { at: number, promise: Promise<object[]> }>} */
const historySyncInflight = new Map();

export async function syncHistoryOnLogin(email, opts = {}) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) return [];

  if (!opts.force) {
    const inflight = historySyncInflight.get(normalized);
    if (inflight && Date.now() - inflight.at < HISTORY_SYNC_TTL_MS) {
      return inflight.promise;
    }
  }

  const promise = (async () => {
    const local = readAll(normalized);
    let remote = [];
    try {
      remote = await fetchHistoryFromWorker(normalized);
    } catch (err) {
      console.warn("[history] could not load remote history:", err.message || err);
      return local;
    }

    const merged = mergeHistoryLists(remote, local);
    writeAll(normalized, merged);

    const remoteIds = new Set(remote.map((r) => r.id));
    const hasLocalOnly = merged.some((r) => !remoteIds.has(r.id));
    if (hasLocalOnly || merged.length !== remote.length) {
      try {
        await pushRemoteEntries(normalized, merged);
        console.info(`[history] synced ${merged.length} record(s) to server for ${normalized}`);
      } catch (err) {
        console.warn("[history] remote merge sync failed:", err.message || err);
      }
    } else {
      console.info(`[history] loaded ${merged.length} record(s) from server for ${normalized}`);
    }

    return merged;
  })();

  historySyncInflight.set(normalized, { at: Date.now(), promise });
  try {
    return await promise;
  } finally {
    const cur = historySyncInflight.get(normalized);
    if (cur?.promise === promise) historySyncInflight.delete(normalized);
  }
}

/**
 * @param {string} email
 * @param {{ recordingUrl?: string, recordingPassword?: string }} input
 * @param {object} result — full API response { analysis, transcriptMeta }
 * @param {{ proxySeActing?: boolean, createdByUserId?: string }} [opts]
 * @returns {object} saved record
 */
export async function savePostCallAnalysis(email, input, result, opts = {}) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) {
    console.warn("[history] save skipped. missing email");
    return null;
  }

  const analysis = result?.analysis;
  const callType = input?.callType || result?.analysisMeta?.callType || result?.confirmed?.callType || null;
  const accountName =
    input?.companyName ||
    analysis?.callHeader?.company ||
    analysis?.callHeader?.account ||
    null;
  const confirmed = {
    ...(result?.confirmed || {}),
    dealId: input?.dealId || result?.confirmed?.dealId || null,
    callType,
    accountId: input?.accountId || result?.confirmed?.accountId || null,
    createNewDeal: !!input?.createNewDeal,
    newDealTitle: input?.newDealTitle || null,
    newDealType: input?.newDealType || null,
  };
  const record = {
    id: newId("postCall"),
    timestamp: Date.now(),
    zoomLink: input?.recordingUrl || "",
    title: resolveCallTitleFromRecord(
      {
        analysis,
        callType,
        pass6: result?.pass6,
        arrCompute: result?.arrCompute,
      },
      { accountName },
    ),
    dealId: confirmed.dealId,
    callType,
    accountId: confirmed.accountId || null,
    createNewDeal: confirmed.createNewDeal || undefined,
    newDealTitle: confirmed.newDealTitle || undefined,
    newDealType: confirmed.newDealType || undefined,
    confirmedIdentities: input?.confirmedIdentities || null,
    analysis,
    transcriptMeta: result?.transcriptMeta || null,
    /** Pass 3 draft kept on the history record for coaching eligibility (also persisted to scorecards). */
    scorecard: result?.scorecard || null,
    analysisMeta: result?.analysisMeta || null,
    /** Keep Pass 6 on the history blob so Product signal can render even if dual-write lags. */
    pass6: result?.pass6 || null,
    result: { ...result, confirmed },
    createdByUserId: opts.createdByUserId || null,
  };
  const list = readAll(normalized);
  list.unshift(record);
  const trimmed = list.slice(0, MAX_ENTRIES);
  const ok = writeAll(normalized, trimmed);
  if (!ok) {
    console.warn(`[history] save failed for ${storageKey(normalized)}. using emergency stash`);
    stashEmergencyRecord(normalized, record);
    return record;
  }

  console.info(`[history] saved "${record.title}" → ${storageKey(normalized)} (${trimmed.length} total)`);
  try {
    await pushRemoteEntry(normalized, record, { proxySeActing: opts.proxySeActing === true });
    console.info(`[history] synced "${record.title}" to server for ${normalized}`);
  } catch (err) {
    console.warn("[history] remote save failed (local copy kept):", err.message || err);
  }
  return record;
}

/** Alias used by postcall flow and tests. */
export const savePostCallHistory = savePostCallAnalysis;

/** @returns {object[]} newest first */
export function listPostCallAnalyses(email) {
  return readAll(email).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export function getPostCallAnalysis(email, id) {
  const normalized = normalizeUserEmail(email);
  const found = listPostCallAnalyses(normalized).find((r) => r.id === id) || null;
  if (found) return found;
  return readEmergencyRecord(normalized, id);
}

/**
 * Merge Firestore postCall docs into the local history cache so the dashboard
 * renders the value instantly on return (no shimmer-until-network). Firestore
 * docs carry `createdAt`/`updatedAt`; local records use `timestamp`. We keep the
 * local field so sort + recent-activity keep working, and only add docs we don't
 * already have (or refresh ones whose updatedAt is newer).
 * @param {string} email
 * @param {Array<object>} remoteCalls  Firestore postCall docs ({ id, title, analysis, ownerId, ... })
 * @returns {number} local count after merge
 */
export function mergePostCallRecordsIntoLocal(email, remoteCalls) {
  const normalized = normalizeUserEmail(email);
  if (!normalized || !Array.isArray(remoteCalls)) {
    return listPostCallAnalyses(normalized).length;
  }
  const existing = readAll(normalized);
  const byId = new Map(existing.map((r) => [r.id, r]));
  for (const call of remoteCalls) {
    if (!call?.id) continue;
    const prev = byId.get(call.id);
    const ts = toEpochMs(call.timestamp) || toEpochMs(call.createdAt) || prev?.timestamp || 0;
    const prevUpdated = prev?.updatedAt ? toEpochMs(prev.updatedAt) : 0;
    const newUpdated = call.updatedAt ? toEpochMs(call.updatedAt) : 0;
    if (prev && newUpdated <= prevUpdated && (prev.timestamp || 0) >= ts) continue;
    const result = call.result == null
      ? prev?.result
      : {
          ...call.result,
          technicalCommit: call.result.technicalCommit ?? prev?.result?.technicalCommit,
          tcDeltas: call.result.tcDeltas ?? prev?.result?.tcDeltas,
          qualification: call.result.qualification ?? prev?.result?.qualification,
          arrCompute: call.result.arrCompute ?? prev?.result?.arrCompute,
          pass6: call.result.pass6 ?? prev?.result?.pass6,
          videoFacts: call.result.videoFacts ?? prev?.result?.videoFacts,
          timeline: call.result.timeline ?? prev?.result?.timeline,
          summarise: call.result.summarise ?? prev?.result?.summarise,
          meddpiccDeltas: call.result.meddpiccDeltas ?? prev?.result?.meddpiccDeltas,
          scorecard: call.result.scorecard ?? prev?.result?.scorecard,
        };
    byId.set(call.id, {
      ...(prev || {}),
      ...call,
      id: call.id,
      timestamp: ts,
      updatedAt: call.updatedAt || prev?.updatedAt || null,
      ...(result != null ? { result } : {}),
      transcriptMeta: call.transcriptMeta ?? prev?.transcriptMeta,
      zoomLink: call.zoomLink ?? prev?.zoomLink,
      dealId: call.dealId ?? prev?.dealId,
      accountId: call.accountId ?? prev?.accountId,
      createNewDeal: call.createNewDeal ?? prev?.createNewDeal,
      newDealTitle: call.newDealTitle ?? prev?.newDealTitle,
      newDealType: call.newDealType ?? prev?.newDealType,
      confirmedIdentities: call.confirmedIdentities ?? prev?.confirmedIdentities,
      createdByUserId: call.createdByUserId ?? prev?.createdByUserId,
    });
  }
  const merged = [...byId.values()].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  writeAll(normalized, merged);
  return merged.length;
}

/** Firestore Timestamp ({ seconds, nanoseconds }), Date, number, or ISO string -> epoch ms. */
function toEpochMs(v) {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && typeof v.seconds === "number") {
    return Math.round(v.seconds * 1000 + (typeof v.nanoseconds === "number" ? v.nanoseconds / 1e6 : 0));
  }
  const n = Number(new Date(v));
  return Number.isFinite(n) ? n : 0;
}


/**
 * Patch one history record (local + best-effort remote sync).
 * @param {string} email
 * @param {string} id
 * @param {(rec: object) => object} updater
 */
export async function updatePostCallAnalysis(email, id, updater) {
  const normalized = normalizeUserEmail(email);
  if (!normalized || !id || typeof updater !== "function") return null;

  const list = readAll(normalized);
  const idx = list.findIndex((r) => r.id === id);
  if (idx < 0) return null;

  const updated = updater(JSON.parse(JSON.stringify(list[idx])));
  if (!updated?.id) return null;

  list[idx] = updated;
  const ok = writeAll(normalized, list);
  if (!ok) return null;

  try {
    await pushRemoteEntry(normalized, updated);
  } catch (err) {
    console.warn("[history] remote update failed (local copy kept):", err.message || err);
  }
  return updated;
}

/** For tests and dashboard. analyses with qualityCoach or QIP scorecard. */
export function listAnalysesWithQuality(email) {
  return listPostCallAnalyses(email).filter(
    (r) => r.analysis?.qualityCoach || r.scorecard?.lines?.length || r.result?.scorecard?.lines?.length,
  );
}
