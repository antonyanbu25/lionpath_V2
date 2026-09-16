#!/usr/bin/env tsx
/**
 * P11 gate (J-021, J-023): the dormant mechanisms are observable and invocable.
 *
 * The audit's framing was "all four exist and are correct; each needs a Cloud
 * Scheduler entry, not new code". Two of the four needed code after all:
 *
 *   - sync_outbox had NO READER but the projector itself, so a permanently
 *     failed row or a stalled backlog was invisible. You cannot alert on a
 *     queue nothing reads, and the projector's reaper lives INSIDE
 *     claim_outbox_batch, so a projector that is not running cannot report
 *     that it is not running.
 *   - the usage rollup existed only as a CLI, and its own docstring said it
 *     was "meant to be run manually ... not on a schedule" — which is exactly
 *     why user_usage_daily held 2 rows against 172 login events.
 *
 * Asserts:
 *   1. The health reader counts every status, including zero-row ones.
 *   2. A permanently failed row is visible with its age — the dead-letter case.
 *   3. stuckProcessing uses the SAME condition and threshold as the reaper
 *      inside claim_outbox_batch, so the two cannot drift apart.
 *   4. enqueueActive is false in sql mode and true in dual. This is the check
 *      that stops a pending-backlog alert from firing forever: with
 *      PERSISTENCE_MODE=sql nothing enqueues, so a non-zero backlog is
 *      historical and undrainable rather than a live incident.
 *   5. The rollup actually populates user_usage_daily for a seeded login, so
 *      "has rows for the last complete day" becomes an assertable property.
 *   6. Re-running the rollup is idempotent — it must not double-count.
 *   7. redact_pii() is NOT executable by janus_app. This is recorded as a
 *      PASSING assertion rather than a fix, because it is why the fourth
 *      mechanism is deliberately left unwired. See the note at the bottom.
 *
 * DISPOSABLE LOCAL DATABASES ONLY — it inserts and deletes rows.
 * Refuses a non-loopback host unless --allow-remote. Fails loudly without a
 * database rather than skipping green (P15).
 */
import assert from "node:assert/strict";
import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";
import { readOutboxHealth } from "../src/routes/internal-outbox-health.ts";
import { rollupUserUsage } from "./rollup-user-usage.mjs";
import { closePool, getPool } from "../src/data/persistence/postgres-pool.ts";
import type { Env } from "../src/env.ts";

loadDevVars();

const argv = process.argv.slice(2);
const allowSkip = argv.includes("--allow-skip");
const allowRemote = argv.includes("--allow-remote");

const APP_URL = (process.env.DATABASE_URL || "").trim();
const MIG_URL = (process.env.DATABASE_URL_MIGRATIONS || "").trim();

function fail(msg: string): never {
  console.error(`\n[FAIL] ${msg}`);
  process.exit(1);
}

if (!APP_URL || !MIG_URL) {
  if (allowSkip) {
    console.log("[SKIP] DATABASE_URL/DATABASE_URL_MIGRATIONS unset (--allow-skip).");
    process.exit(0);
  }
  fail("DATABASE_URL (janus_app) and DATABASE_URL_MIGRATIONS (postgres) must both be set.");
}

const host = new URL(APP_URL.replace(/^postgresql:/, "http:")).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host) && !allowRemote) {
  fail(`refusing to seed outbox/usage rows against non-loopback host "${host}". Pass --allow-remote only if it is disposable.`);
}

const RUN = `JANUS_AUDIT_TEST_p11_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const ORG = `${RUN}_org`;
const USER = `${RUN}_user`;
const EMAIL = `${USER}@example.invalid`;

const sqlEnv = { DATABASE_URL: APP_URL, PERSISTENCE_MODE: "sql" } as unknown as Env;
const dualEnv = { DATABASE_URL: APP_URL, PERSISTENCE_MODE: "dual" } as unknown as Env;

const { default: pgMod } = await import("pg");
const admin = new pgMod.Client(pgClientConfig(MIG_URL));
await admin.connect();

let failures = 0;
function check(label: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  FAIL  ${label}\n          ${err instanceof Error ? err.message : String(err)}`);
  }
}

