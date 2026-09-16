#!/usr/bin/env node
/**
 * Apply Janus schema (phases 00–12) to Cloud SQL over TCP.
 *
 * init_all.sql uses psql \ir which fails over plain pg client — this script
 * runs each phase file in order. Idempotent (CREATE IF NOT EXISTS throughout).
 *
 * Usage (loads worker/.dev.vars automatically):
 *   node worker/scripts/apply-janus-schema.mjs
 *   node worker/scripts/apply-janus-schema.mjs --dry-run
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadDevVars, WORKER_ROOT } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";

const REPO_ROOT = join(WORKER_ROOT, "..");
const SCHEMA_DIR = join(REPO_ROOT, "janus", "schema");
const dryRun = process.argv.includes("--dry-run");

const PHASE_FILES = [
  "00_phase0_infra_and_org.sql",
  "01_phase1_crm_core.sql",
  "02_phase2_activities.sql",
  "03_phase3_ai_pipeline.sql",
  "04_phase4_scoring_rubrics.sql",
  "05_phase5_product_coaching.sql",
  "06_phase6_outbox_integrations_pii.sql",
  "07_grants.sql",
  "08_rls_hardening.sql",
  "09_id_registry.sql",
  "10_shape_version.sql",
  "10b_integration_enum.sql",
  "10c_run_type_enum_widen.sql",
  "11_deal_contact.sql",
  "12_read_model_views.sql",
  "13_rls_hardening_round2.sql",
  "14_rls_owner_write_calls.sql",
  "15_id_registry_backfill.sql",
  "16_ai_run_telemetry.sql",
  "17_rls_role_defaults.sql",
  "18_ai_run_rls.sql",
  "19_se_motion.sql",
  "20_history_tasks_feedback.sql",
  "21_identity_relationships.sql",
  "22_scoring_reshape.sql",
  "23_call_participant.sql",
  "24_task_write_path.sql",
  "24b_audit_notification_enums.sql",
  "25_audit_and_notifications.sql",
  "26_account_se_team.sql",
  "27_pricing_books.sql",
  "28_roadmap_gaps.sql",
  "29_precall_deal_required.sql",
  "30_fallback_telemetry.sql",
  "31_user_kv_sidecar.sql",
  "31_remaining_collections.sql",
  "32_deal_closed_won.sql",
  "33_user_usage.sql",
  // J-004: 34, 35 and 36 were listed in janus/schema/init_all.sql but NOT here,
  // so the only path with an npm alias (`npm run schema:apply`, also what
  // start-local-postgres.mjs calls) never applied them. Proven by applying this
  // list from zero against a disposable cluster and diffing against staging:
  //   - 34 creates v_se_score_leaderboard, so a fresh environment had no
  //     leaderboard view at all;
  //   - 35 fixes account/account_se_team RLS self-recursion — without it
  //     account_writable_by_current_user aborts with "stack depth limit
  //     exceeded", which was REPRODUCED on the from-zero database;
  //   - 36 adds 'research' to deal_stage_enum; per its own header, without it
  //     createLifecycle throws and activity/post_call/scorecard silently never
  //     land.
  // Staging had all three applied by hand, which is why the drift went unnoticed.
  "34_usage_and_leaderboard_views.sql",
  "35_fix_account_rls_recursion.sql",
  "36_add_research_deal_stage.sql",
  "37_fallback_correlation.sql",
  "38_ai_run_call_attribution.sql",
  "39_revoke_redact_pii_execute.sql",
];

loadDevVars();

const url =
  process.env.DATABASE_URL_MIGRATIONS ||
  process.env.DATABASE_URL ||
  "";

if (!url) {
  console.error("Set DATABASE_URL_MIGRATIONS in worker/.dev.vars (postgres role for DDL).");
  process.exit(1);
}

if (/^postgres(ql)?:\/\/janus_app[:@]/i.test(url)) {
  console.error("DDL must run as postgres superuser, not janus_app. Use DATABASE_URL_MIGRATIONS.");
  process.exit(1);
}

if (dryRun) {
  console.log("dry-run — would apply:", PHASE_FILES.join(", "));
  process.exit(0);
}

const client = new pg.Client(pgClientConfig(url));

await client.connect();
console.log("Connected for schema apply.");

for (const file of PHASE_FILES) {
  const path = join(SCHEMA_DIR, file);
  const sql = readFileSync(path, "utf8");
  process.stdout.write(`==> ${file} ... `);
  try {
    await client.query(sql);
    console.log("ok");
  } catch (err) {
    console.log("FAIL");
    console.error(err instanceof Error ? err.message : err);
    await client.end();
    process.exit(1);
  }
}

await client.end();
console.log("\nSchema apply complete. Next:");
console.log("  node worker/scripts/verify-db-env.mjs");
console.log("  node janus/tests/grants_smoke.test.mjs   # uses DATABASE_URL (janus_app)");
console.log("  node janus/tests/rls_fails_closed.test.mjs");
