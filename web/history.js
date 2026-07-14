/**
 * Post-call analysis history — persisted in localStorage per SE email.
 * Auth session (sessionStorage) is separate and cleared on logout.
 */

export const STORAGE_PREFIX = "se-singha-history:";
const LEGACY_PREFIX = "se-sp-postcalls:";

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
  const trimmed = list.slice(0, 100);
  const ok = writeAll(normalized, trimmed);
  if (ok) {
    console.info(`[history] saved "${record.title}" → ${storageKey(normalized)} (${trimmed.length} total)`);
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
