#!/usr/bin/env node
/**
 * View RLS test (QA #2): read-model views must enforce base-table RLS for the
 * querying role (security_invoker), not run as the view owner.
 *
 * Asserts: a non-admin janus_app session scoped to org path /org_2/ sees zero
 * rows from v_deal_traction for deals in /org_1/, and exactly its own org's
 * deals otherwise.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDevVars } from "../../worker/scripts/lib/load-dev-vars.mjs";
import { pgClientConfig } from "../../worker/scripts/lib/pg-client-config.mjs";

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../../worker/package.json"));
const pg = require("pg");

loadDevVars();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL required");
  process.exit(1);
}

const client = new pg.Client(pgClientConfig(url));
await client.connect();

let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
};

try {
  await client.query("BEGIN");
  // Fixture org units + deal, created as admin so RLS doesn't block inserts.
  await client.query("SELECT set_config('app.is_admin', 'true', true)");
  await client.query(
    `INSERT INTO org_unit (id, name, unit_type, path) VALUES
       ('qa_view_org1', 'QA View Org 1', 'team', '/qa_view_org1/'),
       ('qa_view_org2', 'QA View Org 2', 'team', '/qa_view_org2/')
     ON CONFLICT (id) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO app_user (public_id, email, display_name, org_unit_id, status)
     VALUES ('qa_view_u1', 'qa-view@example.com', 'QA View', 'qa_view_org1', 'active')
     ON CONFLICT (public_id) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO account (public_id, name) VALUES ('qa_view_acc', 'QA View Account')
     ON CONFLICT (public_id) DO NOTHING`,
  );
  const acc = await client.query(`SELECT id FROM account WHERE public_id = 'qa_view_acc'`);
  const usr = await client.query(`SELECT id FROM app_user WHERE public_id = 'qa_view_u1'`);
  await client.query(
    `INSERT INTO deal (public_id, account_id, owner_user_id, org_unit_id, name, stage, status)
     VALUES ('qa_view_deal', $1, $2, 'qa_view_org1', 'QA View Deal', 'discovery', 'active')
     ON CONFLICT (public_id) DO NOTHING`,
    [acc.rows[0].id, usr.rows[0].id],
  );

  // Non-admin session scoped to org2: must NOT see org1's deal via the view.
  await client.query("SELECT set_config('app.is_admin', 'false', true)");
  await client.query("SELECT set_config('app.org_unit_path', '/qa_view_org2/', true)");
  const cross = await client.query(
    `SELECT count(*)::int AS n FROM v_deal_traction WHERE deal_public_id = 'qa_view_deal'`,
  );
  check("org2 session sees 0 rows for org1 deal in v_deal_traction", cross.rows[0].n === 0);

  // v_org_metrics is anchored on org_unit (no RLS) — the org row is visible,
  // but its deal/activity aggregates must be RLS-filtered to zero.
  const orgAgg = await client.query(
    `SELECT active_deals FROM v_org_metrics WHERE name = 'QA View Org 1'`,
  );
  check(
    "org2 session sees 0 active_deals for org1 in v_org_metrics",
    orgAgg.rows.length === 1 && Number(orgAgg.rows[0].active_deals) === 0,
  );

  // Scoped to org1: sees its own deal.
  await client.query("SELECT set_config('app.org_unit_path', '/qa_view_org1/', true)");
  const own = await client.query(
    `SELECT count(*)::int AS n FROM v_deal_traction WHERE deal_public_id = 'qa_view_deal'`,
  );
  check("org1 session sees its own deal in v_deal_traction", own.rows[0].n === 1);

  // Admin sees everything.
  await client.query("SELECT set_config('app.is_admin', 'true', true)");
  const admin = await client.query(
    `SELECT count(*)::int AS n FROM v_deal_traction WHERE deal_public_id = 'qa_view_deal'`,
  );
  check("admin sees the deal in v_deal_traction", admin.rows[0].n === 1);
} finally {
  await client.query("ROLLBACK");
  await client.end();
}

process.exit(failures ? 1 : 0);
