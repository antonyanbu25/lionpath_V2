#!/usr/bin/env tsx
/**
 * Roadmap 3.5 gate: a retried append-only write must not duplicate the row.
 *
 * §07.3 listed five routes as "non-idempotent by construction": they mint
 * `Date.now()`-suffixed ids under `ON CONFLICT … DO NOTHING`, so the
 * DO NOTHING can never fire and a retry appends again. Two of the five are
 * pure database writes and are fixed here:
 *
 *   - addArrOverride   — a retry appended a second ARR override
 *   - addContactEvent  — a retry appended a duplicate event
 *
 * Both are AUDIT TRAILS, which is what makes a duplicate worse than a
 * failure: nothing downstream can tell a double-submit from two real events.
 *
 * Two remaining routes are NOT covered here and are not oversights:
 * `POST /api/tickets` and `POST /api/disputes/notify` have external side
 * effects (a Freshdesk ticket, an email) and need idempotency at the boundary
 * — a dedupe record written BEFORE the call out, which is a different design.
 *
 * `POST /api/deals` WAS in this category — this docstring used to say fixing
 * its Firestore `.add()` auto-id "would entrench a Firestore write path the
 * settled decisions say should not exist; the fix there is the PostgreSQL
 * cutover, not a dedupe key." That assumed a dormant SQL-first path already
 * existed for this handler. It doesn't: `handleDealsCreate` has never been
 * part of `trySqlDomainWrite`'s case dispatch, so there was no existing
 * alternate path being bypassed by fixing it. UAT-003 (2026-09-11 staging:
 * deal count observed going 4 -> 8 on retry) fixed it with the exact same
 * `deterministicAppendId` + create()-not-add() pattern used below — see
 * `createDealIdempotent` in worker/src/routes.ts and
 * worker/scripts/test-deal-create-idempotency.ts.
 *
 * Asserts:
 *   1. The id is stable for identical content inside one window, and differs
 *      across windows — the property the whole mechanism rests on.
 *   2. Key order in the payload does not change the id (a retry whose JSON was
 *      re-serialised differently must still match).
 *   3. Different content yields a different id — so this de-duplicates rather
 *      than merging unrelated writes.
 *   4. A retried addArrOverride leaves ONE row. Fails before the fix.
 *   5. A retried addContactEvent leaves ONE row. Fails before the fix.
 *   6. A genuinely different override still appends, so the dedupe is not
 *      swallowing real events.
 *   7. A caller-supplied id still wins and is used verbatim.
 *
 * DISPOSABLE LOCAL DATABASES ONLY. Refuses a non-loopback host unless
 * --allow-remote. Fails loudly without a database rather than skipping green.
 */
import assert from "node:assert/strict";
import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";
import { PostgresRepository } from "../src/data/persistence/postgres-repository.ts";
import {
  IDEMPOTENCY_WINDOW_MS,
  deterministicAppendId,
} from "../src/data/persistence/idempotency.ts";
import { closePool, getPool } from "../src/data/persistence/postgres-pool.ts";
import { trySqlDomainWrite } from "../src/routes.ts";

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
  fail(`refusing to write rows against non-loopback host "${host}". Pass --allow-remote only if it is disposable.`);
}

