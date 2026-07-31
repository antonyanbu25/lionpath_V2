/**
 * Shared in-memory cache for listAccountsForSession — avoids refetch on every nav.
 */

const TTL_MS = 60_000;

/** @type {Map<string, { at: number, rows: unknown[] }>} */
const accountListCache = new Map();

function cacheKey(session) {
  const uid = session?.uid || session?.email || "anon";
  const scope = session?.dataScope || session?.scope || "own";
  return `${uid}:${scope}`;
}

/** @param {object} session @returns {unknown[]|null} */
export function getCachedAccountListRows(session) {
  const hit = accountListCache.get(cacheKey(session));
  if (!hit || Date.now() - hit.at > TTL_MS) return null;
  return hit.rows;
}

/** @param {object} session @param {unknown[]} rows */
export function setCachedAccountListRows(session, rows) {
  accountListCache.set(cacheKey(session), { at: Date.now(), rows });
}

/** Call after brief/call writes or account assignment changes. */
export function invalidateSessionListCache(session) {
  if (session) {
    accountListCache.delete(cacheKey(session));
    return;
  }
  accountListCache.clear();
}
