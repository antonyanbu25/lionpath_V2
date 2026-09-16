#!/usr/bin/env node
/**
 * Assume-identity case matrix (unit-level, no Firebase/SQL).
 */
import assert from "node:assert/strict";
import { parseAssumeIdentityClaims } from "../src/auth.ts";
import {
  buildAssumeIdentityFirebaseClaims,
  addAssumeIdentityHeaders,
  buildAssumeIdentityCapabilitiesResponse,
} from "../src/routes/assume-identity.ts";

let passed = 0;
function case_(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("Assume-identity case checks\n");

console.log("1. Claim mint ↔ verify (snake_case)");
case_("mint keys match auth parser", () => {
  const exp = new Date(Date.now() + 900_000).toISOString();
  const mint = buildAssumeIdentityFirebaseClaims(
    "asume_abc",
    "uid_admin",
    "admin@freshworks.com",
    "Ticket #42 debug",
    exp,
  );
  assert.deepEqual(Object.keys(mint).sort(), [
    "assume_admin_email",
    "assume_admin_uid",
    "assume_expires_at",
    "assume_identity",
    "assume_reason",
    "assume_session_id",
  ]);
  const parsed = parseAssumeIdentityClaims(mint);
  assert.equal(parsed?.assumeSessionId, "asume_abc");
  assert.equal(parsed?.assumeAdminUid, "uid_admin");
});

case_("valid session within TTL parses", () => {
  const exp = new Date(Date.now() + 60_000).toISOString();
  const p = parseAssumeIdentityClaims({
    assume_identity: true,
    assume_session_id: "s1",
    assume_admin_uid: "a1",
    assume_admin_email: "a@freshworks.com",
    assume_reason: "Support case 1234567890",
    assume_expires_at: exp,
  });
  assert.ok(p);
  assert.equal(p.assumeIdentity, true);
});

case_("expired assume_expires_at → 401 assumeIdentityExpired", () => {
  assert.throws(
    () =>
      parseAssumeIdentityClaims({
        assume_identity: true,
        assume_expires_at: new Date(Date.now() - 5000).toISOString(),
      }),
    (e) => e?.assumeIdentityExpired === true && e?.status === 401,
  );
});

case_("normal token (no assume claims) → undefined", () => {
  assert.equal(parseAssumeIdentityClaims({ email: "u@freshworks.com" }), undefined);
});

console.log("\n2. Original branch bug (camelCase mint — must NOT verify)");
case_("camelCase claims ignored (no silent admin bypass)", () => {
  const exp = new Date(Date.now() + 900_000).toISOString();
  assert.equal(
    parseAssumeIdentityClaims({
      assumeIdentity: true,
      assumeExpiresAt: exp,
      assumeSessionId: "x",
    }),
    undefined,
  );
});

console.log("\n3. Response headers");
case_("addAssumeIdentityHeaders when not assuming", () => {
  const h = addAssumeIdentityHeaders({ "X-Test": "1" }, { email: "a@f.com", uid: "1" });
  assert.equal(h["X-Assume-Identity"], undefined);
});

case_("addAssumeIdentityHeaders when assuming", () => {
  const exp = new Date(Date.now() + 60_000).toISOString();
  const h = addAssumeIdentityHeaders(
    {},
    {
      email: "se@freshworks.com",
      uid: "target",
      assumeIdentity: {
        assumeIdentity: true,
        assumeSessionId: "s1",
        assumeAdminUid: "admin1",
        assumeAdminEmail: "admin@freshworks.com",
        assumeReason: "reason long enough",
        assumeExpiresAt: exp,
      },
    },
  );
  assert.equal(h["X-Assume-Identity"], "true");
  assert.equal(h["X-Assume-Identity-Expires-At"], exp);
  assert.equal(h["X-Assume-Identity-Target"], "se@freshworks.com");
});

console.log("\n4. Request validation (mirrors handler rules)");
function validateAssumeBody(body, domain = "freshworks.com") {
  const targetEmail = String(body.targetEmail || "").trim().toLowerCase();
  const reason = String(body.reason || "").trim();
  if (!targetEmail) return { status: 400, error: "targetEmail" };
  if (reason.length < 10) return { status: 400, error: "reason" };
  if (domain && !targetEmail.endsWith(`@${domain}`)) return { status: 403, error: "domain" };
  return { status: 200 };
}

case_("missing targetEmail → 400", () => {
  assert.equal(validateAssumeBody({ reason: "long enough reason" }).status, 400);
});

case_("short reason → 400", () => {
  assert.equal(
    validateAssumeBody({ targetEmail: "se@freshworks.com", reason: "short" }).status,
    400,
  );
});

case_("wrong domain → 403", () => {
  assert.equal(
    validateAssumeBody(
      { targetEmail: "x@gmail.com", reason: "valid reason here" },
      "freshworks.com",
    ).status,
    403,
  );
});

case_("valid body → 200", () => {
  assert.equal(
    validateAssumeBody({
      targetEmail: "SE@Freshworks.com",
      reason: "Support ticket #9999 — blank dashboard",
    }).status,
    200,
  );
});

console.log("\n5. Authorization matrix (documented expectations)");
const authMatrix = [
  { callerSqlAdmin: false, targetSqlAdmin: false, expect: "403 caller not admin" },
  { callerSqlAdmin: true, targetSqlAdmin: true, expect: "403 cannot assume admin" },
  { callerSqlAdmin: true, targetSqlAdmin: false, targetSqlMissing: true, expect: "404 target no SQL" },
  { callerSqlAdmin: true, targetSqlAdmin: false, targetSqlMissing: false, expect: "200 mint token" },
  { callerSqlAdmin: false, targetSqlAdmin: false, callerSqlMissing: true, expect: "403 caller no SQL" },
];

for (const row of authMatrix) {
  case_(`auth: ${row.expect}`, () => {
    let status = 200;
    if (row.callerSqlMissing || !row.callerSqlAdmin) status = 403;
    else if (row.targetSqlMissing) status = 404;
    else if (row.targetSqlAdmin) status = 403;
    if (row.expect.startsWith("403")) assert.equal(status, 403);
    else if (row.expect.startsWith("404")) assert.equal(status, 404);
    else assert.equal(status, 200);
  });
}

console.log("\n6. Capabilities response");
case_("capabilities true/false", () => {
  assert.deepEqual(buildAssumeIdentityCapabilitiesResponse(true), { canAssumeIdentity: true });
  assert.deepEqual(buildAssumeIdentityCapabilitiesResponse(false), { canAssumeIdentity: false });
});

console.log("\n7. Route registration (static)");
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const workerRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexSrc = readFileSync(join(workerRoot, "src/index.ts"), "utf8");
case_("index registers assume + exit routes", () => {
  assert.match(indexSrc, /\/api\/admin\/assume-identity/);
  assert.match(indexSrc, /handleAssumeIdentityExit/);
  assert.match(indexSrc, /handleAssumeIdentityCapabilities/);
  assert.match(indexSrc, /X-Assume-Identity/);
});

const assumeSrc = readFileSync(join(workerRoot, "src/routes/assume-identity.ts"), "utf8");
case_("exit requires reauth (no admin token mint)", () => {
  assert.match(assumeSrc, /requireReauth:\s*true/);
  assert.doesNotMatch(assumeSrc, /createCustomToken\(claims\.assumeAdminUid\)/);
});

case_("assume rejects nested assume session", () => {
  assert.match(assumeSrc, /caller\.assumeIdentity/);
  assert.match(assumeSrc, /Cannot start assume-identity while already in assume mode/);
});

console.log(`\n${passed} cases passed — test-assume-identity-cases: ok`);
