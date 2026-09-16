/**
 * Shared harness for the AT-1..AT-5 acceptance tests.
 *
 * Two rules the tests exist to enforce, so they are enforced here:
 *
 *   1. Every assertion runs as janus_app under RLS, never as a superuser.
 *      A superuser bypasses every policy, so a suite that runs as postgres
 *      proves nothing about what an SE can actually see.
 *   2. Session variables are set with set_config(..., is_local => true)
 *      inside a transaction, exactly as worker/src/data/persistence/
 *      session-context.ts does. 17_rls_role_defaults.sql sets fail-closed
 *      role defaults, so a connection that forgets this sees nothing --
 *      which is the correct behaviour and is itself asserted.
 *
 * Fixtures are created under a per-run prefix so the suite is re-runnable and
 * two runs cannot collide. Teardown removes everything with that prefix.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import { loadDevVars, WORKER_ROOT } from "../../../../worker/scripts/lib/load-dev-vars.mjs";
import { pgClientConfig } from "../../../../worker/scripts/lib/pg-client-config.mjs";

const require = createRequire(join(WORKER_ROOT, "package.json"));
const pg = require("pg");

loadDevVars();

export const APP_URL = process.env.DATABASE_URL || "";
export const MIG_URL = process.env.DATABASE_URL_MIGRATIONS || "";

/** Unique per run, so fixtures never collide and teardown is exact. */
export const RUN = `at${Date.now().toString(36)}`;

// ---------------------------------------------------------------------------
// Result collection
// ---------------------------------------------------------------------------
const results = [];

export function check(name, ok, details = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name}${details ? ` — ${details}` : ""}`);
  return !!ok;
}

export function checkEq(name, actual, expected, details = "") {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  return check(name, ok, ok ? details : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Assert a statement is rejected by the database, and by the right rule. */
export async function expectReject(client, label, sql, params = [], expectCode = null) {
  try {
    await client.query(sql, params);
    return check(label, false, "expected rejection, statement succeeded");
  } catch (err) {
    if (expectCode && err.code !== expectCode) {
      return check(label, false, `rejected with ${err.code}, expected ${expectCode}: ${err.message.split("\n")[0]}`);
    }
    return check(label, true, `${err.code} ${(err.constraint || "").slice(0, 40)}`);
  }
}

/**
 * An assertion the DATA MODEL cannot make on its own -- it needs application
 * code. Reported separately and never counted as a failure, because a schema
 * test that fails on missing application code is just noise. Listing them is
 * the point: these are the guards the write path still owes.
 */
const pendings = [];
export function pending(name, why) {
  pendings.push({ name, why });
  console.log(`[APP ] ${name} — needs application code: ${why}`);
}

export function summary(title) {
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${title}: ${results.length - failed.length}/${results.length} passed` +
      (pendings.length ? `, ${pendings.length} awaiting application code` : "") +
      (failed.length ? `\n  failing: ${failed.map((f) => f.name).join(", ")}` : ""),
  );
  return failed.length === 0;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/** janus_app — the only role assertions run as. */
export async function appClient() {
  const c = new pg.Client(pgClientConfig(APP_URL));
  await c.connect();
  return c;
}

/**
 * Migration role — fixture setup and teardown ONLY.
 *
 * Provisioning org units, users and role grants is what the identity
 * workstream will do at cutover, and it is not the thing under test. Every
 * assertion still runs on an appClient().
 */
export async function migClient() {
  const c = new pg.Client(pgClientConfig(MIG_URL));
  await c.connect();
  // The migration role does NOT bypass RLS here. Every table is declared
  // FORCE ROW LEVEL SECURITY, which subjects the table OWNER to its policies
  // too, and Cloud SQL's `postgres` is cloudsqlsuperuser with rolsuper=false
  // and rolbypassrls=false -- so it is not exempt either.
  //
  // Fixture setup legitimately writes rows for other people, so this client
  // runs as admin. Session-scoped (is_local => false) so it survives across
  // the fixture statements, which are not wrapped in one transaction.
  // Assertions never use this client -- they run on appClient() under RLS.
  await c.query(`SELECT set_config('app.is_admin', 'true', false)`);
  return c;
}

/**
 * Run fn inside a transaction with a user's session context, then roll back
 * or commit. Mirrors withSessionContext() in session-context.ts.
 */
