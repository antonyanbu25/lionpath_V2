/**
 * ai_run insert integration test — verifies insertAiRun lands rows with the
 * correct activity_id FK (regression guard for the post_call.id vs activity.id
 * resolution bug).
 *
 * Usage: DATABASE_URL=postgresql://janus_app:... node janus/tests/ai_run_insert.test.mjs
 * Skips (exit 0) when DATABASE_URL is unset.
 *
 * Notes:
 * - Fixture writes run inside one transaction with app.is_admin set (the
 *   activity FOR ALL policy is gated on is_admin(); sibling tests such as
 *   rls_fails_closed.test.mjs use the same set_config pattern).
 * - post_call is NOT seeded: 13_rls_hardening_round2.sql gives post_call only a
 *   SELECT policy, so janus_app cannot insert it even as admin. The FK probe
 *   instead uses an id outside the activity sequence — exactly the failure
 *   mode of the original bug (a post_call.id used where activity(id) was
 *   expected), and deterministic regardless of sequence state.
 * - ai_run cleanup rides the activity ON DELETE CASCADE (RI actions execute as
 *   the table owner, so the append-only REVOKE on ai_run does not block it).
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDevVars } from "../../worker/scripts/lib/load-dev-vars.mjs";
import { pgClientConfig } from "../../worker/scripts/lib/pg-client-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");
const require = createRequire(join(REPO_ROOT, "worker/package.json"));
const pg = require("pg");

loadDevVars();

const CALL_ID = "__ai_run_test_call__";
const ACTIVITY_PUBLIC_ID = `act_${CALL_ID}`;
const results = [];

function check(name, ok, details = "") {
  results.push({ name, ok });
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name}${details ? ` — ${details}` : ""}`);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("DATABASE_URL unset — skipping ai_run insert test.");
    return;
  }

  const client = new pg.Client(pgClientConfig(process.env.DATABASE_URL));
  await client.connect();

  try {
    const cols = await client.query(`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_run'
    `);
    const colMap = new Map(cols.rows.map((r) => [r.column_name, r.is_nullable]));
    for (const c of ["pass_name", "cached_tokens", "grounding_queries", "cache_hit", "retry_count", "user_id", "error_code"]) {
      check(`ai_run column ${c}`, colMap.has(c));
    }
    check("ai_run.run_type nullable", colMap.get("run_type") === "YES", `is_nullable=${colMap.get("run_type")}`);

    let activityId;
    await client.query("BEGIN");
    try {
      await client.query(`SELECT set_config('app.is_admin', 'true', true)`);
      await client.query(`
        INSERT INTO org_unit (id, name, unit_type, path) VALUES
          ('__ai_run_test_org__', 'AI Run Test Org', 'team', '/__ai_run_test_org__/')
        ON CONFLICT (id) DO NOTHING
      `);
      await client.query(`
        INSERT INTO app_user (public_id, email, org_unit_id) VALUES
          ('__ai_run_test_user__', 'ai-run-test@example.com', '__ai_run_test_org__')
        ON CONFLICT (public_id) DO NOTHING
      `);
      const users = await client.query(
        `SELECT id FROM app_user WHERE public_id = '__ai_run_test_user__'`,
      );
      const ownerId = users.rows[0].id;

      await client.query(`
        INSERT INTO account (public_id, name) VALUES ('__ai_run_test_acc__', 'AI Run Test Account')
        ON CONFLICT (public_id) DO NOTHING
      `);
      const acc = await client.query(`SELECT id FROM account WHERE public_id = '__ai_run_test_acc__'`);
      const accountId = acc.rows[0].id;

      const actIns = await client.query(
        `INSERT INTO activity (public_id, account_id, owner_user_id, org_unit_id, activity_type, occurred_at)
         VALUES ($1, $2, $3, '__ai_run_test_org__', 'call', now())
         ON CONFLICT (public_id) DO UPDATE SET updated_at = now()
         RETURNING id`,
        [ACTIVITY_PUBLIC_ID, accountId, ownerId],
      );
      activityId = actIns.rows[0].id;

      await client.query(
        `INSERT INTO id_registry (entity_type, public_id, internal_id)
         VALUES ('activity', $1, $2)
         ON CONFLICT (entity_type, public_id) DO UPDATE SET internal_id = EXCLUDED.internal_id`,
        [ACTIVITY_PUBLIC_ID, activityId],
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    const harness = spawnSync(
      "npx",
      ["tsx", join(__dirname, "ai_run_insert.harness.ts")],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, CALL_ID },
        stdio: "inherit",
        timeout: 120_000,
      },
    );
    check("insertAiRun harness exit 0", harness.status === 0, `status=${harness.status}`);

    const row = await client.query(
      `SELECT activity_id, pass_name, model, input_tokens, output_tokens, cost_usd, run_type, error_code
       FROM ai_run WHERE pass_name = 'analyze' AND model = 'gemini-3.5-flash'
       ORDER BY id DESC LIMIT 1`,
    );
    check("ai_run row inserted", row.rows.length === 1);
    if (row.rows.length === 1) {
      const r = row.rows[0];
      check("activity_id resolves via act_{callId}", String(r.activity_id) === String(activityId),
        `activity_id=${r.activity_id} expected=${activityId}`);
      check("run_type mapped from passName", r.run_type === "analysis", `run_type=${r.run_type}`);
      check("cost_usd persisted", r.cost_usd != null, `cost_usd=${r.cost_usd}`);
    }

    // FK probe: an id outside the activity sequence must be rejected (23503).
    // This is the original bug's failure mode — a post_call.id (separate
    // identity sequence) used where ai_run.activity_id expects activity(id).
    const maxAct = await client.query(`SELECT COALESCE(max(id), 0) + 1000 AS probe FROM activity`);
    const invalidActivityId = maxAct.rows[0].probe;
    let fkFailed = false;
    try {
      await client.query(
        `INSERT INTO ai_run (activity_id, pass_name, model, input_tokens, output_tokens)
         VALUES ($1, 'fk-bug-doc', 'test-model', 1, 1)`,
        [invalidActivityId],
      );
    } catch (err) {
      fkFailed = err.code === "23503";
    }
    check("non-activity id FK rejected", fkFailed, "documents activity_id must be activity.id, not post_call.id");

    // Cleanup. ai_run test rows ride the activity ON DELETE CASCADE (RI actions
    // run as the table owner, so the append-only REVOKE on ai_run does not
    // block them). Anything left behind is marked with __ai_run_test__ ids.
    await client.query("BEGIN");
    try {
      await client.query(`SELECT set_config('app.is_admin', 'true', true)`);
      await client.query(`DELETE FROM id_registry WHERE public_id = $1`, [ACTIVITY_PUBLIC_ID]);
      await client.query(`DELETE FROM activity WHERE public_id = $1`, [ACTIVITY_PUBLIC_ID]);
      await client.query(`DELETE FROM account WHERE public_id = '__ai_run_test_acc__'`);
      await client.query(`DELETE FROM app_user WHERE public_id = '__ai_run_test_user__'`);
      await client.query(`DELETE FROM org_unit WHERE id = '__ai_run_test_org__'`);
      await client.query("COMMIT");
    } catch (cleanupErr) {
      await client.query("ROLLBACK");
      console.warn("cleanup failed (non-fatal):", cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
    }
  } finally {
    await client.end();
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\n${failed.length} check(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${results.length} checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
