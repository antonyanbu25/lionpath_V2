#!/usr/bin/env tsx
/**
 * P5 gate: a failed or skipped durable write must be QUERYABLE and ATTRIBUTABLE.
 *
 * P5's invariant is that every requested durable write either commits to
 * PostgreSQL or produces a queryable, attributable failure. Before this, seven
 * skip conditions in tryHistoryPostCallSqlWrite returned silently or wrote only
 * a console line, and a thrown write error was reported by returning its stack
 * trace to the client in a `_sqlDualWriteError` field. None of that was
 * queryable: you could not ask "which calls silently failed to persist last
 * week, and for whom".
 *
 * Asserts:
 *   1. logFallback lands a row that can be found by correlation id.
 *   2. The ambient per-request correlation id is picked up without any call site
 *      threading it (runWithRequestContext -> getCorrelationId).
 *   3. actor and owner are recorded separately — they differ in a manager proxy
 *      flow, and attributing a lost write to the actor points at the wrong
 *      person's data.
 *   4. In sql mode the row is marked persistence_mode='sql', which is what
 *      v_sql_coverage counts as lost_writes.
 *   5. The reason vocabulary in fallback-log.ts matches chk_sfl_reason in the
 *      schema — a mismatch makes the INSERT fail and get swallowed, so the
 *      failure would itself be silent.
 *
 * DISPOSABLE LOCAL DATABASES ONLY — it inserts and deletes telemetry rows.
 * Refuses a non-loopback host unless --allow-remote. Fails loudly without a
 * database rather than skipping green (P15).
 */
import assert from "node:assert/strict";
import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";
import { logFallback, type FallbackReason } from "../src/data/persistence/fallback-log.ts";
import { runWithRequestContext } from "../src/request-context.ts";
import { closePool } from "../src/data/persistence/postgres-pool.ts";
import type { PostgresEnv } from "../src/data/persistence/postgres-pool.ts";

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
  fail(`refusing to insert telemetry rows against non-loopback host "${host}". Pass --allow-remote only if it is disposable.`);
}

const RUN = `JANUS_AUDIT_TEST_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const CORRELATION = `${RUN}_corr`;
const ACTOR = `${RUN}_actor`;
const OWNER = `${RUN}_owner`;
const ENTITY = `${RUN}_entity`;

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

/** logFallback is fire-and-forget by design, so poll rather than await it. */
async function waitForRow(correlationId: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await admin.query(
      `SELECT method, reason, detail, user_public_id, owner_public_id, entity_public_id,
              persistence_mode, correlation_id
         FROM sql_fallback_log WHERE correlation_id = $1`,
      [correlationId],
    );
    if (r.rowCount && r.rowCount > 0) return r.rows[0];
    await new Promise((res) => setTimeout(res, 150));
  }
  return null;
}

try {
  console.log(`P5 fallback-telemetry gate — run ${RUN}\n`);

  // --- 1..4: an explicit sql-mode fallback, with actor and owner distinct ----
  const env = { DATABASE_URL: APP_URL, PERSISTENCE_MODE: "sql" } as unknown as PostgresEnv;
  logFallback(
    {
      method: "historyPostCallDualWrite",
      reason: "no_sql_session",
      detail: "gate fixture",
      userPublicId: ACTOR,
      ownerPublicId: OWNER,
      entityPublicId: ENTITY,
      correlationId: CORRELATION,
    },
    env,
  );
  const row = await waitForRow(CORRELATION);
  check("a fallback is queryable by correlation id", () => assert.ok(row, "no row landed"));
  if (row) {
    check("method and reason recorded", () => {
      assert.equal(row.method, "historyPostCallDualWrite");
      assert.equal(row.reason, "no_sql_session");
    });
    check("actor and owner are recorded SEPARATELY", () => {
      assert.equal(row.user_public_id, ACTOR);
      assert.equal(row.owner_public_id, OWNER);
      assert.notEqual(row.user_public_id, row.owner_public_id);
    });
    check("entity recorded", () => assert.equal(row.entity_public_id, ENTITY));
    check("sql mode is marked, so v_sql_coverage counts it as a lost write", () =>
      assert.equal(row.persistence_mode, "sql"));
  }

  // --- 2: ambient correlation id, with no call site threading it -------------
  const ambient = `${RUN}_ambient`;
  await runWithRequestContext(ambient, async () => {
    logFallback(
      { method: "historyPostCallDualWrite", reason: "write_error", detail: "ambient fixture", entityPublicId: ENTITY },
      env,
    );
    // Give the fire-and-forget insert a moment while the context is still set.
    await new Promise((res) => setTimeout(res, 50));
  });
  const ambientRow = await waitForRow(ambient);
  check("the ambient request correlation id is picked up automatically", () =>
    assert.ok(ambientRow, "no row carried the ambient correlation id"));

  // --- 5: reason vocabulary matches the schema CHECK ------------------------
  const REASONS: FallbackReason[] = [
    "postgres_not_configured", "no_verified_user", "no_sql_session", "not_authorized",
    "missing_required_field", "shape_validation_failed", "unmapped_parent",
    "no_deal_or_lifecycle", "deal_provision_failed", "method_not_implemented", "write_error",
  ];
  const constraint = await admin.query(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'chk_sfl_reason'`,
  );
  check("chk_sfl_reason exists", () => assert.ok(constraint.rows[0]?.def, "constraint not found"));
  const def = String(constraint.rows[0]?.def ?? "");
  for (const reason of REASONS) {
    check(`reason "${reason}" is accepted by chk_sfl_reason`, () =>
      assert.ok(def.includes(`'${reason}'`), `not in the CHECK — the INSERT would fail and be swallowed`));
  }
} finally {
  const del = await admin.query(`DELETE FROM sql_fallback_log WHERE correlation_id LIKE $1`, [`${RUN}%`]);
  const left = await admin.query(`SELECT count(*)::int n FROM sql_fallback_log WHERE correlation_id LIKE $1`, [`${RUN}%`]);
  console.log(`\n  cleanup: deleted ${del.rowCount} row(s); ${left.rows[0].n} remain`);
  if (Number(left.rows[0].n) !== 0) failures += 1;
  await admin.end();
  await closePool().catch(() => undefined);
}

console.log("");
if (failures > 0) fail(`${failures} check(s) failed.`);
console.log("OK — failed durable writes are queryable and attributable.");
