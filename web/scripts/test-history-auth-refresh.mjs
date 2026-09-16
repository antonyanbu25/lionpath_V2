#!/usr/bin/env node
/**
 * UAT-001c regression gate: "401 on /api/history" — mechanism was already
 * confirmed (history.js DOES retry a 401 with a forced token refresh); the
 * trigger that defeated it was not.
 *
 * ROOT CAUSE, found by tracing the wiring rather than guessing: history.js's
 * retry calls `getAuthToken?.(true)`, intending Firebase to fetch a genuinely
 * NEW token. Every place app.js supplied that getter used a ZERO-PARAMETER
 * arrow function:
 *
 *     setHistoryAuthGetter(() => fb.auth.currentUser.getIdToken());
 *
 * JavaScript does not error when a caller passes an argument a function
 * doesn't declare — it is simply discarded. So `getAuthToken(true)` ran
 * `getIdToken()` with Firebase's own default (`forceRefresh = false`), and
 * got back the SAME cached token the client SDK still considered valid. The
 * retry looked like it was retrying with a fresh token; it was retrying with
 * the identical one. Any 401 the SERVER raised for a reason the CLIENT SDK's
 * own staleness check didn't independently catch (clock skew, a revoked
 * session, the exact boundary where the client's cache and the server's
 * clock disagree) could never recover — which is exactly "mechanism
 * confirmed [a retry exists], trigger unconfirmed [why does the user still
 * see a 401]".
 *
 * This one bug was in ONE function (`applySessionAuthGetters` in app.js) but
 * fed the SAME broken getter into 7 consumers (history, local-sync, tasks,
 * summaries, call-payload, timeline, product-signal) plus postcall.js's
 * `onSessionReady` — all silently lost their forceRefresh retry the same way.
 * Only history.js's slice of that is exercised here, since that's this
 * ticket's citation; the fix in app.js is the same one line for all 8.
 *
 * app.js has zero exports and 3341 lines of DOM/module-load side effects —
 * no precedent in this repo for importing it directly in a test (unlike
 * history.js, tasks.js, etc., which already are). So this file does two
 * different, complementary things:
 *
 *   1. A BEHAVIORAL test against history.js's REAL exported functions
 *      (setHistoryAuthGetter, fetchHistoryFromWorker), wiring a fake
 *      Firebase user the same shape app.js's FIXED code uses. This proves
 *      the retry mechanism actually produces a materially different,
 *      force-refreshed token on the second attempt when wired correctly —
 *      and, via contrast, that the ORIGINAL buggy wiring shape would not.
 *   2. A STATIC regression guard directly on app.js's source text (the same
 *      technique test-dew-theme.mjs already uses for markup this repo has no
 *      other way to pin), asserting the specific zero-parameter pattern does
 *      not reappear at either of the two real call sites.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  setHistoryAuthGetter,
  clearHistoryAuthGetter,
  fetchHistoryFromWorker,
} from "../history.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(label, fn) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          ${err instanceof Error ? err.message : String(err)}`);
  }
}
async function checkAsync(label, fn) {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Fake Firebase user: returns a DIFFERENT token depending on forceRefresh. */
function makeFakeCurrentUser() {
  return {
    async getIdToken(forceRefresh) {
      return forceRefresh ? "fresh-token" : "stale-token";
    },
  };
}

/** Records every Authorization header sent, and answers 401 once then 200. */
function installFetchMock() {
  const seenAuthHeaders = [];
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    calls += 1;
    seenAuthHeaders.push(init.headers?.Authorization ?? null);
    if (calls === 1) {
      return { ok: false, status: 401, async json() { return { error: "Token expired." }; } };
    }
    return { ok: true, async json() { return { entries: [] }; } };
  };
  return { seenAuthHeaders, restore: () => { globalThis.fetch = originalFetch; } };
}

console.log("\n1. Correct wiring (the fix): retry uses a GENUINELY refreshed token");
await checkAsync("retry sends a different Authorization header than the first attempt", async () => {
  const user = makeFakeCurrentUser();
  // Exactly app.js's FIXED shape: forwards forceRefresh instead of dropping it.
  setHistoryAuthGetter((forceRefresh) => user.getIdToken(forceRefresh));
  const mock = installFetchMock();
  try {
    await fetchHistoryFromWorker("se@example.com");
    assert.equal(mock.seenAuthHeaders.length, 2, "expected exactly one retry after the 401");
    assert.equal(mock.seenAuthHeaders[0], "Bearer stale-token", "first attempt should use the cached token");
    assert.equal(mock.seenAuthHeaders[1], "Bearer fresh-token", "retry must use a FORCE-REFRESHED token, not the same one");
  } finally {
    mock.restore();
    clearHistoryAuthGetter();
  }
});

console.log("\n2. Contrast: the ORIGINAL buggy wiring shape sends the SAME token both times");
await checkAsync("a zero-parameter getter (the pre-fix shape) cannot produce a different retry token", async () => {
  const user = makeFakeCurrentUser();
  // Reproduces the exact bug: app.js used to call this with NO parameter, so
  // `getAuthToken(true)` silently discarded the `true` and always ran
  // getIdToken() with Firebase's own default (forceRefresh=false).
  // eslint-disable-next-line no-unused-vars
  setHistoryAuthGetter(() => user.getIdToken());
  const mock = installFetchMock();
  try {
    await fetchHistoryFromWorker("se@example.com");
    assert.equal(mock.seenAuthHeaders.length, 2, "the retry still fires — the BUG is what token it uses, not whether it retries");
    assert.equal(
      mock.seenAuthHeaders[0],
      mock.seenAuthHeaders[1],
      "the pre-fix wiring shape sends the IDENTICAL token on retry — this is the defect UAT-001c reported: " +
        "a retry that exists but can never actually recover from a genuinely stale token",
    );
  } finally {
    mock.restore();
    clearHistoryAuthGetter();
  }
});

console.log("\n3. Static regression guard on app.js's actual source");
{
  const appJs = readFileSync(join(ROOT, "app.js"), "utf8");
  // Strip comments first: the fix's own explanatory comment quotes the buggy
  // pattern verbatim as a "was" example, and a guard that trips on its own
  // explanation gets deleted by the next person rather than trusted.
  const code = appJs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const buggyPattern = /setHistoryAuthGetter\(\s*\(\s*\)\s*=>\s*fb\.auth\.currentUser\.getIdToken\(\s*\)\s*\)/;
  const fixedCallSites = code.match(/setHistoryAuthGetter\(/g) ?? [];
  check("app.js contains both expected setHistoryAuthGetter call sites", () =>
    assert.equal(fixedCallSites.length, 2, `expected 2 call sites, found ${fixedCallSites.length} — update this guard if that count changed on purpose`));
  check("neither call site uses the zero-parameter (bug) shape", () =>
    assert.ok(!buggyPattern.test(code), "app.js has regressed to dropping forceRefresh on a direct setHistoryAuthGetter call"));
  check("the shared tokenFn used by applySessionAuthGetters forwards forceRefresh", () =>
    assert.match(
      code,
      /const tokenFn = isFirebaseAuthEnabled\(\) && fb\?\.auth\?\.currentUser\s*\?\s*\(forceRefresh\) => fb\.auth\.currentUser\.getIdToken\(forceRefresh\)/,
      "applySessionAuthGetters' tokenFn must accept and forward forceRefresh — this one function feeds 7 other consumers besides history.js",
    ));
}

console.log("");
if (failures > 0) {
  console.error(`FAIL — ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("OK — history auth-refresh wiring gate passed.");
