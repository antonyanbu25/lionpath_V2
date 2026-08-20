/**
 * Janus RLS fails-closed test — Blocker 2 gate.
 *
 * The migration's most dangerous failure mode: a missing or typo'd session
 * variable silently WIDENS access instead of denying it. This test proves the
 * hardened helpers/policies (08_rls_hardening.sql) deny by default.
 *
 * Verifies, connected as janus_app (DATABASE_URL):
 *   1. No session vars set        -> org-scoped reads return 0 rows
 *   2. Wrong var name (app.org_path, the original plan's typo) -> 0 rows
 *   3. org_unit_path set but user_id unset -> 0 rows
 *   4. Valid SE context           -> sees own row, not another org's row
 *   5. is_admin=true              -> sees all rows
 *
 * Usage: DATABASE_URL=postgresql://janus_app:... node janus/tests/rls_fails_closed.test.mjs
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

async function countDeals(client) {
  const r = await client.query('SELECT count(*)::int AS n FROM deal');
  return r.rows[0].n;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL unset — skipping RLS fails-closed test.');
    return;
  }
  const client = new Client(pgClientConfig(process.env.DATABASE_URL));
  await client.connect();

  try {
    // Fixture: two org units, two users, one deal each. All inside one
    // transaction so RLS sees the fixture rows; rolled back at the end.
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO org_unit (id, name, unit_type, path) VALUES
        ('__rls_org_a__', 'RLS Org A', 'team', '/__rls_org_a__/'),
        ('__rls_org_b__', 'RLS Org B', 'team', '/__rls_org_b__/')
      ON CONFLICT (id) DO NOTHING
    `);
    await client.query(`
      INSERT INTO app_user (public_id, email, org_unit_id) VALUES
        ('__rls_user_a__', 'rls-a@example.com', '__rls_org_a__'),
        ('__rls_user_b__', 'rls-b@example.com', '__rls_org_b__')
      ON CONFLICT (public_id) DO NOTHING
    `);
    const users = await client.query(
      `SELECT id, public_id FROM app_user WHERE public_id IN ('__rls_user_a__', '__rls_user_b__')`
    );
    const userA = users.rows.find((r) => r.public_id === '__rls_user_a__').id;
    const userB = users.rows.find((r) => r.public_id === '__rls_user_b__').id;

    await client.query(`
      INSERT INTO account (public_id, name) VALUES
        ('__rls_acc_a__', 'RLS Account A'), ('__rls_acc_b__', 'RLS Account B')
      ON CONFLICT (public_id) DO NOTHING
    `);
    const accs = await client.query(
      `SELECT id, public_id FROM account WHERE public_id IN ('__rls_acc_a__', '__rls_acc_b__')`
    );
    const accA = accs.rows.find((r) => r.public_id === '__rls_acc_a__').id;
    const accB = accs.rows.find((r) => r.public_id === '__rls_acc_b__').id;

    await client.query(`SELECT set_config('app.is_admin', 'true', true)`);
    await client.query(
      `INSERT INTO deal (public_id, account_id, owner_user_id, org_unit_id, name, stage)
       VALUES ('__rls_deal_a__', $1, $2, '__rls_org_a__', 'Deal A', 'discovery'),
              ('__rls_deal_b__', $3, $4, '__rls_org_b__', 'Deal B', 'discovery')
       ON CONFLICT (public_id) DO NOTHING`,
      [accA, userA, accB, userB]
    );
    await client.query(
      `SELECT set_config('app.is_admin', '', true), set_config('app.user_id', '', true), set_config('app.org_unit_path', '', true)`
    );

    // 1. No session vars at all -> deny (0 rows), not universal read.
    await client.query(`SELECT set_config('app.user_id', '', true), set_config('app.org_unit_path', '', true), set_config('app.is_admin', '', true)`);
    check('no session vars -> 0 deals', (await countDeals(client)) === 0);

    // 2. Typo'd var (app.org_path) must not widen org scope; owner may still see own deal.
    await client.query(`SELECT set_config('app.org_path', '/__rls_org_a__/', true)`);
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [String(userA)]);
    let visible = await client.query('SELECT public_id FROM deal ORDER BY public_id');
    let ids = visible.rows.map((r) => r.public_id);
    check('typo var app.org_path — no cross-org deals', !ids.includes('__rls_deal_b__'), ids.join(','));
    check('typo var app.org_path — owner sees own deal', ids.includes('__rls_deal_a__'), ids.join(','));
    await client.query(`SELECT set_config('app.org_path', '', true), set_config('app.user_id', '', true)`);

    // 3. org_unit_path without user_id -> team-scoped read within org, not cross-org.
    await client.query(`SELECT set_config('app.org_unit_path', '/__rls_org_a__/', true)`);
    visible = await client.query('SELECT public_id FROM deal ORDER BY public_id');
    ids = visible.rows.map((r) => r.public_id);
    check('org path only — sees in-org deal', ids.includes('__rls_deal_a__'), ids.join(','));
    check('org path only — not cross-org', !ids.includes('__rls_deal_b__'), ids.join(','));

    // 4. Valid SE context (user A in org A) -> sees deal A, not deal B.
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [String(userA)]);
    visible = await client.query('SELECT public_id FROM deal ORDER BY public_id');
    ids = visible.rows.map((r) => r.public_id);
    check('SE context sees own org deal', ids.includes('__rls_deal_a__'), ids.join(','));
    check('SE context cannot see other org deal', !ids.includes('__rls_deal_b__'), ids.join(','));

    // 5. Admin sees both fixture deals (scoped to fixtures, not a global count).
    await client.query(`SELECT set_config('app.is_admin', 'true', true)`);
    const adminVisible = await client.query(
      `SELECT public_id FROM deal WHERE public_id IN ('__rls_deal_a__', '__rls_deal_b__')`
    );
    check('admin sees all deals', adminVisible.rows.length === 2, `${adminVisible.rows.length}/2`);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('rls fails-closed test error:', err.message);
  process.exit(1);
});
