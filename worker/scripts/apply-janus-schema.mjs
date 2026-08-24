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
  "16_ai_run_telemetry.sql",
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
