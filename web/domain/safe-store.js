/**
 * Firestore-safe reads — never let permission errors break list views.
 */

/** @param {unknown} err */
export function isFirebasePermissionError(err) {
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
  const msg = err?.message ? String(err.message) : String(err || "");
  return code === "permission-denied" || /permission|insufficient permissions/i.test(msg);
}

/** @param {unknown} err */
export function isFirestoreIndexError(err) {
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
  const msg = err?.message ? String(err.message) : String(err || "");
  return (
    code === "failed-precondition" ||
    /requires an index|FAILED_PRECONDITION.*index/i.test(msg)
  );
}

/** @param {string} id */
export function isHistoryStubId(id) {
  const s = String(id || "");
  return s.startsWith("deal_hist_") || s.startsWith("hist_");
}

/** Firestore setDoc/updateDoc reject undefined field values. */
export function stripUndefinedFields(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedFields(item)).filter((item) => item !== undefined);
  }
  if (value instanceof Date) return value;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue;
    const cleaned = stripUndefinedFields(child);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

/**
 * @template T
 * @param {string} label
 * @param {() => Promise<T>|T} fn
 * @param {T} fallback
 * @returns {Promise<T>}
 */
export async function safeStoreOp(label, fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    if (isFirebasePermissionError(err)) {
      console.warn(`[store] ${label} skipped (permissions)`);
    } else {
      console.warn(`[store] ${label} failed:`, err?.message || err);
    }
    return fallback;
  }
}
