#!/usr/bin/env tsx
/**
 * P9 gate (J-019): an LLM run must stay attributable to its call even though
 * the activity row does not exist yet when the run happens.
 *
 * WHY THE EXISTING TEST DID NOT CATCH THIS
 *
 * janus/tests/ai_run_insert.test.mjs passes 15/15 and asserts
 * "activity_id resolves via act_{callId}" — but it seeds the activity row
 * BEFORE calling insertAiRun. That ordering never occurs in production:
 *
 *   1. POST /api/analyze-call runs every LLM pass -> recordLlmUsage ->
 *      insertAiRun. handleAnalyzeCall writes NO activity row.
 *   2. The client saves later, and only then does POST /api/history create
 *      activity act_<callId>.
 *
 * So the resolver was correct and the test was correct, and attribution was
 * still 4 / 2816 (0.14%), because the only ordering either of them exercised
 * was the rare one (a re-analysis of an already-saved call). This gate
 * exercises the PRODUCTION ordering, which is why it fails before 38.
 *
 * Asserts:
 *   1. call_public_id is recorded even when the activity does not exist.
 *   2. Before the activity is saved, the run is visibly 'unsaved_call' — not
 *      silently indistinguishable from a free call.
 *   3. Once the activity IS saved, the SAME earlier run resolves to it.
 *      <- the invariant that fails before this change
 *   4. A run inserted after the activity exists keeps its stored FK ('stored').
 *   5. An act_-prefixed callId does not become act_act_<id> and still resolves.
 *   6. A run with no callId is 'no_call_id', distinct from 'unsaved_call'.
 *   7. ai_run is still append-only and the view still runs security_invoker,
 *      so this did not buy attribution by weakening 18_ai_run_rls.sql.
 *
 * DISPOSABLE LOCAL DATABASES ONLY — it inserts and deletes rows.
 * Refuses a non-loopback host unless --allow-remote. Fails loudly without a
 * database rather than skipping green (P15).
 */
import assert from "node:assert/strict";
import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";
import { insertAiRun, normalizeCallPublicId } from "../src/data/persistence/ai-run.ts";
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
  fail(`refusing to insert ai_run rows against non-loopback host "${host}". Pass --allow-remote only if it is disposable.`);
}