export async function asUser(client, user, fn, { commit = true } = {}) {
  await client.query("BEGIN");
  try {
    await client.query(
      `SELECT set_config('app.user_id', $1, true),
              set_config('app.org_unit_path', $2, true),
              set_config('app.is_admin', $3, true),
              set_config('app.email', $4, true)`,
      [String(user.id), user.orgPath, user.isAdmin ? "true" : "false", user.email],
    );
    const out = await fn(client);
    await client.query(commit ? "COMMIT" : "ROLLBACK");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

/** Like asUser, but expects fn to throw — and returns the error. */
export async function asUserExpectingError(client, user, fn) {
  try {
    await asUser(client, user, fn);
    return null;
  } catch (err) {
    return err;
  }
}

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

export function requireEnv() {
  if (!APP_URL || !MIG_URL) {
    console.log(
      "DATABASE_URL and DATABASE_URL_MIGRATIONS must both be set " +
        "(assertions run as janus_app; fixtures need the migration role). Skipping.",
    );
    return false;
  }
  if (!/janus_app/i.test(APP_URL)) {
    console.error(
      "DATABASE_URL does not look like the janus_app role. These tests are " +
        "meaningless as a superuser — RLS is bypassed. Refusing to run.",
    );
    process.exit(1);
  }
  return true;
}

/**
 * The rubric catalog must be loaded. Tests do not create profiles: the
 * catalog is loader-owned (D17) and a suite that mints its own rubrics would
 * not be testing the real ones.
 */
export async function requireRubricCatalog(client) {
  const r = await client.query(
    `SELECT call_type, se_motion, version, total_credits, provisional
       FROM rubric
      WHERE version = '2.1' AND call_type IN ('discovery', 'demo')
      ORDER BY call_type, se_motion`,
  );
  const need = ["discovery/new_business", "discovery/expansion"];
  const have = r.rows.map((x) => `${x.call_type}/${x.se_motion}`);
  const missing = need.filter((n) => !have.includes(n));
  if (missing.length) {
    console.error(
      `Rubric catalog is not loaded (missing ${missing.join(", ")}).\n` +
        `scorecard.rubric_id is a NOT NULL foreign key, so no score can be saved ` +
        `until the catalog exists. Run:\n\n` +
        `  node janus/scripts/load-rubric-catalog.mjs\n`,
    );
    process.exit(1);
  }
  return Object.fromEntries(r.rows.map((x) => [`${x.call_type}/${x.se_motion}`, x]));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The org tree from D4, with the vocabulary trap respected: level 2 is the
 * SEGMENT and level 3 is the TEAM. Modelling these with the business
 * vocabulary would invert every parent_id and therefore every path -- and
 * since all row-level security is a path prefix match, a segment leader would
 * silently see the wrong people.
 *
 *   org_freshworks_se
 *     +-- seg_new_business (default_se_motion = new_business)
 *     |     +-- team_a
 *     +-- seg_nurture      (default_se_motion = expansion)
 *           +-- team_b
 */
export async function provisionOrg(mig) {
  const org = `${RUN}_org`;
  const segNb = `${RUN}_seg_nb`;
  const segNur = `${RUN}_seg_nurture`;
  const teamA = `${RUN}_team_a`;
  const teamB = `${RUN}_team_b`;

  const units = [
    [org, "AT Solution Engineering", null, "org", `/${org}/`, null],
    [segNb, "AT New Business", org, "region", `/${org}/${segNb}/`, "new_business"],
    [segNur, "AT Nurture", org, "region", `/${org}/${segNur}/`, "expansion"],
    [teamA, "AT Team A", segNb, "team", `/${org}/${segNb}/${teamA}/`, null],
    [teamB, "AT Team B", segNur, "team", `/${org}/${segNur}/${teamB}/`, null],
  ];

  for (const [id, name, parent, type, path, motion] of units) {
    await mig.query(
      `INSERT INTO org_unit (id, name, parent_id, unit_type, path, default_se_motion)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET path = EXCLUDED.path,
                                      default_se_motion = EXCLUDED.default_se_motion`,
      [id, name, parent, type, path, motion],
    );
  }

  return { org, segNb, segNur, teamA, teamB, paths: Object.fromEntries(units.map((u) => [u[0], u[4]])) };
}

/** One user, with a current permission role grant. */
export async function provisionUser(mig, { slug, orgUnitId, orgPath, role = "se", jobTitle = "Solution Engineer" }) {
  const publicId = `${RUN}_usr_${slug}`;
  const email = `${publicId}@example.test`;

  const r = await mig.query(
    `INSERT INTO app_user (public_id, email, display_name, job_title, job_level,
                           org_unit_id, status, sync_state)
     VALUES ($1, $2, $3, $4, derive_job_level($4, $5), $6, 'active', 'synced')
     ON CONFLICT (public_id) DO UPDATE SET org_unit_id = EXCLUDED.org_unit_id
     RETURNING id`,
    [publicId, email, `AT ${slug}`, jobTitle, role, orgUnitId],
  );
  const id = Number(r.rows[0].id);

  // A role change is close-then-insert, never an overlapping second grant:
  // user_role carries a GIST exclusion constraint (identity pass section 4).
  await mig.query(
    `UPDATE user_role SET valid_to = now()
      WHERE user_id = $1 AND valid_to IS NULL`,
    [id],
  );
  await mig.query(
    `INSERT INTO user_role (user_id, role_id, valid_from)
     SELECT $1, id, now() FROM app_role WHERE name = $2`,
    [id, role],
  );

  return { id, publicId, email, orgUnitId, orgPath, role, isAdmin: role === "admin" };
}

export async function provisionAccount(mig, { slug, seUserIds = [] }) {
  const publicId = `${RUN}_acc_${slug}`;
  const r = await mig.query(
    `INSERT INTO account (public_id, name, slug, program_phase, sync_state)
     VALUES ($1, $2, $3, 'new_business', 'synced')
     ON CONFLICT (public_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [publicId, `AT Account ${slug}`, publicId],
  );
  const id = Number(r.rows[0].id);

  for (const [i, seUserId] of seUserIds.entries()) {
    await mig.query(
      `INSERT INTO account_se_team (account_id, se_user_id, role)
       VALUES ($1, $2, $3) ON CONFLICT (account_id, se_user_id) DO NOTHING`,
      [id, seUserId, i === 0 ? "primary" : "secondary"],
    );
  }
  return { id, publicId };
}

export async function provisionDeal(mig, { slug, accountId, ownerUserId, orgUnitId }) {
  const publicId = `${RUN}_deal_${slug}`;
  const r = await mig.query(
    `INSERT INTO deal (public_id, account_id, owner_user_id, org_unit_id, name,
                       stage, status, sync_state)
     VALUES ($1, $2, $3, $4, $5, 'discovery', 'active', 'synced')
     ON CONFLICT (public_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [publicId, accountId, ownerUserId, orgUnitId, `AT Deal ${slug}`],
  );
  return { id: Number(r.rows[0].id), publicId };
}

/**
 * An activity, written as the owning user so the owner-write policy is
 * actually exercised rather than bypassed.
 */
export async function insertActivity(client, { slug, dealId, accountId, ownerUserId, orgUnitId, type = "meeting", occurredAt = null }) {
  const publicId = `${RUN}_act_${slug}`;
  const r = await client.query(
    `INSERT INTO activity (public_id, idempotency_key, deal_id, account_id,
                           owner_user_id, org_unit_id, activity_type, subject,
                           occurred_at, sync_state)
     VALUES ($1, $1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()), 'synced')
     RETURNING id`,
    [publicId, dealId, accountId, ownerUserId, orgUnitId, type, `AT ${slug}`, occurredAt],
  );
  return { id: Number(r.rows[0].id), publicId };
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

/**
 * Remove this run's fixtures. Ordered by dependency because most FKs are
 * RESTRICT -- which is the schema behaving correctly, not an obstacle.
 */
export async function teardown(mig, run = RUN) {
  const like = `${run}\\_%`;
  const steps = [
    `DELETE FROM score_override WHERE scorecard_line_id IN (
        SELECT l.id FROM scorecard_line l JOIN scorecard s ON s.id = l.scorecard_id
         WHERE s.public_id LIKE '${like}')`,
    `DELETE FROM scorecard WHERE public_id LIKE '${like}'`,
    `DELETE FROM task WHERE public_id LIKE '${like}'`,
    `DELETE FROM call_participant WHERE activity_id IN (
        SELECT id FROM activity WHERE public_id LIKE '${like}')`,
    `DELETE FROM pre_call WHERE public_id LIKE '${like}'`,
    `DELETE FROM post_call WHERE public_id LIKE '${like}'`,
    `DELETE FROM activity WHERE public_id LIKE '${like}'`,
    `DELETE FROM deal WHERE public_id LIKE '${like}'`,
    `DELETE FROM account_se_team WHERE account_id IN (
        SELECT id FROM account WHERE public_id LIKE '${like}')`,
    `DELETE FROM account WHERE public_id LIKE '${like}'`,
    `DELETE FROM audit_log WHERE user_id IN (
        SELECT id FROM app_user WHERE public_id LIKE '${like}')`,
    `DELETE FROM user_role WHERE user_id IN (
        SELECT id FROM app_user WHERE public_id LIKE '${like}')`,
    `DELETE FROM org_unit_leader WHERE org_unit_id LIKE '${like}'`,
    `DELETE FROM app_user WHERE public_id LIKE '${like}'`,
    `DELETE FROM id_registry WHERE public_id LIKE '${like}'`,
    `DELETE FROM org_unit WHERE id LIKE '${like}' AND unit_type = 'team'`,
    `DELETE FROM org_unit WHERE id LIKE '${like}' AND unit_type = 'region'`,
    `DELETE FROM org_unit WHERE id LIKE '${like}' AND unit_type = 'org'`,
  ];
  for (const sql of steps) {
    try {
      await mig.query(sql);
    } catch (err) {
      console.error(`teardown step failed (continuing): ${err.message.split("\n")[0]}`);
    }
  }
}
