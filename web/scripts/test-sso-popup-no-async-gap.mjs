#!/usr/bin/env node
/**
 * Regression: no real await between the click and signInWithPopup().
 *
 * signInWithPopup() opens a real window.open() under the hood — browsers
 * only trust that as a direct result of the click if there's no real async
 * wait first. runFirebaseSignIn() used to `await waitForFirebaseBootstrap()`
 * before calling it; on the first click, Firebase's authStateReady()
 * bootstrap was often still pending, so that await was a genuine delay and
 * the browser silently blocked the popup — it only worked on a second click,
 * once bootstrap had since resolved in the background.
 *
 * ssoInFlight (set synchronously, before any await, at the top of
 * runFirebaseSignIn) is what makes it safe to skip that wait: bootstrap's
 * own login/logout/showLogin handling already defers to an in-flight SSO
 * attempt via shouldDeferNullAuth / shouldLogoutAfterNullCheck
 * (auth-firebase-guards.js, covered by test-auth-firebase-guards.mjs).
 *
 * app.js can't be unit-imported directly (global side effects, assumes a
 * browser DOM on load), so this is a structural source check — same
 * technique as test-dashboard-subscribe-fb-db-gate.mjs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const appJs = readFileSync(webDir + "/app.js", "utf8");

assert.ok(
  !/(?:function\s+waitForFirebaseBootstrap\s*\(|await\s+waitForFirebaseBootstrap\s*\()/.test(appJs),
  "waitForFirebaseBootstrap must not be reintroduced — awaiting it before signInWithPopup breaks the " +
    "popup's user-gesture trust on the first click (see this file's header comment)",
);

const fnStart = appJs.indexOf("async function runFirebaseSignIn(");
assert.ok(fnStart >= 0, "runFirebaseSignIn() must exist in app.js");
const nextFnStart = appJs.indexOf("\nfunction ", fnStart + 1);
const fnBody = appJs.slice(fnStart, nextFnStart > fnStart ? nextFnStart : fnStart + 2000);

const ssoFlightIdx = fnBody.indexOf("ssoInFlight = true;");
const popupIdx = fnBody.indexOf("signInWithPopup(");
assert.ok(ssoFlightIdx >= 0, "runFirebaseSignIn must set ssoInFlight = true");
assert.ok(popupIdx > ssoFlightIdx, "signInWithPopup must be called after ssoInFlight is set");

const between = fnBody
  .slice(ssoFlightIdx, popupIdx)
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");
const awaits = between.match(/\bawait\s+([A-Za-z_$][\w.]*)\s*\(/g) || [];
const allowed = new Set(["ensureFirebaseSdk"]);
for (const a of awaits) {
  const name = a.replace(/^await\s+/, "").split(/[.(]/)[0];
  assert.ok(
    allowed.has(name),
    `unexpected await between the click and signInWithPopup: "${a}" — any real async wait here can get ` +
      "the popup silently blocked on the first click; ensureFirebaseSdk() is fine because it's already " +
      "resolved by the time this button is clickable (gated by setSignInButtonReady)",
  );
}

console.log("test-sso-popup-no-async-gap.mjs: ok");
