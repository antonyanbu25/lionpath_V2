#!/usr/bin/env tsx
/**
 * Roadmap 1.6 gate: an unmapped deal status must not poison the transaction.
 *
 * §04 hunt 10 recorded that `deal.status` is written `"archived"` and
 * `"closed_won_grace"`, neither of which `deal_status_enum` accepts, and called
 * it "a live 500 generator". Measured, it is worse than a 500 for that one
 * write:
 *
 *     SELECT 'archived'::deal_status_enum
 *       -> 22P02 invalid input value for enum deal_status_enum: "archived"
 *     -- the NEXT statement, entirely unrelated:
 *       -> 25P02 current transaction is aborted, commands ignored until end of
 *                transaction block
 *
 * So one bad status takes down every other write batched into the same
 * transaction, and the caller cannot recover by catching it — the connection
 * is unusable until rollback. That is the defect this gate pins.
 *
 * The two vocabularies are different, and only `active` appears in both:
 *
 *     SQL      active | nurture | won      | lost
 *     client   active | paused  | archived | closed_won_grace
 *
 * They describe the same lifecycle differently rather than disagreeing — SQL
 * stores `won` plus `closed_won_at` and derives the 90-day grace window from
 * that timestamp (32_deal_closed_won.sql), while Firestore stores
 * `closed_won_grace` and sweeps it to `archived`. The translation is OWED and
 * is deliberately NOT guessed at: `redact_pii()` irreversibly NULLs
 * post_call.analysis/.detail for `status='lost'` deals older than 12 months, so
 * mis-mapping anything to `lost` would eventually destroy call analysis.
 *
 * Asserts:
 *   1. Every deal_status_enum value in the DATABASE is in DEAL_STATUS_VALUES
 *      and vice versa — a drift guard, so an ALTER TYPE forces a code change.
 *   2. Each valid status round-trips through upsertDeal.
 *   3. Each client-vocabulary status is refused with status 422.
 *   4. The refusal leaves the transaction USABLE — a sibling write in the same
 *      transaction still commits. This is the assertion that fails before the
 *      fix, with 25P02.
 *   5. patchDeal refuses it too, not just upsertDeal.
 *
 * DISPOSABLE LOCAL DATABASES ONLY. Refuses a non-loopback host unless
 * --allow-remote. Fails loudly without a database rather than skipping green.
 */
import assert from "node:assert/strict";
import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";
import { PostgresRepository } from "../src/data/persistence/postgres-repository.ts";
import { DEAL_STATUS_VALUES, assertDealStatus } from "../src/data/persistence/types.ts";
import { closePool, getPool } from "../src/data/persistence/postgres-pool.ts";

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
  fail(`refusing to write deal rows against non-loopback host "${host}". Pass --allow-remote only if it is disposable.`);
}

const RUN = `JANUS_AUDIT_TEST_ds_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const ORG = `${RUN}_org`;
const USER = `${RUN}_u`;
const ACCOUNT = `${RUN}_acc`;

/** The client vocabulary that deal_status_enum cannot hold. */
const CLIENT_ONLY_STATUSES = ["paused", "archived", "closed_won_grace"];

const { default: pgMod } = await import("pg");
const admin = new pgMod.Client(pgClientConfig(MIG_URL));
await admin.connect();

const repo = new PostgresRepository();
const pool = await getPool({ DATABASE_URL: APP_URL } as never);

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

/**
 * Resolved once the fixture user exists. app.user_id must be a REAL app_user
 * id, not 0: trg_fn_deal_stage_history writes deal_stage_history.changed_by =
 * current_user_id(), and that column has an FK to app_user, so a sentinel of 0
 * fails the insert inside the trigger rather than anywhere obvious.
 */
let fixtureUserId = "0";

/** Run fn on its own client inside a real transaction with a session context. */
async function inTransaction<T>(fn: (c: never) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.user_id', $2, true),
              set_config('app.org_unit_path', $1, true),
              set_config('app.is_admin', 'true', true)`,
      [ORG, fixtureUserId],
    );
    const out = await fn(client as never);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * chk_deal_stage_status (01_phase1_crm_core.sql:125) ties stage to status:
 *   closed_won  <-> won
 *   closed_lost <-> lost
 *   anything else <-> active | nurture
 *
 * So a fixture cannot use one stage for every status. Worth noting beyond the
 * fixture: this constraint is more evidence that the client statuses have no
 * SQL home — there is no stage for `paused`, `archived` or `closed_won_grace`
 * either, so the translation owed is over BOTH columns, not just status.
 */
