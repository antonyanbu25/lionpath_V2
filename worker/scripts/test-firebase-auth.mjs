#!/usr/bin/env node
/**
 * Smoke tests for Firebase auth wiring (no live Firebase required).
 * Run: node worker/scripts/test-firebase-auth.mjs
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const webUrl = (rel) => pathToFileURL(path.join(root, rel)).href;

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

// --- Static file checks ---
const firebaseConfigJs = read("web/firebase-config.js");
assert.match(firebaseConfigJs, /export async function loadFirebaseConfig/);
assert.match(firebaseConfigJs, /export function isFirebaseAuthEnabled/);
assert.match(firebaseConfigJs, /export function applyProductionLoginShell/);
assert.match(firebaseConfigJs, /bootstrapProductionFirebase/);
assert.match(firebaseConfigJs, /firebase-config\.local\.js/);

const authJs = read("web/auth.js");
assert.match(authJs, /export function isFirebaseAuthEnabled/);
assert.match(authJs, /persistFirebaseSession\(user, opts/);
assert.match(authJs, /sessionUserId/);
assert.match(authJs, /userId: profile\.id/);

const idJs = read("web/domain/id.js");
assert.match(idJs, /usr_/);
assert.match(idJs, /stableUserIdForEmail/);

assert.match(read("firestore.rules"), /authIndex/);
assert.match(read("firestore.rules"), /currentUserId/);

// lookupUserForSession moved from seed-dev.js to its own module in
// commit 38b1380 ("unified write scope resolver" / "dev-seed split") — this
// test wasn't updated at the time because it was orphaned (not wired into
// npm test), so the drift went unnoticed. Confirmed 2026-08-09 that the
// function and its ordering guarantee still exist, just relocated.
const userResolveJs = read("web/domain/user-resolve.js");
assert.match(userResolveJs, /lookupUserForSession/);
assert.match(userResolveJs, /safeStoreGet/);
assert.ok(
  userResolveJs.indexOf("getUserIdByAuthUid") < userResolveJs.indexOf("getUser by session id"),
  "authIndex lookup must run before session userId getUser",
);

const appJs = read("web/app.js");
assert.match(appJs, /completeFirebaseLogin/);
assert.match(appJs, /configureFirebaseLoginUi/);
assert.match(appJs, /await loadFirebaseConfig/);
assert.match(appJs, /isFirebaseAuthEnabled\(\)/);
assert.match(appJs, /from "\.\/auth\.js"/);
assert.doesNotMatch(appJs, /isFirebaseAuthEnabled.*from "\.\/firebase-config\.js"/);
assert.doesNotMatch(appJs, /const authEnabled = !!firebaseConfig\.projectId/);

// "auth-fix-v3" was a one-time hardcoded cache-bust literal on the
// firebase-config.js <script> tag — superseded by a dynamic mechanism
// (AUTH_BUILD_ID/MODULE_BUILD exported from firebase-config.js, applied to
// app.js's import at boot time) so the cache-bust value doesn't need a
// literal-string test update every release. Assert the mechanism exists
// structurally instead of a specific version string, which would just go
// stale again next release the same way "auth-fix-v3" did.
const firebaseConfigForBuildId = read("web/firebase-config.js");
assert.match(firebaseConfigForBuildId, /export const AUTH_BUILD_ID/);
assert.match(firebaseConfigForBuildId, /export const MODULE_BUILD = AUTH_BUILD_ID/);

const indexHtml = read("web/index.html");
assert.match(indexHtml, /const \{ MODULE_BUILD \} = await import\("\.\/firebase-config\.js"\)/);
assert.match(indexHtml, /await import\(`\.\/app\.js\?v=\$\{MODULE_BUILD\}`\)/);
assert.match(indexHtml, /id="login-hint"/);
assert.match(indexHtml, /id="login-subtitle"/);
assert.match(indexHtml, /id="firebase-signin-block"/);

assert.ok(read("firebase.json").includes("firestore.rules"));
assert.ok(read("docs/FIREBASE_SETUP.md").includes("Sign in with Google"));
assert.ok(read("worker/scripts/seed-firestore-users.mjs").includes("--bootstrap-team"));

// --- Module behaviour: auth mode follows the merged config, either way ---
//
// This block used to assert unconditionally that loadFirebaseConfig() leaves
// auth DISABLED — "dummy mode when local config absent". That premise is a
// fact about the MACHINE, not an invariant: web/firebase-config.local.js is
// gitignored, so the assertion holds on a checkout without it and fails on
// any developer machine that has one. It was failing here for exactly that
// reason, and was repeatedly mis-described as "needs Firebase credentials
// this machine lacks" — the opposite of the truth. Same root cause as the 13
// e2e failures fixed in P-D1.
//
// The real contract is that isFirebaseAuthEnabled() reports whether a
// projectId survived the merge. Asserted below in both states, which is
// strictly stronger than the original and no longer depends on local files.
const localConfigPresent = existsSync(path.join(root, "web/firebase-config.local.js"));

const { firebaseConfig, loadFirebaseConfig, isFirebaseAuthEnabled } = await import(
  webUrl("web/firebase-config.js")
);

// Before any merge: the COMMITTED defaults must not enable auth on their own.
assert.equal(firebaseConfig.projectId, "");
assert.equal(isFirebaseAuthEnabled(), false);

await loadFirebaseConfig();

// The invariant, true regardless of what is on disk.
assert.equal(
  isFirebaseAuthEnabled(),
  !!firebaseConfig.projectId,
  "isFirebaseAuthEnabled() must track the merged projectId",
);

if (localConfigPresent) {
  // A local override exists, so it must have been APPLIED — otherwise the
  // override path is silently dead and nobody would notice.
  assert.equal(
    isFirebaseAuthEnabled(),
    true,
    "web/firebase-config.local.js is present, so loadFirebaseConfig() must have merged its projectId",
  );
} else {
  assert.equal(isFirebaseAuthEnabled(), false, "dummy mode when local config absent");
}

const { authMode, sessionFromFirebaseUser, persistFirebaseSession } = await import(
  webUrl("web/auth.js")
);
// Same machine-dependence as the block above: authMode() reports "firebase"
// once a projectId is merged. Assert the RELATIONSHIP, not one machine's answer.
assert.equal(
  authMode(),
  localConfigPresent ? "firebase" : "dummy",
  `authMode() must follow the merged config (local override ${localConfigPresent ? "present" : "absent"})`,
);

const session = sessionFromFirebaseUser({
  uid: "abc123",
  email: "alice@freshworks.com",
  displayName: "Alice",
});
assert.equal(session.role, "se");
assert.equal(session.authUid, "abc123");
assert.equal(session.userId, undefined, "userId set after persistFirebaseSession, not sessionFromFirebaseUser");

console.log(`Firebase auth smoke tests passed (${localConfigPresent ? "firebase" : "dummy"} mode).`);
