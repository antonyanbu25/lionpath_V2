/**
 * Post-call analysis history — localStorage cache + Worker KV sync per SE email.
 * localStorage is fast/offline; Worker KV survives incognito (reload on sign-in).
 */

import { WORKER_BASE_URL } from "./firebase-config.js";

export const STORAGE_PREFIX = "se-singha-history:";
const LEGACY_PREFIX = "se-sp-postcalls:";
const MAX_ENTRIES = 100;

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
export function normalizeUserEmail(email) {
  return String(email || "").trim().toLowerCase();
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
async function fetchRemoteHistory(email) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) return [];
  const url = `${WORKER_BASE_URL}/api/history?email=${encodeURIComponent(normalized)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: await historyHeaders(),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `History fetch failed (${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data.entries) ? data.entries : [];
}

/** @param {string} email @param {object} entry */
async function pushRemoteEntry(email, entry) {
  const normalized = normalizeUserEmail(email);
  if (!normalized || !entry?.id) return false;
  const res = await fetch(`${WORKER_BASE_URL}/api/history`, {
    method: "POST",
    headers: await historyHeaders(),
    body: JSON.stringify({ email: normalized, entry }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `History save failed (${res.status})`);
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
    throw new Error(err.error || `History sync failed (${res.status})`);
  }
  return true;
}

/** Fire-and-forget remote save after local write. */
function syncEntryToWorker(email, entry) {
  void pushRemoteEntry(email, entry).catch((err) => {
    console.warn("[history] remote save failed (local copy kept):", err.message || err);
  });
}

/**
 * On sign-in: fetch server history, merge with local, persist both sides.
 * @param {string} email
 * @returns {Promise<object[]>}
 */
export async function syncHistoryOnLogin(email) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) return [];

  const local = readAll(normalized);
  let remote = [];
  try {
    remote = await fetchRemoteHistory(normalized);
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
}

/**
 * @param {string} email
 * @param {{ recordingUrl?: string, recordingPassword?: string }} input
 * @param {object} result — full API response { analysis, transcriptMeta }
 * @returns {object} saved record
 */
export function savePostCallAnalysis(email, input, result) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) {
    console.warn("[history] save skipped — missing email");
    return null;
  }

  const analysis = result?.analysis;
  const record = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    zoomLink: input?.recordingUrl || "",
    title: analysis?.callSummary?.headline || "Call analysis",
    analysis,
    transcriptMeta: result?.transcriptMeta || null,
    result,
  };
  const list = readAll(normalized);
  list.unshift(record);
  const trimmed = list.slice(0, MAX_ENTRIES);
  const ok = writeAll(normalized, trimmed);
  if (ok) {
    console.info(`[history] saved "${record.title}" → ${storageKey(normalized)} (${trimmed.length} total)`);
    syncEntryToWorker(normalized, record);
  } else {
    console.warn(`[history] save failed for ${storageKey(normalized)}`);
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
  return listPostCallAnalyses(email).find((r) => r.id === id) || null;
}

/** For tests and dashboard — all analyses with qualityCoach data. */
export function listAnalysesWithQuality(email) {
  return listPostCallAnalyses(email).filter((r) => r.analysis?.qualityCoach);
}