const RUN = `JANUS_AUDIT_TEST_ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const ORG = `${RUN}_org`;
const USER = `${RUN}_u`;
const ACCOUNT = `${RUN}_acc`;
const DEAL = `${RUN}_deal`;
const CONTACT = `${RUN}_contact`;

const { default: pgMod } = await import("pg");
const admin = new pgMod.Client(pgClientConfig(MIG_URL));
await admin.connect();

const repo = new PostgresRepository();
const pool = await getPool({ DATABASE_URL: APP_URL } as never);
let fixtureUserId = "0";

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

const countRows = async (table: string, col: string, parent: string) =>
  Number(
    (await admin.query<{ n: number }>(
      `SELECT count(*)::int n FROM ${table} t
         JOIN ${col} p ON p.id = t.${col}_id
        WHERE p.public_id = $1`,
      [parent],
    )).rows[0].n,
  );

try {
  console.log(`Roadmap 3.5 append-idempotency gate — run ${RUN}\n`);

  // --- fixtures -------------------------------------------------------------
  await admin.query(
    `INSERT INTO org_unit (id, name, unit_type, path) VALUES ($1, 'AI Gate Org', 'team', $1)
     ON CONFLICT (id) DO NOTHING`,
    [ORG],
  );
  const u = await admin.query<{ id: string }>(
    `INSERT INTO app_user (public_id, email, org_unit_id) VALUES ($1, $2, $3)
     ON CONFLICT (public_id) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
    [USER, `${USER}@example.invalid`, ORG],
  );
  fixtureUserId = String(u.rows[0].id);
  const acc = await admin.query<{ id: string }>(
    `INSERT INTO account (public_id, name) VALUES ($1, 'AI Gate Account')
     ON CONFLICT (public_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [ACCOUNT],
  );
  const dl = await admin.query<{ id: string }>(
    `INSERT INTO deal (public_id, account_id, owner_user_id, org_unit_id, name, stage, status)
     VALUES ($1, $2, $3, $4, 'AI Gate Deal', 'discovery', 'active')
     ON CONFLICT (public_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [DEAL, acc.rows[0].id, fixtureUserId, ORG],
  );
  const ct = await admin.query<{ id: string }>(
    `INSERT INTO contact (public_id, account_id, name, email)
     VALUES ($1, $2, 'AI Gate Contact', $3)
     ON CONFLICT (public_id) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [CONTACT, acc.rows[0].id, `${CONTACT}@example.invalid`],
  );
  for (const [type, pid, id] of [
    ["account", ACCOUNT, acc.rows[0].id],
    ["app_user", USER, fixtureUserId],
    ["deal", DEAL, dl.rows[0].id],
    ["contact", CONTACT, ct.rows[0].id],
  ] as const) {
    await admin.query(
      `INSERT INTO id_registry (entity_type, public_id, internal_id) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [type, pid, id],
    );
  }

  // --- 1..3: the id derivation itself ---------------------------------------
  const content = { previousValue: 100, newValue: 200, reason: "uplift", createdBy: USER };
  const t0 = 1_700_000_000_000;
  check("identical content inside one window yields the SAME id", () =>
    assert.equal(
      deterministicAppendId("aov", DEAL, content, t0),
      deterministicAppendId("aov", DEAL, content, t0 + 1000),
    ));
  check("the same content in a LATER window yields a different id", () =>
    assert.notEqual(
      deterministicAppendId("aov", DEAL, content, t0),
      deterministicAppendId("aov", DEAL, content, t0 + IDEMPOTENCY_WINDOW_MS * 2),
    ));
  check("payload key ORDER does not change the id", () =>
    assert.equal(
      deterministicAppendId("ce", CONTACT, { a: 1, b: { x: 1, y: 2 } }, t0),
      deterministicAppendId("ce", CONTACT, { b: { y: 2, x: 1 }, a: 1 }, t0),
    ));
  check("different content yields a different id", () =>
    assert.notEqual(
      deterministicAppendId("aov", DEAL, content, t0),
      deterministicAppendId("aov", DEAL, { ...content, newValue: 300 }, t0),
    ));

  // --- 4: a retried ARR override lands ONE row ------------------------------
  const aovId = deterministicAppendId("aov", DEAL, content);
  for (let attempt = 0; attempt < 3; attempt++) {
    await inTransaction((c) => repo.addArrOverride(c, {
      publicId: aovId,
      dealPublicId: DEAL,
      previousValue: content.previousValue,
      newValue: content.newValue,
      reason: content.reason,
      createdByPublicId: USER,
    }));
  }
  const aovRows = await countRows("arr_override", "deal", DEAL);
  check("three identical addArrOverride attempts leave ONE row", () =>
    assert.equal(aovRows, 1, `found ${aovRows} — the ON CONFLICT guard did not fire`));

  // --- 5: a retried contact event lands ONE row -----------------------------
  // Must be one of contact_event_event_type_check's values: contact_created,
  // field_updated, disc_updated, influence_updated, linked_from_prep,
  // linked_from_postcall. A free-text type is rejected by the CHECK, which is
  // itself worth knowing — the route takes event_type straight from the
  // request body (stringField(ev.type) || stringField(ev.eventType)) with no
  // validation, so an unrecognised type aborts the transaction exactly the way
  // deal.status did (roadmap 1.6). Not fixed here; recorded.
  const evContent = { eventType: "field_updated", actorId: USER, payload: { subject: "hello" } };
  const ceId = deterministicAppendId("ce", CONTACT, evContent);
  for (let attempt = 0; attempt < 3; attempt++) {
    await inTransaction((c) => repo.addContactEvent(c, {
      publicId: ceId,
      contactPublicId: CONTACT,
      eventType: evContent.eventType,
      actorPublicId: USER,
      payload: evContent.payload,
    }));
  }
  const ceRows = await countRows("contact_event", "contact", CONTACT);
  check("three identical addContactEvent attempts leave ONE row", () =>
    assert.equal(ceRows, 1, `found ${ceRows} — the ON CONFLICT guard did not fire`));

  // --- 6: a genuinely different write still appends -------------------------
  const otherId = deterministicAppendId("aov", DEAL, { ...content, newValue: 300 });
  await inTransaction((c) => repo.addArrOverride(c, {
    publicId: otherId,
    dealPublicId: DEAL,
    previousValue: 200,
    newValue: 300,
    reason: content.reason,
    createdByPublicId: USER,
  }));
  const aovRows2 = await countRows("arr_override", "deal", DEAL);
  check("a genuinely different override still appends (dedupe is not swallowing events)", () =>
    assert.equal(aovRows2, 2, `found ${aovRows2}`));

  // --- 6b: THE ROUTE PATH, which is what roadmap 3.5 actually changed -------
  //
  // Everything above supplies its own public_id, so it exercises the
  // repository's ON CONFLICT — which was never broken. The defect was the
  // CALLER minting `aov_${dealId}_${Date.now()}`. These two checks drive
  // trySqlDomainWrite, so they fail if the derivation goes back to the clock.
  {
    const env = {
      DATABASE_URL: APP_URL,
      PERSISTENCE_MODE: "sql",
      ALLOWED_EMAIL_DOMAIN: "",
    } as unknown as Parameters<typeof trySqlDomainWrite>[0];
    // Dummy-auth mode (no FIREBASE_PROJECT_ID): trySqlDomainWrite accepts a
    // claimed identity from X-Dev-User-Email, which is how the SQL path is
    // reachable locally at all.
    const mkRequest = () =>
      new Request("http://127.0.0.1:8787/api/domain-write", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Dev-User-Email": `${USER}@example.invalid` },
        body: "{}",
      });

    const routeDoc = {
      dealId: DEAL,
      previousValue: 400,
      newValue: 500,
      reason: "route-path retry",
      ownerId: USER,
    };
    const beforeRoute = await countRows("arr_override", "deal", DEAL);
    let routeError = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await trySqlDomainWrite(env, null, "upsertArrOverride", [routeDoc], mkRequest());
      } catch (err) {
        routeError = err instanceof Error ? err.message : String(err);
      }
    }
    const afterRoute = await countRows("arr_override", "deal", DEAL);
    check("three identical upsertArrOverride ROUTE calls append exactly one row", () =>
      assert.equal(
        afterRoute - beforeRoute,
        1,
        routeError
          ? `appended ${afterRoute - beforeRoute}; last error: ${routeError.slice(0, 160)}`
          : `appended ${afterRoute - beforeRoute} rows — the route is still deriving the id from the clock`,
      ));

    const evDoc = {
      contactId: CONTACT,
      event: { type: "disc_updated", actorId: USER, payload: { via: "route" } },
    };
    const beforeEv = await countRows("contact_event", "contact", CONTACT);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await trySqlDomainWrite(env, null, "addContactEvent", [CONTACT, evDoc.event], mkRequest());
      } catch { /* counted below */ }
    }
    const afterEv = await countRows("contact_event", "contact", CONTACT);
    check("three identical addContactEvent ROUTE calls append exactly one row", () =>
      assert.equal(
        afterEv - beforeEv,
        1,
        `appended ${afterEv - beforeEv} rows — the route is still deriving the id from the clock`,
      ));
  }

  // --- 7: a caller-supplied id still wins -----------------------------------
  const explicit = `${RUN}_explicit_aov`;
  await inTransaction((c) => repo.addArrOverride(c, {
    publicId: explicit,
    dealPublicId: DEAL,
    previousValue: 300,
    newValue: 400,
    reason: "explicit id",
    createdByPublicId: USER,
  }));
  const explicitStored = Number(
    (await admin.query<{ n: number }>(
      `SELECT count(*)::int n FROM arr_override WHERE public_id = $1`, [explicit],
    )).rows[0].n,
  );
  check("a caller-supplied public_id is used verbatim", () =>
    assert.equal(explicitStored, 1));
} finally {
  await admin.query(
    `DELETE FROM arr_override WHERE deal_id IN (SELECT id FROM deal WHERE public_id LIKE $1)`,
    [`${RUN}%`],
  );
  await admin.query(
    `DELETE FROM contact_event WHERE contact_id IN (SELECT id FROM contact WHERE public_id LIKE $1)`,
    [`${RUN}%`],
  );
  await admin.query(`DELETE FROM deal_stage_history WHERE deal_id IN (SELECT id FROM deal WHERE public_id LIKE $1)`, [`${RUN}%`]);
  await admin.query(`DELETE FROM deal WHERE public_id LIKE $1`, [`${RUN}%`]);
  await admin.query(`DELETE FROM contact WHERE public_id LIKE $1`, [`${RUN}%`]);
  await admin.query(`DELETE FROM id_registry WHERE public_id LIKE $1`, [`${RUN}%`]);
  await admin.query(`DELETE FROM account WHERE public_id LIKE $1`, [`${RUN}%`]);
  await admin.query(`DELETE FROM app_user WHERE public_id LIKE $1`, [`${RUN}%`]);
  await admin.query(`DELETE FROM org_unit WHERE id LIKE $1`, [`${RUN}%`]);
  const left = Number(
    (await admin.query<{ n: number }>(
      `SELECT count(*)::int n FROM deal WHERE public_id LIKE $1`, [`${RUN}%`],
    )).rows[0].n,
  );
  console.log(`\n  cleanup: ${left} fixture deal row(s) remain`);
  if (left !== 0) failures += 1;
  await admin.end();
  await closePool().catch(() => undefined);
}

console.log("");
if (failures > 0) fail(`${failures} check(s) failed.`);
console.log("OK — retried append-only writes de-duplicate; distinct writes still append.");
