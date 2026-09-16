#!/usr/bin/env tsx
/**
 * Regression gate for J-010: account_writable_by_current_user() must never be
 * evaluated before app.user_id is established.
 *
 * The defect this guards against (routes.ts, pre-fix) put the predicate and the
 * set_config() that establishes its input in the SAME SELECT target list:
 *
 *   SELECT account_writable_by_current_user(resolve_internal_id('account',$1)) AS ok
 *        , set_config('app.user_id', $2, true) IS NOT NULL AS ctx_ok
 *
 * PostgreSQL does not guarantee target-list evaluation order, and in practice
 * evaluates left to right. The predicate is listed FIRST and the set_config
 * SECOND, so the predicate always evaluates against the pre-statement value of
 * app.user_id — which is unset. Measured on a disposable cluster: the write was
 * denied 60/60 runs, while a current_user_id() column positioned AFTER the
 * setter did observe the new value 60/60. So this was a deterministic denial,
 * not a flaky one. For an account that HAS an active account_se_team mapping,
 * a predicate that observes NULL returns false:
 *   - is_admin()                                      -> false
 *   - EXISTS(... se_user_id = NULL)                    -> false
 *   - NOT EXISTS(... any active mapping)               -> false, mapping exists
 * ...so a write the RLS policy would have allowed was denied and logged as
 * not_authorized. On staging that produced 1130 refused updateAccount writes,
 * 1015 of them in sql mode — which v_sql_coverage defines as lost writes.
 * set_config(..., is_local=true) is also discarded at statement end unless an
 * explicit transaction is open, which a bare pool.query() never provides.
 *
 * Cases asserted:
 *   1. mapped SE   -> writable  (the regression: false before the fix)
 *   2. unmapped SE -> NOT writable  (proves the fix is not just always-true)
 *   3. no session variable at all -> NOT writable, which is the deterministic
 *      harm the non-deterministic ordering can produce
 *   4. a transaction-local setting does not survive to the next statement, so a
 *      bare pool.query() could never have scoped the write that followed it
 *
 * Cases 3 and 4 are deliberately the *deterministic* halves of the defect. This
 * test does not assert target-list evaluation order itself: that is unspecified
 * behaviour, and a test that pins it would be asserting a PostgreSQL
 * implementation detail rather than our contract.
 *
 * DISPOSABLE LOCAL DATABASES ONLY. This test commits fixtures and deletes them,
 * so it refuses to run against a non-loopback host unless --allow-remote is
 * passed explicitly. It does not skip silently when DATABASE_URL is unset: per
 * P15 an absent database is a loud failure, not a green tick. Use --allow-skip
 * for the deliberate local opt-out.
 *
 * Usage:
 *   node worker/scripts/start-local-postgres.mjs      # or an equivalent cluster
 *   npx tsx worker/scripts/test-account-writable-session.ts
 */
import assert from "node:assert/strict";
import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";
import { accountWritableBySession } from "../src/data/persistence/session-context.ts";
import type { PostgresEnv } from "../src/data/persistence/postgres-pool.ts";

loadDevVars();

const argv = process.argv.slice(2);
const allowSkip = argv.includes("--allow-skip");
const allowRemote = argv.includes("--allow-remote");

const APP_URL = (process.env.DATABASE_URL || "").trim();
const MIG_URL = (process.env.DATABASE_URL_MIGRATIONS || "").trim();

function fail(message: string): never {
  console.error(`\n[FAIL] ${message}`);
  process.exit(1);
}

if (!APP_URL || !MIG_URL) {
  if (allowSkip) {
    console.log("[SKIP] DATABASE_URL/DATABASE_URL_MIGRATIONS unset (--allow-skip).");
    process.exit(0);
  }
  fail(
    "DATABASE_URL (janus_app) and DATABASE_URL_MIGRATIONS (postgres) must both be set.\n" +
      "       Start a disposable cluster first, or pass --allow-skip to opt out deliberately.",
  );
}

const host = new URL(APP_URL.replace(/^postgresql:/, "http:")).hostname;
const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
if (!isLoopback && !allowRemote) {
  fail(
    `refusing to run against non-loopback host "${host}". This test commits and ` +
      `deletes fixture rows and is for disposable local databases only.\n` +
      `       Pass --allow-remote only if you are certain the target is disposable.`,
  );
}

const STAMP = `JANUS_AUDIT_TEST_${new Date().toISOString().replace(/[^0-9]/g, "")}_${Math.random()
  .toString(36)
  .slice(2, 8)}`;
const ORG_ID = `${STAMP}_org`;
const ACCT_PUBLIC_ID = `${STAMP}_acct`;

const { default: pgMod } = await import("pg");
const admin = new pgMod.Client(pgClientConfig(MIG_URL));
await admin.connect();

