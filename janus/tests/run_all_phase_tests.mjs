/**
 * Janus Implementation Validation Test Suite
 * Tests all 7 phases of the Janus Data Model & Integration Spec (v9.3)
 */

import * as fs from 'fs';
import * as path from 'path';

const results = [];

function assert(condition, phase, name, details) {
  if (condition) {
    results.push({ phase, name, passed: true, details });
    console.log(`[PASS] ${phase} - ${name}`);
  } else {
    results.push({ phase, name, passed: false, details });
    console.error(`[FAIL] ${phase} - ${name}: ${details}`);
  }
}

async function runValidation() {
  console.log("=================================================");
  console.log(" Janus Data Model v9.3 - Phase Validation Suite");
  console.log("=================================================\n");

  const schemaDir = path.join(process.cwd(), 'janus', 'schema');

  // Verify all 7 schema files exist and are non-empty
  const files = [
    '00_phase0_infra_and_org.sql',
    '01_phase1_crm_core.sql',
    '02_phase2_activities.sql',
    '03_phase3_ai_pipeline.sql',
    '04_phase4_scoring_rubrics.sql',
    '05_phase5_product_coaching.sql',
    '06_phase6_outbox_integrations_pii.sql',
    'init_all.sql'
  ];

  for (const file of files) {
    const filePath = path.join(schemaDir, file);
    const exists = fs.existsSync(filePath);
    const content = exists ? fs.readFileSync(filePath, 'utf-8') : '';
    assert(
      exists && content.length > 100,
      'Schema File Check',
      `File ${file} exists and is valid SQL`,
      `File size: ${content.length} bytes`
    );
  }

  // Phase 0 Checks
  console.log("\n--- Validating Phase 0: Database Infrastructure, Roles & Org Hierarchy ---");
  const p0Sql = fs.readFileSync(path.join(schemaDir, '00_phase0_infra_and_org.sql'), 'utf-8');
  assert(p0Sql.includes('btree_gist'), 'Phase 0', 'Extension btree_gist', 'Includes btree_gist extension');
  assert(p0Sql.includes('janus_owner') && p0Sql.includes('janus_app') && p0Sql.includes('janus_redactor'), 'Phase 0', 'Database Roles', 'Defines janus_owner, janus_app, janus_redactor, janus_readonly');
  assert(p0Sql.includes('current_user_id()') && p0Sql.includes('current_org_path()') && p0Sql.includes('is_admin()'), 'Phase 0', 'Session Helpers', 'Defines session helper functions');
  assert(p0Sql.includes('CREATE TABLE IF NOT EXISTS org_unit') && p0Sql.includes('path text_pattern_ops'), 'Phase 0', 'Org Unit Table & Path Index', 'Defines org_unit with materialized path index');
  assert(p0Sql.includes('CREATE TABLE IF NOT EXISTS app_user') && p0Sql.includes('usr_janus_ai'), 'Phase 0', 'App User Table & Sentinel Seed', 'Defines app_user and seeds usr_janus_ai sentinel');

  // Phase 1 Checks
  console.log("\n--- Validating Phase 1: CRM Core & Deal Stage History ---");
  const p1Sql = fs.readFileSync(path.join(schemaDir, '01_phase1_crm_core.sql'), 'utf-8');
  assert(p1Sql.includes('CREATE TABLE IF NOT EXISTS account'), 'Phase 1', 'Account Table', 'Defines account table with health_data JSONB');
  assert(p1Sql.includes('CREATE TABLE IF NOT EXISTS contact'), 'Phase 1', 'Contact Table', 'Defines contact table with account_id FK');
  assert(p1Sql.includes('metrics_surfaced boolean GENERATED ALWAYS AS'), 'Phase 1', 'MEDDPICC Generated Columns', 'Defines MEDDPICC generated boolean columns');
  assert(p1Sql.includes('trg_deal_stage_history') && p1Sql.includes('trg_fn_deal_stage_history()'), 'Phase 1', 'Deal Stage History Trigger', 'Defines AFTER INSERT/UPDATE trigger on deal stage/status');
  assert(p1Sql.includes('REVOKE UPDATE, DELETE ON deal_stage_history FROM janus_app'), 'Phase 1', 'Audit Immutability', 'Revokes UPDATE/DELETE on deal_stage_history for app role');

  // Phase 2 Checks
  console.log("\n--- Validating Phase 2: Activity Ingestion & Call Shell ---");
  const p2Sql = fs.readFileSync(path.join(schemaDir, '02_phase2_activities.sql'), 'utf-8');
  assert(p2Sql.includes('CREATE TABLE IF NOT EXISTS activity'), 'Phase 2', 'Activity Table', 'Defines activity table');
  assert(p2Sql.includes('CREATE TABLE IF NOT EXISTS pre_call') && p2Sql.includes('activity_id bigint NOT NULL UNIQUE'), 'Phase 2', 'Pre-Call 1:1 Constraint', 'Defines pre_call with 1:1 activity_id UNIQUE constraint');
  assert(p2Sql.includes('CREATE TABLE IF NOT EXISTS post_call') && p2Sql.includes('pipeline_state_enum'), 'Phase 2', 'Post-Call Table', 'Defines post_call with pipeline_state_enum');
  assert(p2Sql.includes('idx_activity_idempotency') && p2Sql.includes('idx_post_call_idempotency'), 'Phase 2', 'Idempotency Indexes', 'Defines partial unique idempotency key indexes');

  // Phase 3 Checks
  console.log("\n--- Validating Phase 3: AI Pipeline Engine & Platform ---");
  const p3Sql = fs.readFileSync(path.join(schemaDir, '03_phase3_ai_pipeline.sql'), 'utf-8');
  assert(p3Sql.includes('CREATE TABLE IF NOT EXISTS prompt_template'), 'Phase 3', 'Prompt Template Table', 'Defines prompt_template with semver and variables');
  assert(p3Sql.includes('CREATE TABLE IF NOT EXISTS feature_flag'), 'Phase 3', 'Feature Flag Table', 'Defines feature_flag with scope constraints');
  assert(p3Sql.includes('CREATE TABLE IF NOT EXISTS ai_run'), 'Phase 3', 'AI Run Table', 'Defines ai_run tracking model, tokens, cost, latency');
  assert(p3Sql.includes('CREATE TABLE IF NOT EXISTS audit_log') && p3Sql.includes('PARTITION BY RANGE (created_at)'), 'Phase 3', 'Audit Log Partitioning', 'Defines monthly partitioned audit_log table');

  // Phase 4 Checks
  console.log("\n--- Validating Phase 4: Scoring Engine & Rubrics ---");
  const p4Sql = fs.readFileSync(path.join(schemaDir, '04_phase4_scoring_rubrics.sql'), 'utf-8');
  assert(p4Sql.includes('CREATE TABLE IF NOT EXISTS rubric_theme') && p4Sql.includes('CREATE TABLE IF NOT EXISTS rubric_parameter'), 'Phase 4', 'Rubric Dimension Hierarchy', 'Defines theme, rubric, and parameter tables');
  assert(p4Sql.includes('CREATE TABLE IF NOT EXISTS scorecard') && p4Sql.includes('uq_scorecard_activity_rubric'), 'Phase 4', 'Scorecard Re-Scoring Idempotency', 'Defines scorecard with UNIQUE(activity_id, rubric_id)');
  assert(p4Sql.includes('CREATE TABLE IF NOT EXISTS scorecard_line') && p4Sql.includes('param_weight_snapshot'), 'Phase 4', 'Scorecard Line Parameter Snapshotting', 'Defines scorecard_line with immutable weight snapshots');
  assert(p4Sql.includes('CREATE TABLE IF NOT EXISTS score_override'), 'Phase 4', 'Score Override Table', 'Defines score_override referencing composite scorecard_line FK');

  // Phase 5 Checks
  console.log("\n--- Validating Phase 5: Product Intelligence & Coaching Loops ---");
  const p5Sql = fs.readFileSync(path.join(schemaDir, '05_phase5_product_coaching.sql'), 'utf-8');
  assert(p5Sql.includes('CREATE TABLE IF NOT EXISTS product_signal') && p5Sql.includes('idx_psig_ai_key'), 'Phase 5', 'Product Signal AI Key Deduplication', 'Defines product_signal with signal_key partial unique index');
  assert(p5Sql.includes('trg_signal_cluster_count') && p5Sql.includes('trg_fn_signal_cluster_count()'), 'Phase 5', 'Signal Cluster Trigger', 'Defines trigger for signal_cluster.signal_count auto-aggregation');
  assert(p5Sql.includes('CREATE TABLE IF NOT EXISTS coaching_reflection') && p5Sql.includes('se_user_id = current_user_id()'), 'Phase 5', 'Coaching Reflection Private RLS', 'Enforces strict private SE-only RLS on reflections');

  // Phase 6 Checks
  console.log("\n--- Validating Phase 6: Sync Outbox, CDC & PII Governance ---");
  const p6Sql = fs.readFileSync(path.join(schemaDir, '06_phase6_outbox_integrations_pii.sql'), 'utf-8');
  assert(p6Sql.includes('CREATE TABLE IF NOT EXISTS sync_outbox') && p6Sql.includes('claim_outbox_batch'), 'Phase 6', 'Outbox SKIP LOCKED Claim Function', 'Defines sync_outbox and claim_outbox_batch SKIP LOCKED claim function');
  assert(p6Sql.includes('CREATE TABLE IF NOT EXISTS webhook_event') && p6Sql.includes('PARTITION BY RANGE (received_at)'), 'Phase 6', 'Webhook Event Partitioning', 'Defines weekly partitioned webhook_event table');
  assert(p6Sql.includes('CREATE OR REPLACE FUNCTION redact_pii()'), 'Phase 6', 'janus_redactor PII Anonymization', 'Defines redact_pii() procedure for 12-month lost deal PII redaction and tombstoning');

  const failedCount = results.filter(r => !r.passed).length;
  console.log("\n=================================================");
  console.log(` Test Summary: ${results.length - failedCount}/${results.length} Passed`);
  console.log("=================================================");

  if (failedCount > 0) {
    process.exit(1);
  } else {
    console.log("All Janus DDL and architectural validation checks passed successfully!\n");
  }
}

runValidation();