const RUN = `JANUS_AUDIT_TEST_p9_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const ORG = `${RUN}_org`;
const USER = `${RUN}_user`;
const ACCOUNT = `${RUN}_acc`;
/** The unsaved-at-analysis-time call — the production ordering. */
const CALL_LATE = `${RUN}_late`;
/** Already saved before its run — the re-analysis ordering. */
const CALL_EARLY = `${RUN}_early`;
/** Supplied act_-prefixed, to prove it is not double-prefixed. */
const CALL_PREFIXED = `${RUN}_prefixed`;

const env = { DATABASE_URL: APP_URL } as unknown as PostgresEnv;

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

/** insertAiRun is fire-and-forget by design, so poll rather than await it. */
async function waitForRun(callPublicId: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await admin.query(
      `SELECT id, activity_id, call_public_id, pass_name
         FROM ai_run WHERE call_public_id = $1 ORDER BY id`,
      [callPublicId],
    );
    if (r.rowCount && r.rowCount > 0) return r.rows;
    await new Promise((res) => setTimeout(res, 150));
  }
  return [];
}

async function attributionOf(aiRunId: string | number) {
  const r = await admin.query(
    `SELECT activity_id, attribution_source, call_public_id
       FROM v_ai_run_attributed WHERE id = $1`,
    [aiRunId],
  );
  return r.rows[0];
}

const baseRun = {
  passName: "analyze",
  userId: null,
  model: "gemini-3.5-flash",
  promptTokens: 100,
  outputTokens: 50,
  cachedTokens: 0,
  groundingQueries: 0,
  latencyMs: 42,
  cacheHit: false,
  retryCount: 0,
  costUsd: 0.000045,
  errorCode: null,
};

/** Create activity act_<callId> and register it, mirroring the history path. */
async function saveActivity(callId: string): Promise<string> {
  const publicId = `act_${callId}`;
  const ins = await admin.query(
    `INSERT INTO activity (public_id, account_id, owner_user_id, org_unit_id, activity_type, occurred_at)
     SELECT $1, a.id, u.id, u.org_unit_id, 'task', now()
       FROM account a, app_user u
      WHERE a.public_id = $2 AND u.public_id = $3
     RETURNING id`,
    [publicId, ACCOUNT, USER],
  );
  const activityId = String(ins.rows[0].id);
  await admin.query(
    `INSERT INTO id_registry (entity_type, public_id, internal_id)
     VALUES ('activity', $1, $2) ON CONFLICT DO NOTHING`,
    [publicId, activityId],
  );
  return activityId;
}

try {
  console.log(`P9 ai_run attribution gate — run ${RUN}\n`);

  // Preflight. Without migration 38 every assertion below fails for the same
  // single reason, and the teardown fails too — so say so once, clearly,
  // instead of emitting a wall of derived failures (P15: fail loudly, and
  // make the reason the first thing on screen).
  const col = await admin.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ai_run' AND column_name = 'call_public_id'`,
  );
  const view = await admin.query(`SELECT 1 FROM pg_class WHERE relname = 'v_ai_run_attributed'`);
  if (!col.rowCount || !view.rowCount) {
    fail(
      `migration 38_ai_run_call_attribution.sql is not applied to this database.\n` +
      `        ai_run.call_public_id: ${col.rowCount ? "present" : "MISSING"}\n` +
      `        v_ai_run_attributed:   ${view.rowCount ? "present" : "MISSING"}\n` +
      `        Apply it with: node worker/scripts/apply-janus-schema.mjs`,
    );
  }

  // --- fixtures --------------------------------------------------------------
  await admin.query(
    `INSERT INTO org_unit (id, name, unit_type, path) VALUES ($1, 'P9 Gate Org', 'team', $1)
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );
  await admin.query(
    `INSERT INTO app_user (public_id, email, org_unit_id) VALUES ($1, $2, $3)
     ON CONFLICT (public_id) DO NOTHING`,
    [USER, `${USER}@example.invalid`, ORG],
  );
  await admin.query(
    `INSERT INTO account (public_id, name) VALUES ($1, 'P9 Gate Account')
     ON CONFLICT (public_id) DO NOTHING`,
    [ACCOUNT],
  );
  // insertAiRun resolves this sentinel for its system context.
  await admin.query(
    `INSERT INTO app_user (public_id, email) VALUES ('usr_janus_ai', 'janus-ai@example.invalid')
     ON CONFLICT (public_id) DO NOTHING`,
  );

  // --- 1..2: the production ordering — run first, activity later -------------
  const preCheck = await admin.query(
    `SELECT count(*)::int n FROM activity WHERE public_id = $1`,
    [`act_${CALL_LATE}`],
  );
  check("precondition: the activity does NOT exist when the run happens", () =>
    assert.equal(preCheck.rows[0].n, 0, "fixture ordering is wrong — this must mirror analyze-call"));

  assert.ok(await insertAiRun(env, { ...baseRun, callId: CALL_LATE }), "insertAiRun returned false");
  const lateRows = await waitForRun(CALL_LATE);
  check("the call id is recorded even with no activity to point at", () => {
    assert.equal(lateRows.length, 1, `expected 1 row, got ${lateRows.length}`);
    assert.equal(lateRows[0].call_public_id, CALL_LATE);
  });
  check("activity_id is still NULL at insert — the FK genuinely cannot resolve", () =>
    assert.equal(lateRows[0]?.activity_id, null));

  const unsaved = lateRows[0] ? await attributionOf(lateRows[0].id) : undefined;
  check("an unsaved call is visibly 'unsaved_call', not indistinguishable from free", () => {
    assert.equal(unsaved?.attribution_source, "unsaved_call");
    assert.equal(unsaved?.activity_id, null);
  });

  // --- 3: THE INVARIANT — saving the call attributes the earlier run ---------
  const lateActivityId = await saveActivity(CALL_LATE);
  const resolved = lateRows[0] ? await attributionOf(lateRows[0].id) : undefined;
  check("saving the call attributes the run that preceded it", () => {
    assert.equal(String(resolved?.activity_id), lateActivityId);
    assert.equal(resolved?.attribution_source, "resolved");
  });

  // --- 4: the re-analysis ordering keeps its stored FK -----------------------
  const earlyActivityId = await saveActivity(CALL_EARLY);
  assert.ok(await insertAiRun(env, { ...baseRun, callId: CALL_EARLY }), "insertAiRun returned false");
  const earlyRows = await waitForRun(CALL_EARLY);
  const stored = earlyRows[0] ? await attributionOf(earlyRows[0].id) : undefined;
  check("a run after the activity exists stores the FK directly ('stored')", () => {
    assert.equal(String(earlyRows[0]?.activity_id), earlyActivityId);
    assert.equal(stored?.attribution_source, "stored");
  });

  // --- 5: an act_-prefixed callId must not become act_act_<id> ---------------
  await saveActivity(CALL_PREFIXED);
  assert.ok(
    await insertAiRun(env, { ...baseRun, callId: `act_${CALL_PREFIXED}` }),
    "insertAiRun returned false",
  );
  const prefixedRows = await waitForRun(CALL_PREFIXED);
  check("an act_-prefixed callId is stored bare, not double-prefixed", () => {
    assert.equal(prefixedRows.length, 1, "stored under the wrong key — check normalizeCallPublicId");
    assert.equal(prefixedRows[0].call_public_id, CALL_PREFIXED);
  });
  const doubled = await admin.query(
    `SELECT count(*)::int n FROM ai_run WHERE call_public_id LIKE $1`,
    [`act_${RUN}%`],
  );
  check("no row stored an act_ prefix in call_public_id", () =>
    assert.equal(doubled.rows[0].n, 0, "a prefixed value would join as act_act_<id> and never match"));

  // --- 6: no callId is a DIFFERENT state from an unsaved call ---------------
  assert.ok(await insertAiRun(env, { ...baseRun, callId: null, passName: `${RUN}_nocall` }), "insertAiRun returned false");
  const noCall = await admin.query(
    `SELECT v.attribution_source, v.call_public_id
       FROM v_ai_run_attributed v WHERE v.pass_name = $1`,
    [`${RUN}_nocall`],
  );
  check("a run with no call id is 'no_call_id', not 'unsaved_call'", () => {
    assert.equal(noCall.rows[0]?.attribution_source, "no_call_id");
    assert.equal(noCall.rows[0]?.call_public_id, null);
  });

  // --- 7: attribution was not bought by weakening the RLS posture -----------
  const invoker = await admin.query(
    `SELECT c.reloptions FROM pg_class c WHERE c.relname = 'v_ai_run_attributed'`,
  );
  check("v_ai_run_attributed runs security_invoker (ai_run RLS still applies)", () =>
    assert.ok(
      (invoker.rows[0]?.reloptions ?? []).includes("security_invoker=true"),
      "without it the view runs as owner and leaks every user's token spend",
    ));

  const grants = await admin.query(
    `SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'ai_run' AND grantee = 'janus_app'
        AND privilege_type IN ('UPDATE', 'DELETE')`,
  );
  check("ai_run is still append-only for janus_app (no UPDATE/DELETE regained)", () =>
    assert.equal(grants.rowCount, 0, `janus_app regained: ${grants.rows.map((r) => r.privilege_type).join(", ")}`));

  // --- normalizeCallPublicId, pure ------------------------------------------
  check("normalizeCallPublicId strips exactly one act_ prefix", () =>
    assert.equal(normalizeCallPublicId("act_abc"), "abc"));
  check("normalizeCallPublicId leaves a bare id alone", () =>
    assert.equal(normalizeCallPublicId("abc"), "abc"));
  check("normalizeCallPublicId returns null for blank/absent", () => {
    assert.equal(normalizeCallPublicId("   "), null);
    assert.equal(normalizeCallPublicId(undefined), null);
    assert.equal(normalizeCallPublicId(null), null);
  });
  check("normalizeCallPublicId does not strip a bare 'act_'", () =>
    assert.equal(normalizeCallPublicId("act_"), null));
} finally {
  // ai_run rows for saved calls ride activity ON DELETE CASCADE; the unsaved
  // and no-call rows have no parent, so delete them explicitly.
  // Tolerant: on a pre-38 database call_public_id does not exist, and a throw
  // here would mask the preflight message that explains why.
  await admin
    .query(`DELETE FROM ai_run WHERE call_public_id LIKE $1 OR pass_name LIKE $1`, [`${RUN}%`])
    .catch(() => admin.query(`DELETE FROM ai_run WHERE pass_name LIKE $1`, [`${RUN}%`]).catch(() => undefined));
  await admin.query(`DELETE FROM id_registry WHERE public_id LIKE $1`, [`act_${RUN}%`]);
  await admin.query(`DELETE FROM activity WHERE public_id LIKE $1`, [`act_${RUN}%`]);
  await admin.query(`DELETE FROM account WHERE public_id = $1`, [ACCOUNT]);
  await admin.query(`DELETE FROM app_user WHERE public_id = $1`, [USER]);
  await admin.query(`DELETE FROM org_unit WHERE id = $1`, [ORG]);
  const left = await admin
    .query(
      `SELECT count(*)::int n FROM ai_run WHERE call_public_id LIKE $1 OR pass_name LIKE $1`,
      [`${RUN}%`],
    )
    .catch(() => null);
  if (left) {
    console.log(`\n  cleanup: ${left.rows[0].n} fixture ai_run row(s) remain`);
    if (Number(left.rows[0].n) !== 0) failures += 1;
  }
  await admin.end();
  await closePool().catch(() => undefined);
}

console.log("");
if (failures > 0) fail(`${failures} check(s) failed.`);
console.log("OK — LLM runs stay attributable across the analyze-then-save ordering.");
