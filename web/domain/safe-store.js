/**
 * Firestore-safe reads — never let permission errors break list views.
 */

/** @param {unknown} err */
export function isFirebasePermissionError(err) {
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
  const msg = err?.message ? String(err.message) : String(err || "");
  return code === "permission-denied" || /permission|insufficient permissions/i.test(msg);
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