try {
  console.log(`P11 dormant-jobs gate — run ${RUN}\n`);

  // --- fixtures --------------------------------------------------------------
  await admin.query(
    `INSERT INTO org_unit (id, name, unit_type, path) VALUES ($1, 'P11 Gate Org', 'team', $1)
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );
  const userIns = await admin.query(
    `INSERT INTO app_user (public_id, email, org_unit_id) VALUES ($1, $2, $3)
     ON CONFLICT (public_id) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [USER, EMAIL, ORG],
  );
  const userId = String(userIns.rows[0].id);
  await admin.query(
    `INSERT INTO app_user (public_id, email) VALUES ('usr_janus_ai', 'janus-ai@example.invalid')
     ON CONFLICT (public_id) DO NOTHING`,
  );
  // Reuse the integration row the projector itself resolves
  // (int_firestore_projection, seeded by 11_deal_contact.sql) rather than
  // inventing one: a fixture with a different provider would exercise a
  // combination the projector never sees.
  const integLookup = await admin.query<{ id: string }>(
    `SELECT id FROM integration WHERE public_id = 'int_firestore_projection'`,
  );
  if (!integLookup.rowCount) {
    fail("integration int_firestore_projection is missing — apply janus/schema/11_deal_contact.sql");
  }
  const integrationId = String(integLookup.rows[0].id);

  const before = await readOutboxHealth(sqlEnv);

  // One row per interesting state. The 'processing' row is backdated past the
  // reaper threshold so it must show up as stuck; the 'failed' row is the
  // dead-letter case that had no reader at all.
  const seed = async (status: string, lastAttempted: string | null) => {
    await admin.query(
      `INSERT INTO sync_outbox (entity_type, entity_id, integration_id, operation, payload, status, last_attempted_at)
       VALUES ($1, $2, $3, 'update', '{}'::jsonb, $4::sync_outbox_status_enum, $5)`,
      [`${RUN}_ent`, `${RUN}_${status}`, integrationId, status, lastAttempted],
    );
  };
  await seed("pending", null);
  await seed("failed", null);
  await seed("processing", null);
  // Backdated in a separate statement: `now() - interval` is an expression and
  // cannot travel as a bind parameter.
  await admin.query(
    `UPDATE sync_outbox SET last_attempted_at = now() - interval '42 minutes'
      WHERE entity_id = $1`,
    [`${RUN}_processing`],
  );

  const after = await readOutboxHealth(sqlEnv);

  // --- 1..3: the reader ------------------------------------------------------
  check("every status is reported, including zero-row ones", () => {
    for (const s of ["pending", "processing", "completed", "failed"]) {
      assert.ok(s in after.counts, `missing status "${s}" — an alert cannot key off an absent field`);
      assert.equal(typeof after.counts[s], "number");
    }
  });
  check("the seeded pending row is counted", () =>
    assert.equal(after.counts.pending, before.counts.pending + 1));
  check("a permanently failed row is visible — the dead-letter case", () => {
    assert.equal(after.counts.failed, before.counts.failed + 1);
    assert.ok(after.oldestFailedAgeSeconds !== null, "no age reported for a failed row");
    assert.ok(Number(after.oldestFailedAgeSeconds) >= 0);
  });
  check("a row past the reaper threshold is reported as stuck", () =>
    assert.equal(after.stuckProcessing, before.stuckProcessing + 1));

  // The reader must agree with the reaper, not merely look similar to it.
  const reaperWould = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM sync_outbox
      WHERE status = 'processing' AND last_attempted_at < now() - interval '10 minutes'`,
  );
  check("stuckProcessing matches claim_outbox_batch's own reaper condition", () =>
    assert.equal(
      after.stuckProcessing,
      Number(reaperWould.rows[0].n),
      "the reader and the reaper disagree — one of them has drifted",
    ));

  // --- 4: the check that prevents a permanent false alarm --------------------
  check("sql mode reports enqueueActive false (nothing can enqueue)", () => {
    assert.equal(after.persistenceMode, "sql");
    assert.equal(after.enqueueActive, false);
  });
  const dual = await readOutboxHealth(dualEnv);
  check("dual mode reports enqueueActive true", () => {
    assert.equal(dual.persistenceMode, "dual");
    assert.equal(dual.enqueueActive, true);
  });

  // --- 5..6: the rollup is invocable and idempotent --------------------------
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await admin.query(
    `INSERT INTO user_usage_logins (user_id, email, logged_in_at, source)
     VALUES ($1, $2, ($3::date + interval '9 hours'), 'web'),
            ($1, $2, ($3::date + interval '14 hours'), 'web')`,
    [userId, EMAIL, day],
  );

  const pool = await getPool(sqlEnv);
  const runRollup = async () => {
    const client = await pool.connect();
    try {
      return await rollupUserUsage(client, [day]);
    } finally {
      client.release();
    }
  };

  await runRollup();
  const first = await admin.query<{ logins: number; n: number }>(
    `SELECT logins, count(*) OVER ()::int AS n FROM user_usage_daily
      WHERE user_id = $1 AND usage_date = $2::date`,
    [userId, day],
  );
  check("the rollup produces a row for the last complete day", () => {
    assert.equal(first.rowCount, 1, "no user_usage_daily row — this is J-023's 2-rows-vs-172-logins");
    assert.equal(Number(first.rows[0].logins), 2, "login count wrong");
  });

  await runRollup();
  const second = await admin.query<{ logins: number }>(
    `SELECT logins FROM user_usage_daily WHERE user_id = $1 AND usage_date = $2::date`,
    [userId, day],
  );
  check("re-running the rollup is idempotent (no double-count)", () => {
    assert.equal(second.rowCount, 1, `expected 1 row, got ${second.rowCount}`);
    assert.equal(Number(second.rows[0].logins), 2, "logins changed on re-run");
  });

  // --- 7: why the fourth mechanism is NOT wired -----------------------------
  // redact_pii() is SECURITY DEFINER and granted only to janus_redactor. The
  // worker connects as janus_app, so it CANNOT invoke it, and provisioning a
  // janus_redactor credential is a hard stop.
  //
  // The stronger reason not to wire it: redact_pii() NULLs post_call.analysis
  // and .detail for lost deals older than 12 months. It is irreversible. The
  // other three jobs project or aggregate; this one destroys. Putting it on a
  // schedule is a data-retention decision with a legal dimension, not a
  // wiring task, so it stays unwired until someone owns that decision.
  const redactGrants = await admin.query<{ grantee: string }>(
    `SELECT grantee FROM information_schema.role_routine_grants
      WHERE routine_name = 'redact_pii' ORDER BY grantee`,
  );
  const grantees = redactGrants.rows.map((r) => r.grantee);
  check("redact_pii() is not executable by PUBLIC (migration 39)", () =>
    assert.ok(
      !grantees.includes("PUBLIC"),
      `PUBLIC holds EXECUTE on an irreversible SECURITY DEFINER routine. grantees: ${grantees.join(", ")}`,
    ));
  check("redact_pii() is not executable by janus_app (the worker's role)", () =>
    assert.ok(
      !grantees.includes("janus_app"),
      `janus_app holds EXECUTE on an irreversible SECURITY DEFINER routine. grantees: ${grantees.join(", ")}`,
    ));
  check("janus_redactor still holds EXECUTE (the revoke was scoped, not total)", () =>
    assert.ok(grantees.includes("janus_redactor"), `grantees: ${grantees.join(", ")}`));

  // The revoke is only durable if nothing re-widens it afterwards. 07_grants.sql
  // does GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO janus_app, which is
  // exactly what made 06's janus_redactor grant decorative in the first place.
  const effective = await admin.query<{ v: boolean }>(
    `SELECT has_function_privilege('janus_app', 'redact_pii()', 'EXECUTE') AS v`,
  );
  check("janus_app's EFFECTIVE privilege is false, not just its direct grant", () =>
    assert.equal(
      effective.rows[0].v,
      false,
      "a blanket GRANT EXECUTE ON ALL FUNCTIONS has re-widened it — move it before migration 39",
    ));
} finally {
  await admin.query(`DELETE FROM sync_outbox WHERE entity_type = $1`, [`${RUN}_ent`]);
  // Keyed on the public_id, NOT the email: the rollup normalises email, so an
  // email-keyed delete leaves rows behind and user_usage_daily's FK is
  // ON DELETE RESTRICT, which then fails the app_user delete below.
  await admin.query(
    `DELETE FROM user_usage_daily WHERE user_id IN (SELECT id FROM app_user WHERE public_id = $1)`,
    [USER],
  );
  await admin.query(
    `DELETE FROM user_usage_logins WHERE user_id IN (SELECT id FROM app_user WHERE public_id = $1)`,
    [USER],
  );
  await admin.query(`DELETE FROM app_user WHERE public_id = $1`, [USER]);
  await admin.query(`DELETE FROM org_unit WHERE id = $1`, [ORG]);
  const left = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM sync_outbox WHERE entity_type = $1`,
    [`${RUN}_ent`],
  );
  console.log(`\n  cleanup: ${left.rows[0].n} fixture outbox row(s) remain`);
  if (Number(left.rows[0].n) !== 0) failures += 1;
  await admin.end();
  await closePool().catch(() => undefined);
}

console.log("");
if (failures > 0) fail(`${failures} check(s) failed.`);
console.log("OK — the outbox is observable and the usage rollup is invocable.");
