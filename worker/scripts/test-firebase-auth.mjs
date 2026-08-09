#!/usr/bin/env node
/**
 * Smoke tests for Firebase auth wiring (no live Firebase required).
 * Run: node worker/scripts/test-firebase-auth.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// --- Module behavior (dummy mode, no local config) ---
const { firebaseConfig, loadFirebaseConfig, isFirebaseAuthEnabled } = await import(
  webUrl("web/firebase-config.js")
);

assert.equal(firebaseConfig.projectId, "");
assert.equal(isFirebaseAuthEnabled(), false);

await loadFirebaseConfig();
assert.equal(isFirebaseAuthEnabled(), false, "dummy mode when local config absent");

const { authMode, sessionFromFirebaseUser, persistFirebaseSession } = await import(
  webUrl("web/auth.js")
);
assert.equal(authMode(), "dummy");

const session = sessionFromFirebaseUser({
  uid: "abc123",
  email: "alice@freshworks.com",
  displayName: "Alice",
});
assert.equal(session.role, "se");
assert.equal(session.authUid, "abc123");
assert.equal(session.userId, undefined, "userId set after persistFirebaseSession, not sessionFromFirebaseUser");

console.log("Firebase auth smoke tests passed (dummy mode).");