const STAGE_FOR_STATUS: Record<string, string> = {
  active: "discovery",
  nurture: "discovery",
  won: "closed_won",
  lost: "closed_lost",
};

const dealRow = (publicId: string, status?: string) => ({
  publicId,
  accountPublicId: ACCOUNT,
  ownerPublicId: USER,
  orgUnitId: ORG,
  name: "Deal status gate",
  stage: STAGE_FOR_STATUS[status ?? "active"] ?? "discovery",
  status,
});

try {
  console.log(`Roadmap 1.6 deal-status gate — run ${RUN}\n`);

  await admin.query(
    `INSERT INTO org_unit (id, name, unit_type, path) VALUES ($1, 'DS Gate Org', 'team', $1)
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );
  await admin.query(
    `INSERT INTO app_user (public_id, email, org_unit_id) VALUES ($1, $2, $3)
     ON CONFLICT (public_id) DO NOTHING`,
    [USER, `${USER}@example.invalid`, ORG],
  );
  await admin.query(
    `INSERT INTO account (public_id, name) VALUES ($1, 'DS Gate Account')
     ON CONFLICT (public_id) DO NOTHING`,
    [ACCOUNT],
  );
  await admin.query(
    `INSERT INTO app_user (public_id, email) VALUES ('usr_janus_ai', 'janus-ai@example.invalid')
     ON CONFLICT (public_id) DO NOTHING`,
  );
  fixtureUserId = String(
    (await admin.query<{ id: string }>(`SELECT id FROM app_user WHERE public_id = $1`, [USER]))
      .rows[0].id,
  );

  // upsertDeal resolves its parents through id_registry, so seeding the tables
  // directly is not enough — an unregistered parent fails with 409
  // "no mapping for account/... — migrate the parent first" before status is
  // ever evaluated, which would mask what this gate is measuring.
  await admin.query(
    `INSERT INTO id_registry (entity_type, public_id, internal_id)
     SELECT 'account', $1, a.id FROM account a WHERE a.public_id = $1
     ON CONFLICT DO NOTHING`,
    [ACCOUNT],
  );
  await admin.query(
    `INSERT INTO id_registry (entity_type, public_id, internal_id)
     SELECT 'app_user', $1, u.id FROM app_user u WHERE u.public_id = $1
     ON CONFLICT DO NOTHING`,
    [USER],
  );

  // --- 1: the constant and the database enum must agree --------------------
  const dbEnum = await admin.query<{ v: string[] }>(
    `SELECT enum_range(NULL::deal_status_enum)::text[] AS v`,
  );
  const dbValues = [...(dbEnum.rows[0].v ?? [])].sort();
  const codeValues = [...DEAL_STATUS_VALUES].sort();
  check("DEAL_STATUS_VALUES matches deal_status_enum in the database", () =>
    assert.deepEqual(
      codeValues,
      dbValues,
      `code has [${codeValues.join(", ")}], database has [${dbValues.join(", ")}] — ` +
        `an ALTER TYPE must update DEAL_STATUS_VALUES in the same commit`,
    ));

  // --- 2: every valid status round-trips -----------------------------------
  for (const status of DEAL_STATUS_VALUES) {
    const pid = `${RUN}_ok_${status}`;
    let stored: string | undefined;
    try {
      await inTransaction((c) => repo.upsertDeal(c, dealRow(pid, status)));
      stored = (await admin.query<{ status: string }>(
        `SELECT status FROM deal WHERE public_id = $1`, [pid],
      )).rows[0]?.status;
    } catch (err) {
      stored = `THREW: ${err instanceof Error ? err.message : String(err)}`;
    }
    check(`status "${status}" round-trips through upsertDeal`, () =>
      assert.equal(stored, status));
  }

  // --- 3..4: a client-vocabulary status is refused, and the TRANSACTION SURVIVES
  for (const status of CLIENT_ONLY_STATUSES) {
    const bad = `${RUN}_bad_${status}`;
    const sibling = `${RUN}_sib_${status}`;

    // Pure-function check first: refused, with a 422 and a message naming the value.
    let thrownStatus: number | undefined;
    let message = "";
    try {
      assertDealStatus(status);
    } catch (err) {
      thrownStatus = (err as { status?: number }).status;
      message = err instanceof Error ? err.message : String(err);
    }
    check(`client status "${status}" is refused with 422`, () => {
      assert.equal(thrownStatus, 422, `threw status ${thrownStatus}`);
      assert.ok(message.includes(status), `message does not name the offending value: ${message}`);
    });

    // The real point: after the refusal, a sibling write in the SAME
    // transaction must still commit. Before the fix PostgreSQL raised 22P02
    // and every later statement failed 25P02, so the sibling was lost too.
    let siblingCommitted = false;
    let siblingError = "";
    try {
      await inTransaction(async (c) => {
        try {
          await repo.upsertDeal(c, dealRow(bad, status));
        } catch {
          // Expected. The question is whether the transaction is still usable.
        }
        await repo.upsertDeal(c, dealRow(sibling, "active"));
      });
      siblingCommitted = (await admin.query<{ n: number }>(
        `SELECT count(*)::int n FROM deal WHERE public_id = $1`, [sibling],
      )).rows[0].n === 1;
    } catch (err) {
      siblingError = err instanceof Error ? err.message : String(err);
    }
    check(`"${status}" does not poison the transaction — a sibling write still commits`, () => {
      assert.ok(
        siblingCommitted,
        siblingError
          ? `the transaction was aborted: ${siblingError.slice(0, 140)}`
          : "the sibling deal was not committed",
      );
    });
    const badRows = (await admin.query<{ n: number }>(
      `SELECT count(*)::int n FROM deal WHERE public_id = $1`, [bad],
    )).rows[0].n;
    check(`"${status}" did not land a deal row`, () => assert.equal(badRows, 0));
  }

  // --- 5: patchDeal refuses it too -----------------------------------------
  {
    const pid = `${RUN}_patch`;
    await inTransaction((c) => repo.upsertDeal(c, dealRow(pid, "active")));
    let patchStatus: number | undefined;
    try {
      await inTransaction((c) => repo.patchDeal(c, pid, { status: "archived" }));
    } catch (err) {
      patchStatus = (err as { status?: number }).status;
    }
    check("patchDeal refuses a client-vocabulary status with 422", () =>
      assert.equal(patchStatus, 422, `threw status ${patchStatus}`));
    const after = (await admin.query<{ status: string }>(
      `SELECT status FROM deal WHERE public_id = $1`, [pid],
    )).rows[0]?.status;
    check("patchDeal left the existing status untouched", () => assert.equal(after, "active"));
  }
} finally {
  await admin.query(`DELETE FROM deal WHERE public_id LIKE $1`, [`${RUN}%`]);
  await admin.query(`DELETE FROM id_registry WHERE public_id LIKE $1`, [`${RUN}%`]);
  await admin.query(`DELETE FROM account WHERE public_id = $1`, [ACCOUNT]);
  await admin.query(`DELETE FROM app_user WHERE public_id = $1`, [USER]);
  await admin.query(`DELETE FROM org_unit WHERE id = $1`, [ORG]);
  const left = await admin.query<{ n: number }>(
    `SELECT count(*)::int n FROM deal WHERE public_id LIKE $1`, [`${RUN}%`],
  );
  console.log(`\n  cleanup: ${left.rows[0].n} fixture deal row(s) remain`);
  if (Number(left.rows[0].n) !== 0) failures += 1;
  await admin.end();
  await closePool().catch(() => undefined);
}

console.log("");
if (failures > 0) fail(`${failures} check(s) failed.`);
console.log("OK — an unmapped deal status is refused without poisoning the transaction.");
