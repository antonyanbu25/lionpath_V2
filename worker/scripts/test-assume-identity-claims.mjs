#!/usr/bin/env node
/**
 * Unit checks for assume-identity claim naming (snake_case in Firebase JWT).
 */
import assert from "node:assert/strict";
import { parseAssumeIdentityClaims } from "../src/auth.ts";
import { buildAssumeIdentityFirebaseClaims } from "../src/routes/assume-identity.ts";

const expiresAt = new Date(Date.now() + 60_000).toISOString();
const firebaseClaims = buildAssumeIdentityFirebaseClaims(
  "asume_test123",
  "adminUid",
  "admin@freshworks.com",
  "Support ticket #9999",
  expiresAt,
);

assert.equal(firebaseClaims.assume_identity, true);
assert.equal(firebaseClaims.assume_session_id, "asume_test123");
assert.equal(firebaseClaims.assume_expires_at, expiresAt);

const parsed = parseAssumeIdentityClaims({
  assume_identity: true,
  assume_session_id: "asume_test123",
  assume_admin_uid: "adminUid",
  assume_admin_email: "admin@freshworks.com",
  assume_reason: "Support ticket #9999",
  assume_expires_at: expiresAt,
});

assert.ok(parsed);
assert.equal(parsed.assumeSessionId, "asume_test123");
assert.equal(parsed.assumeAdminEmail, "admin@freshworks.com");

assert.throws(
  () =>
    parseAssumeIdentityClaims({
      assume_identity: true,
      assume_expires_at: new Date(Date.now() - 1000).toISOString(),
    }),
  (err) => err && err.assumeIdentityExpired === true,
);

console.log("test-assume-identity-claims: ok");