const env: PostgresEnv = { DATABASE_URL: APP_URL } as PostgresEnv;
let mappedUserId = 0;
let unmappedUserId = 0;
let accountId = 0;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  try {
    assert.deepEqual(actual, expected);
    console.log(`  [PASS] ${label}`);
  } catch {
    failures += 1;
    console.log(`  [FAIL] ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

try {
  console.log(`J-010 regression gate — fixture stamp ${STAMP}\n`);

  // ---- fixtures (committed, so the helper's own connection can see them) ----
  await admin.query("SELECT set_config('app.is_admin','true',true)");
  await admin.query(
    `INSERT INTO org_unit (id, name, unit_type, path) VALUES ($1, $1, 'team', '/' || $1 || '/')`,
    [ORG_ID],
  );
  const mk = async (suffix: string): Promise<number> => {
    const r = await admin.query(
      `INSERT INTO app_user (public_id, email, display_name, org_unit_id, status)
       VALUES ($1, $2, $1, $3, 'active') RETURNING id`,
      [`${STAMP}_${suffix}`, `${STAMP}_${suffix}@example.invalid`, ORG_ID],
    );
    return Number(r.rows[0].id);
  };
  mappedUserId = await mk("mapped");
  unmappedUserId = await mk("unmapped");

  const acct = await admin.query(
    `INSERT INTO account (public_id, name, slug) VALUES ($1, $1, $1) RETURNING id`,
    [ACCT_PUBLIC_ID],
  );
  accountId = Number(acct.rows[0].id);
  // resolve_internal_id() reads id_registry, so the mapping must exist.
  await admin.query(`SELECT register_id('account', $1, $2)`, [ACCT_PUBLIC_ID, accountId]);

  // Claim the account for the mapped user only. This is what makes the
  // NOT EXISTS arm of the predicate false, which is what exposed the bug.
  await admin.query(
    `INSERT INTO account_se_team (account_id, se_user_id, role) VALUES ($1, $2, 'primary')`,
    [accountId, mappedUserId],
  );
  console.log(`  fixtures: org=${ORG_ID} account=${accountId} mapped=${mappedUserId} unmapped=${unmappedUserId}\n`);

  const orgPath = `/${ORG_ID}/`;

  // ---- case 1: the regression ----
  const mappedWritable = await accountWritableBySession(
    { userId: mappedUserId, orgUnitPath: orgPath, isAdmin: false },
    ACCT_PUBLIC_ID,
    env,
  );
  check("mapped SE can write a claimed account", mappedWritable, true);

  // ---- case 2: negative case, so case 1 cannot pass by being always-true ----
  const unmappedWritable = await accountWritableBySession(
    { userId: unmappedUserId, orgUnitPath: orgPath, isAdmin: false },
    ACCT_PUBLIC_ID,
    env,
  );
  check("unmapped SE cannot write a claimed account", unmappedWritable, false);

  // ---- case 3: the deterministic harm — no session var means no write ----
  // Fresh connection with app.user_id never set. This is the state the predicate
  // was intermittently evaluated in, and it denies a write the policy allows.
  const bare = new pgMod.Client(pgClientConfig(MIG_URL));
  await bare.connect();
  try {
    const denied = await bare.query(
      `SELECT account_writable_by_current_user(resolve_internal_id('account', $1)) AS ok
            , current_user_id() AS user_seen`,
      [ACCT_PUBLIC_ID],
    );
    check("with no app.user_id, a claimed account is NOT writable", denied.rows[0].ok, false);
    check("with no app.user_id, current_user_id() is null", denied.rows[0].user_seen, null);

    // ---- case 4: is_local=true is discarded at statement end ----
    await bare.query(`SELECT set_config('app.user_id', $1, true)`, [String(mappedUserId)]);
    const after = await bare.query(`SELECT current_user_id() AS user_seen`);
    check(
      "a transaction-local setting does not survive to the next statement",
      after.rows[0].user_seen,
      null,
    );
  } finally {
    await bare.end();
  }
} finally {
  // ---- cleanup by exact ids, then prove the rows are gone ----
  await admin.query("SELECT set_config('app.is_admin','true',true)");
  if (accountId) await admin.query(`DELETE FROM account_se_team WHERE account_id = $1`, [accountId]);
  if (accountId) await admin.query(`DELETE FROM id_registry WHERE entity_type='account' AND public_id = $1`, [ACCT_PUBLIC_ID]);
  if (accountId) await admin.query(`DELETE FROM account WHERE id = $1`, [accountId]);
  await admin.query(`DELETE FROM app_user WHERE public_id LIKE $1`, [`${STAMP}%`]);
  await admin.query(`DELETE FROM org_unit WHERE id = $1`, [ORG_ID]);

  const left = await admin.query(
    `SELECT (SELECT count(*) FROM account WHERE public_id = $1)
          + (SELECT count(*) FROM app_user WHERE public_id LIKE $2)
          + (SELECT count(*) FROM org_unit WHERE id = $3) AS n`,
    [ACCT_PUBLIC_ID, `${STAMP}%`, ORG_ID],
  );
  const leftover = Number(left.rows[0].n);
  console.log(`\n  cleanup: ${leftover === 0 ? "verified — 0 fixture rows remain" : `LEFTOVER ${leftover} ROWS`}`);
  if (leftover !== 0) failures += 1;
  await admin.end();
  const { closePool } = await import("../src/data/persistence/postgres-pool.ts");
  await closePool().catch(() => undefined);
}

if (failures > 0) fail(`${failures} assertion(s) failed.`);
console.log("\nOK — J-010 regression gate passed.");
