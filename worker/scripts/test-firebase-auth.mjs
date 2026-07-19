#!/usr/bin/env node
/**
 * Smoke tests for Firebase auth wiring (no live Firebase required).
 * Run: node worker/scripts/test-firebase-auth.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

// --- Static file checks ---
const firebaseConfigJs = read("web/firebase-config.js");
assert.match(firebaseConfigJs, /export async function loadFirebaseConfig/);
assert.match(firebaseConfigJs, /export function isFirebaseAuthEnabled/);
assert.match(firebaseConfigJs, /firebase-config\.local\.js/);

const authJs = read("web/auth.js");
assert.match(authJs, /persistFirebaseSession\(user, opts/);
assert.match(authJs, /sessionUserId/);
assert.match(authJs, /userId: profile\.id/);

const idJs = read("web/domain/id.js");
assert.match(idJs, /usr_/);
assert.match(idJs, /stableUserIdForEmail/);

assert.match(read("firestore.rules"), /authIndex/);
assert.match(read("firestore.rules"), /currentUserId/);

const appJs = read("web/app.js");
assert.match(appJs, /completeFirebaseLogin/);
assert.match(appJs, /configureFirebaseLoginUi/);
assert.match(appJs, /await loadFirebaseConfig/);
assert.match(appJs, /isFirebaseAuthEnabled\(\)/);
assert.doesNotMatch(appJs, /const authEnabled = !!firebaseConfig\.projectId/);

const indexHtml = read("web/index.html");
assert.match(indexHtml, /id="login-hint"/);
assert.match(indexHtml, /id="login-subtitle"/);
assert.match(indexHtml, /id="firebase-signin-block"/);

assert.ok(read("firebase.json").includes("firestore.rules"));
assert.ok(read("docs/FIREBASE_SETUP.md").includes("Sign in with Google"));
assert.ok(read("worker/scripts/seed-firestore-users.mjs").includes("--bootstrap-team"));

// --- Module behavior (dummy mode, no local config) ---
const { firebaseConfig, loadFirebaseConfig, isFirebaseAuthEnabled } = await import(
  path.join(root, "web/firebase-config.js")
);

assert.equal(firebaseConfig.projectId, "");
assert.equal(isFirebaseAuthEnabled(), false);

await loadFirebaseConfig();
assert.equal(isFirebaseAuthEnabled(), false, "dummy mode when local config absent");

const { authMode, sessionFromFirebaseUser, persistFirebaseSession } = await import(
  path.join(root, "web/auth.js")
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
