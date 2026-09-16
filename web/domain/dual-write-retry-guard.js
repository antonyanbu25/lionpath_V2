/**
 * Cap repeated dual-write / background persist failures so permission errors
 * do not spam the console every poll cycle.
 */

const MAX_FAILURES = 3;
/** @type {Map<string, number>} */
const failureCounts = new Map();
/** @type {Set<string>} */
const loggedOnce = new Set();

/**
 * @param {string} key Stable id for the failing operation (e.g. scorecard:call_abc)
 */
export function shouldSkipDualWriteOp(key) {
  return (failureCounts.get(key) || 0) >= MAX_FAILURES;
}

/**
 * @param {string} key
 * @param {string} label Short label for console (e.g. "[dual-write] scorecard persist failed")
 * @param {unknown} err
 */
export function logDualWriteFailure(key, label, err) {
  const msg = err instanceof Error ? err.message : String(err || err);
  const count = (failureCounts.get(key) || 0) + 1;
  failureCounts.set(key, count);
  if (count >= MAX_FAILURES) {
    if (!loggedOnce.has(key)) {
      loggedOnce.add(key);
      console.warn(`${label}: ${msg} (giving up after ${MAX_FAILURES} attempts)`);
    }
    return;
  }
  console.warn(`${label}:`, msg);
}
