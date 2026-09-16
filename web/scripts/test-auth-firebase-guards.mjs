#!/usr/bin/env node
/** Auth state guards — revoked session, SSO match, null-auth deferral. */

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modUrl = pathToFileURL(path.join(root, "auth-firebase-guards.js")).href;

const {
  normalizeAuthEmail,
  sessionMatchesFirebaseUser,
  shouldDeferNullAuth,
  shouldLogoutAfterNullCheck,
} = await import(modUrl);

assert.equal(normalizeAuthEmail("  User@Example.COM  "), "user@example.com");

assert.equal(
  sessionMatchesFirebaseUser({ email: "a@freshworks.com" }, { email: "a@freshworks.com" }),
  true,
);
assert.equal(
  sessionMatchesFirebaseUser({ email: "a@freshworks.com" }, { email: "b@freshworks.com" }),
  false,
);
assert.equal(sessionMatchesFirebaseUser(null, { email: "a@freshworks.com" }), false);
assert.equal(sessionMatchesFirebaseUser({ email: "a@freshworks.com" }, null), false);

// Not yet resolved — ignore null (test matrix #2 boot)
assert.equal(shouldDeferNullAuth({ authResolved: false, ssoInFlight: false, signingOut: false }), true);
// SSO popup open — defer (test matrix #7)
assert.equal(shouldDeferNullAuth({ authResolved: true, ssoInFlight: true, signingOut: false }), true);
assert.equal(shouldDeferNullAuth({ authResolved: true, ssoInFlight: false, signingOut: false }), false);

// Revoked / remote sign-out — logout after grace (test matrix #4, #5)
assert.equal(
  shouldLogoutAfterNullCheck({ liveFirebaseUser: null, ssoInFlight: false, signingOut: false }),
  true,
);
// Token refresh recovered — stay logged in (test matrix #3)
assert.equal(
  shouldLogoutAfterNullCheck({
    liveFirebaseUser: { email: "se@freshworks.com" },
    ssoInFlight: false,
    signingOut: false,
  }),
  false,
);
assert.equal(
  shouldLogoutAfterNullCheck({ liveFirebaseUser: null, ssoInFlight: true, signingOut: false }),
  false,
);

console.log("Auth firebase guard tests passed.");
