/**
 * Janus grants smoke test — Blocker 1 gate.
 *
 * Verifies, connected as janus_app (DATABASE_URL):
 *   1. SELECT works on application tables
 *   2. INSERT/DELETE work on a mutable table (org_unit round-trip)
 *   3. Immutable tables reject UPDATE/DELETE (deal_stage_history, audit_log,
 *      score_override, contact_merge_log)
 *   4. Sequences are usable (identity insert path)
 *
 * Usage: DATABASE_URL=postgresql://janus_app:... node janus/tests/grants_smoke.test.mjs
 * Skips (exit 0) when DATABASE_URL is unset.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDevVars } from '../../worker/scripts/lib/load-dev-vars.mjs';
import { pgClientConfig } from '../../worker/scripts/lib/pg-client-config.mjs';

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../../worker/package.json'));
const pg = require('pg');

loadDevVars();

const { Client } = pg;
const results = [];

function check(name, ok, details = '') {
  results.push({ name, ok });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${details ? ` — ${details}` : ''}`);
}

async function expectSqlError(client, sql, code, label) {
  try {
    await client.query(sql);
    check(label, false, 'expected error, statement succeeded');
  } catch (err) {
    check(label, err.code === code, `code=${err.code}`);
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL unset — skipping grants smoke test.');
    return;
  }
  const client = new Client(pgClientConfig(process.env.DATABASE_URL));
  await client.connect();
  try {
    const who = await client.query('SELECT current_user AS u');
    check('connected as janus_app', who.rows[0].u === 'janus_app', `current_user=${who.rows[0].u}`);

    for (const t of ['account', 'contact', 'deal', 'activity', 'pre_call', 'post_call', 'task', 'scorecard']) {
      const r = await client.query(`SELECT count(*)::int AS n FROM ${t}`);
      check(`SELECT ${t}`, typeof r.rows[0].n === 'number', `${r.rows[0].n} rows visible`);
    }

    // Mutable round-trip on org_unit (no RLS on org_unit; janus_app has DML).
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO org_unit (id, name, unit_type, path) VALUES ('__grants_smoke__', 'grants smoke', 'squad', '/__grants_smoke__/')`
      );
      const got = await client.query(`SELECT name FROM org_unit WHERE id = '__grants_smoke__'`);
      check('INSERT org_unit', got.rows.length === 1);
      await client.query(`DELETE FROM org_unit WHERE id = '__grants_smoke__'`);
      check('DELETE org_unit', true);
    } finally {
      await client.query('ROLLBACK');
    }

    // Identity sequence path: app_user insert must draw from identity sequence.
    await client.query('BEGIN');
    try {
      const ins = await client.query(
        `INSERT INTO app_user (public_id, email, org_unit_id) VALUES ('__grants_smoke_user__', 'smoke@example.com', NULL) RETURNING id`
      );
      check('INSERT app_user (identity sequence)', typeof ins.rows[0].id === 'string' || typeof ins.rows[0].id === 'number');
    } finally {
      await client.query('ROLLBACK');
    }

    // Immutable tables: janus_app must NOT be able to UPDATE/DELETE.
    await expectSqlError(client, `UPDATE deal_stage_history SET changed_by = NULL`, '42501', 'REVOKE holds: deal_stage_history UPDATE');
    await expectSqlError(client, `DELETE FROM deal_stage_history`, '42501', 'REVOKE holds: deal_stage_history DELETE');
    await expectSqlError(client, `UPDATE audit_log SET payload = '{}'::jsonb`, '42501', 'REVOKE holds: audit_log UPDATE');
    await expectSqlError(client, `DELETE FROM audit_log`, '42501', 'REVOKE holds: audit_log DELETE');
    await expectSqlError(client, `UPDATE score_override SET reason = 'x'`, '42501', 'REVOKE holds: score_override UPDATE');
    await expectSqlError(client, `UPDATE contact_merge_log SET merged_at = now()`, '42501', 'REVOKE holds: contact_merge_log UPDATE');
  } finally {
    await client.end();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('grants smoke test error:', err.message);
  process.exit(1);
});
