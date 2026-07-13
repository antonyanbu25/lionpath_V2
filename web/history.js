/**
 * Post-call analysis history — localStorage per user email for now.
 * Replace the storage backend with Firestore when Firebase is enabled.
 */

const STORAGE_PREFIX = "se-sp-postcalls:";

function storageKey(email) {
  return `${STORAGE_PREFIX}${String(email || "").toLowerCase()}`;
}

function readAll(email) {
  try {
    const raw = localStorage.getItem(storageKey(email));
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeAll(email, list) {
  localStorage.setItem(storageKey(email), JSON.stringify(list));
}

/**
 * @param {string} email
 * @param {{ recordingUrl?: string, recordingPassword?: string }} input
 * @param {object} result — full API response { analysis, transcriptMeta }
 * @returns {object} saved record
 */
export function savePostCallAnalysis(email, input, result) {
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
  const list = readAll(email);
  list.unshift(record);
  writeAll(email, list.slice(0, 100));
  return record;
}

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
