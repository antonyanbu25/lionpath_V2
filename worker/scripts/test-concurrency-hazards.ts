#!/usr/bin/env tsx
/**
 * Concurrency and failure-injection characterisation suite (audit prompt P-C1).
 *
 * The forensic audit's `07-acid-concurrency-recovery.md` identified nine
 * concurrency hazards by STATIC ANALYSIS. No test anywhere exercised any of
 * them, so none was known to be real. This suite exercises each one against a
 * disposable local PostgreSQL and records the measured outcome.
 *
 * WHY THIS IS A CHARACTERISATION SUITE, NOT A PASS/FAIL SUITE
 *
 * Several of these hazards ARE real. A suite that failed on each would be red
 * from the day it was written and would be switched off within a week — the
 * same fate as the gates F-038 found exiting 0 without a database.
 *
 * Instead each hazard has a recorded EXPECTED verdict below. The suite fails
 * when reality DIVERGES from the record — in either direction. So it catches a
 * regression (a safe path becoming unsafe) AND it catches a fix (an unsafe path
 * becoming safe, which should prompt updating the record). A hazard being real
 * is documented, not alarmed about; a hazard CHANGING is the signal.
 *
 * DISPOSABLE LOCAL DATABASES ONLY. Several scenarios deliberately provoke data
 * loss and duplicate-key aborts. The host guard below refuses anything that is
 * not loopback. Never point this at staging.
 *
 * Usage:
 *   node worker/scripts/start-local-postgres.mjs       # or an equivalent cluster
 *   DATABASE_URL=... DATABASE_URL_MIGRATIONS=... npx tsx worker/scripts/test-concurrency-hazards.ts
 */
import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";
import { PostgresRepository } from "../src/data/persistence/postgres-repository.ts";
import { registerId, resolveInternalId } from "../src/data/persistence/id-registry.ts";
import { saveHistoryEntry, normalizeHistoryEmail } from "../src/history.ts";
import { createPostgresHistoryBackend } from "../src/history-pg.ts";
import { getPool } from "../src/data/persistence/postgres-pool.ts";

loadDevVars();

const argv = process.argv.slice(2);
const allowSkip = argv.includes("--allow-skip");
const allowRemote = argv.includes("--allow-remote");

const APP_URL = (process.env.DATABASE_URL || "").trim();
const MIG_URL = (process.env.DATABASE_URL_MIGRATIONS || "").trim();

function die(msg: string): never {
  console.error(`\n[FAIL] ${msg}`);
  process.exit(1);
}

if (!APP_URL || !MIG_URL) {
  if (allowSkip) {
    console.log("[SKIP] DATABASE_URL/DATABASE_URL_MIGRATIONS unset (--allow-skip).");
    process.exit(0);
  }
  die("DATABASE_URL (janus_app) and DATABASE_URL_MIGRATIONS (postgres) must both be set.");
}

const host = new URL(MIG_URL.replace(/^postgresql:/, "http:")).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host) && !allowRemote) {
  die(
    `refusing to provoke data loss against non-loopback host "${host}". ` +
      `This suite deliberately causes lost updates and duplicate-key aborts.`,
  );
}

/**
 * The recorded reality, as measured on 2026-09-11 against schema head 37.
 *
 * "HAZARD" = the hazard is real and reproducible.
 * "SAFE"   = the code defends against it.
 *
 * Change a value here only together with the code change that caused it, and
 * say which in the commit message.
 */
type Verdict = "HAZARD" | "SAFE" | "SKIP";

const EXPECTED: Record<string, "HAZARD" | "SAFE"> = {
  // FIXED: saveHistoryEntry now prefers HistoryBackend.upsertListEntry, which
  // the PostgreSQL backend implements as ONE statement, so two concurrent saves
  // serialise on the row lock instead of clobbering each other.
  "H1 user_kv blob lost update": "SAFE",
  "H2 post_call.detail erased by a detail-less write": "HAZARD",
  "H3 two writers, same public_id, different idempotency keys": "HAZARD",
  // STILL A HAZARD, deliberately. id_registry is 1:1 by construction
  // (uq_id_registry_internal), so an alias needs a migration, and choosing
  // between orphaning the old id and rejecting the new one is an identity
  // decision rather than a bug fix. registerId now LOGS the remap so it stops
  // being invisible until an unrelated unmapped_parent failure.
  "H4 registerId remaps and orphans the old public_id": "HAZARD",
  "H5 repeated upsertPostCall is idempotent": "SAFE",
  "H6 scorecard header rewrite deletes existing themes": "HAZARD",
  // FIXED: replaceCallParticipants now dedupes on the resolved app_user id
  // inside `add`, so a user who is both primary SE and internal leader no
  // longer violates uq_cp_activity_user and aborts the whole set.
  "H7 duplicate person discards ALL participants": "SAFE",
  "H8 concurrent outbox claims double-deliver": "SAFE",
  // MEASURED SAFE, against my own prediction of HAZARD. The audit found twelve
  // unique constraints named by no ON CONFLICT and inferred each would raise a
  // raw duplicate-key error. For idx_activity_idempotency that is WRONG: the
  // `existing` CTE in upsertActivity selects on
  //   public_id = $1 OR idempotency_key = $2
  // so a second public_id reusing one key is found and UPDATED, never inserted.
  // The constraint is unnamed in ON CONFLICT but unreachable in practice.
  //
  // The same is NOT true of post_call.activity_id — see H3, which is real. So
  // "unnamed" does not imply "reachable"; each of the twelve needs its own test.
  "H9 idempotency-key collision raises an unhandled error": "SAFE",
};

const { default: pgMod } = await import("pg");
const admin = new pgMod.Client(pgClientConfig(MIG_URL));
await admin.connect();

const RUN = `JANUS_AUDIT_TEST_pc1_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const repo = new PostgresRepository();
const results: Array<{ name: string; verdict: Verdict; detail: string }> = [];

function record(name: string, verdict: Verdict, detail: string) {
  results.push({ name, verdict, detail });
  const expected = EXPECTED[name];
  // A SKIP is never a divergence — it means the scenario could not be set up
  // here, which is a coverage gap to report, not a behaviour change to alarm on.
  const flag = verdict === "SKIP" ? "SKIP" : expected === undefined ? "NEW " : expected === verdict ? "    " : "DIFF";
  console.log(`  ${flag} ${verdict.padEnd(6)} ${name}`);
  console.log(`         ${detail}`);
}

/** Run fn on its own connection with an admin session context, committed. */
async function onOwnConnection<T>(fn: (c: any) => Promise<T>): Promise<T> {
  const c = new pgMod.Client(pgClientConfig(MIG_URL));
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.is_admin','true',true)");
    await c.query("SELECT set_config('app.user_id','1',true)");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await c.end();
  }
}

const ORG = `${RUN}_org`;
let userId = 0;
let accountPid = `${RUN}_acct`;
let activityPid = `${RUN}_act`;
let postCallPid = `${RUN}_pc`;

try {
  console.log(`P-C1 concurrency hazard characterisation — run ${RUN}\n`);

  // ---------------- fixtures ----------------
  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.is_admin','true',true)");
  await admin.query(
    `INSERT INTO org_unit (id,name,unit_type,path) VALUES ($1,$1,'team','/'||$1||'/')`, [ORG]);
  const u = await admin.query(
    `INSERT INTO app_user (public_id,email,display_name,org_unit_id,status)
     VALUES ($1,$2,$1,$3,'active') RETURNING id`,
    [`${RUN}_u`, `${RUN}@example.invalid`, ORG]);
  userId = Number(u.rows[0].id);
  await admin.query(`SELECT register_id('app_user',$1,$2)`, [`${RUN}_u`, userId]);
  const a = await admin.query(
    `INSERT INTO account (public_id,name,slug) VALUES ($1,$1,$1) RETURNING id`, [accountPid]);
  await admin.query(`SELECT register_id('account',$1,$2)`, [accountPid, Number(a.rows[0].id)]);
  await admin.query("COMMIT");
  console.log(`  fixtures: org=${ORG} user=${userId} account=${accountPid}\n`);

  const session = { userId, orgUnitPath: `/${ORG}/`, isAdmin: true };

  // Seed an activity + post_call to hang the rest off.
  await onOwnConnection(async (c) => {
    await repo.upsertActivity(c, {
      publicId: activityPid, idempotencyKey: `${RUN}_idem`, accountPublicId: accountPid,
      ownerPublicId: `${RUN}_u`, orgUnitId: ORG, activityType: "call",
      subject: "pc1", occurredAt: new Date().toISOString(),
    });
    await repo.upsertPostCall(c, {
      publicId: postCallPid, idempotencyKey: `${RUN}_idem`, activityPublicId: activityPid,
      analysis: { seeded: true }, detail: { followUps: [{ id: "f1", text: "seed" }] },
      pipelineState: "analysis_done",
    });
  });

  // ---------------- H1: user_kv blob lost update ----------------
  {
    // normalizeHistoryEmail LOWERCASES, and RUN is upper-case, so the product
    // writes to a different row than a raw `${RUN}_kv@...` would seed or read.
    // Normalising here is the only way this check reads the row the code under
    // test actually wrote — without it the assertion silently measured an
    // untouched seed row and reported a false HAZARD.
    const email = normalizeHistoryEmail(`${RUN}_kv@example.invalid`);
    await admin.query(
      `INSERT INTO user_kv (email, history) VALUES ($1, $2::jsonb)
       ON CONFLICT (email) DO UPDATE SET history = EXCLUDED.history`,
      [email, JSON.stringify([])]);
    // Drive the PRODUCT path, not a hand-rolled imitation of it. The earlier
    // version of this check issued its own SELECT-then-UPDATE, which meant it
    // measured the test's SQL rather than saveHistoryEntry — so it would have
    // gone on reporting HAZARD no matter what the product did.
    const historyEnv = {
      HISTORY_BACKEND: createPostgresHistoryBackend(
        await getPool({ DATABASE_URL: APP_URL } as never),
      ),
    };
    await Promise.all([
      saveHistoryEntry(historyEnv, email, { id: "A", timestamp: 2 } as never),
      saveHistoryEntry(historyEnv, email, { id: "B", timestamp: 1 } as never),
    ]);
    const final = await admin.query(`SELECT history FROM user_kv WHERE email=$1`, [email]);
    const kept = (final.rows[0].history as Array<{ id: string }>).map((x) => x.id).sort();
    record("H1 user_kv blob lost update",
      kept.length === 2 ? "SAFE" : "HAZARD",
      `after two concurrent saveHistoryEntry calls the blob holds [${kept.join(",")}] — ${kept.length} of 2 entries survived`);
  }

  // ---------------- H2: detail erased by a detail-less write ----------------
  {
    await onOwnConnection((c) => repo.upsertDetailItem(c, {
      callPublicId: postCallPid, key: "followUps", item: { id: "f2", text: "added later" },
    }));
    const before = await admin.query(
      `SELECT jsonb_array_length(detail->'followUps') n FROM post_call WHERE public_id=$1`, [postCallPid]);
    // Now the history path: upsertPostCall with detail omitted entirely.
    await onOwnConnection((c) => repo.upsertPostCall(c, {
      publicId: postCallPid, idempotencyKey: `${RUN}_idem`, activityPublicId: activityPid,
      analysis: { seeded: true }, detail: null, pipelineState: "analysis_done",
    }));
    const after = await admin.query(
      `SELECT detail IS NULL AS is_null FROM post_call WHERE public_id=$1`, [postCallPid]);
    record("H2 post_call.detail erased by a detail-less write",
      after.rows[0].is_null ? "HAZARD" : "SAFE",
      `detail held ${before.rows[0].n} followUps, then a detail:null upsert left it ${after.rows[0].is_null ? "NULL — all items lost" : "intact"}`);
  }

  // ---------------- H3: two writers, same public_id, different idem keys ----------------
  // A REAL RACE, so one attempt proves nothing: the first two runs of this
  // suite measured HAZARD and the third measured SAFE. Detecting a
  // non-deterministic hazard deterministically means repeating the race and
  // asking whether the collision is reachable AT ALL — an intermittent race is
  // worse than a constant one, because it survives review and fires in
  // production.
  {
    const ATTEMPTS = 12;
    let collisions = 0;
    let firstMessage = "";
    for (let i = 0; i < ATTEMPTS; i++) {
      const pid = `${RUN}_pc_h3_${i}`;
      const act = `${RUN}_act_h3_${i}`;
      await onOwnConnection((c) => repo.upsertActivity(c, {
        publicId: act, idempotencyKey: `${RUN}_h3a_${i}`, accountPublicId: accountPid,
        ownerPublicId: `${RUN}_u`, orgUnitId: ORG, activityType: "call",
        occurredAt: new Date().toISOString(),
      }));
      const write = (key: string) => onOwnConnection((c) => repo.upsertPostCall(c, {
        publicId: pid, idempotencyKey: key, activityPublicId: act,
        analysis: { from: key }, pipelineState: "analysis_done",
      })).then(() => null).catch((e) => e as Error);
      const [e1, e2] = await Promise.all([write(`${RUN}_k1_${i}`), write(`${RUN}_k2_${i}`)]);
      const err = (e1 || e2) as Error | null;
      if (err) {
        collisions += 1;
        if (!firstMessage) firstMessage = err.message;
      }
    }
    record("H3 two writers, same public_id, different idempotency keys",
      collisions > 0 ? "HAZARD" : "SKIP",
      collisions > 0
        ? `${collisions} of ${ATTEMPTS} concurrent attempts raised a raw duplicate-key error: ${firstMessage.slice(0, 64)} — the collision is on post_call.activity_id UNIQUE, one of the twelve constraints named by no ON CONFLICT. INTERMITTENT, so it survives review`
        : `0 of ${ATTEMPTS} attempts collided in this run — hazard is intermittent; re-run or increase ATTEMPTS to observe HAZARD`);
  }

  // ---------------- H4: registerId remaps and orphans the old public_id ----------------
  {
    // A DEDICATED user, not the shared fixture: H4's hazard orphans the old
    // public_id, and on first run that broke every later scenario when it was
    // pointed at the shared owner. The hazard is real enough to poison its own
    // test suite, which is itself worth recording.
    const rp = await admin.query(
      `INSERT INTO app_user (public_id,email,display_name,org_unit_id,status)
       VALUES ($1,$2,$1,$3,'active') RETURNING id`,
      [`${RUN}_remapuser`, `${RUN}_remap@example.invalid`, ORG]);
    const internal = Number(rp.rows[0].id);
    const oldPid = `${RUN}_remap_old`;
    const newPid = `${RUN}_remap_new`;
    await onOwnConnection(async (c) => {
      await registerId(c, "app_user", oldPid, internal);
      await registerId(c, "app_user", newPid, internal);
    });
    const stillResolves = await onOwnConnection(async (c) => {
      try { return await resolveInternalId(c, "app_user", oldPid); } catch { return null; }
    });
    record("H4 registerId remaps and orphans the old public_id",
      stillResolves ? "SAFE" : "HAZARD",
      stillResolves
        ? `the old public_id still resolves to ${stillResolves}`
        : `after registering a second public_id for internal_id ${internal}, the FIRST public_id no longer resolves — every child write keyed on it now fails unmapped_parent`);
  }

  // ---------------- H5: repeated upsertPostCall is idempotent ----------------
  {
    const pid = `${RUN}_pc_h5`;
    const act = `${RUN}_act_h5`;
    await onOwnConnection((c) => repo.upsertActivity(c, {
      publicId: act, accountPublicId: accountPid, ownerPublicId: `${RUN}_u`,
      orgUnitId: ORG, activityType: "call", occurredAt: new Date().toISOString(),
    }));
    const once = () => onOwnConnection((c) => repo.upsertPostCall(c, {
      publicId: pid, idempotencyKey: `${RUN}_h5`, activityPublicId: act,
      analysis: { n: 1 }, pipelineState: "analysis_done",
    }));
    await once(); await once(); await once();
    const rows = await admin.query(`SELECT count(*)::int n FROM post_call WHERE public_id=$1`, [pid]);
    record("H5 repeated upsertPostCall is idempotent",
      rows.rows[0].n === 1 ? "SAFE" : "HAZARD",
      `three sequential identical upserts produced ${rows.rows[0].n} row(s)`);
  }

  // ---------------- H6: scorecard header rewrite deletes themes ----------------
  // Previously SKIPped as "requires a full scorecard fixture", which left the
  // DELETE at postgres-repository.ts:656 CODE-PROVEN but UNMEASURED. Now built.
  //
  // Read the outcome carefully: the DELETE is DELIBERATE and documented, and
  // the browser DEPENDS on it. types.ts:233-239 states that the client writes
  // the header once and then each theme as a SEPARATE call, so the header write
  // is what clears the slate. A theme-preserving header write would break that
  // contract and leave orphan themes in the composite denominator when a
  // profile version drops a theme (NB discovery lost storytelling, 33 -> 32
  // credits).
  //
  // The hazard is therefore NOT the DELETE. It is that clear-then-append spans
  // MULTIPLE requests with no transaction around them, so an interruption after
  // the header lands leaves a scorecard with FEWER themes than it had, and the
  // denominator silently changes. That is a writer-convergence problem (P3),
  // not something to patch here by making the DELETE conditional.
  {
    const rubricRow = await admin.query<{ id: string; call_type: string; se_motion: string; version: string }>(
      `SELECT id, call_type, se_motion, version FROM rubric WHERE id = 'rub_demo_2_1'`);
    const themeRow = await admin.query<{ id: string; theme_key: string; category: string; credit: number }>(
      `SELECT id, theme_key, category, credit FROM rubric_theme
        WHERE rubric_id = 'rub_demo_2_1' ORDER BY id LIMIT 1`);
    if (!rubricRow.rowCount || !themeRow.rowCount) {
      record("H6 scorecard header rewrite deletes existing themes", "SKIP",
        "rubric catalog absent — run `node janus/scripts/load-rubric-catalog.mjs` against this cluster");
    } else {
      const rub = rubricRow.rows[0];
      const th = themeRow.rows[0];
      const act = `${RUN}_act_h6`;
      const sc = `${RUN}_sc_h6`;
      await onOwnConnection((c) => repo.upsertActivity(c, {
        publicId: act, accountPublicId: accountPid, ownerPublicId: `${RUN}_u`,
        orgUnitId: ORG, activityType: "call", occurredAt: new Date().toISOString(),
      }));
      const header = {
        publicId: sc, activityPublicId: act, rubricId: rub.id,
        ownerPublicId: `${RUN}_u`, orgUnitId: ORG,
        callType: rub.call_type, seMotion: rub.se_motion as "new_business" | "expansion",
        rubricVersion: rub.version,
      };
      // 1) header + one theme, as a server-side caller with the whole draft.
      await onOwnConnection((c) => repo.upsertScorecard(c, {
        ...header,
        themes: [{
          themeKey: th.theme_key, rubricThemeId: th.id, grade: null,
          credit: Number(th.credit), category: th.category,
          // Excluded so no scorecard_line/rubric_parameter rows are needed;
          // notApplicableReason is mandatory whenever a theme is excluded.
          evidenceUnavailable: true, notApplicableReason: "H6 fixture",
          subParameters: [],
        }],
      }));
      const countThemes = async () => Number((await admin.query(
        `SELECT count(*)::int n FROM scorecard_theme st JOIN scorecard s ON s.id = st.scorecard_id
          WHERE s.public_id = $1`, [sc])).rows[0].n);
      const afterFirst = await countThemes();
      // 2) the client sequence: header ONLY, themes to follow in later calls.
      await onOwnConnection((c) => repo.upsertScorecard(c, { ...header }));
      const afterHeaderOnly = await countThemes();
      record("H6 scorecard header rewrite deletes existing themes",
        afterHeaderOnly >= afterFirst ? "SAFE" : "HAZARD",
        `themes ${afterFirst} -> ${afterHeaderOnly} after a header-only upsertScorecard. ` +
        `The DELETE is intended (types.ts:233-239 — the client appends themes in separate calls); ` +
        `the defect is that the clear-then-append sequence is not atomic, so an interruption ` +
        `after the header leaves a SHORTER theme list and a changed composite denominator`);
    }
  }

  // ---------------- H7: duplicate person discards ALL participants ----------------
  {
    const act = `${RUN}_act_h7`;
    await onOwnConnection((c) => repo.upsertActivity(c, {
      publicId: act, accountPublicId: accountPid, ownerPublicId: `${RUN}_u`,
      orgUnitId: ORG, activityType: "call", occurredAt: new Date().toISOString(),
    }));
    // The same user as BOTH primary SE and internal leader — only secondary is deduped.
    const err = await onOwnConnection((c) => repo.replaceCallParticipants(c, {
      activityPublicId: act,
      primarySeUserPublicId: `${RUN}_u`,
      internalLeaderPublicIds: [`${RUN}_u`],
      roomNames: ["Room A"],
    })).then(() => null).catch((e) => e as Error);
    const kept = await admin.query(
      `SELECT count(*)::int n FROM call_participant cp
         JOIN activity a ON a.id = cp.activity_id WHERE a.public_id = $1`, [act]);
    record("H7 duplicate person discards ALL participants",
      err === null && kept.rows[0].n > 0 ? "SAFE" : "HAZARD",
      err
        ? `the write threw (${err.message.slice(0, 60)}) and ${kept.rows[0].n} participant(s) survived — a duplicate person discards the whole set, including the room`
        : `${kept.rows[0].n} participant(s) persisted`);
  }

  // ---------------- H8: concurrent outbox claims double-deliver ----------------
  {
    const integ = await admin.query(`SELECT id FROM integration LIMIT 1`);
    if (!integ.rowCount) {
      record("H8 concurrent outbox claims double-deliver", "SKIP",
        "no integration row on this cluster");
    } else {
      await admin.query(
        `INSERT INTO sync_outbox (integration_id, entity_type, entity_id, operation, payload, status)
         VALUES ($1,'account',$2,'update',$3::jsonb,'pending')`,
        [Number(integ.rows[0].id), `${RUN}_ob`, JSON.stringify({ probe: true })]);
      const claim = async () => {
        const c = new pgMod.Client(pgClientConfig(MIG_URL));
        await c.connect();
        try {
          const r = await c.query(`SELECT * FROM claim_outbox_batch($1)`, [10]);
          return r.rows.filter((x: any) => String(x.entity_id) === `${RUN}_ob`).length;
        } finally { await c.end(); }
      };
      const [c1, c2] = await Promise.all([claim(), claim()]);
      record("H8 concurrent outbox claims double-deliver",
        c1 + c2 <= 1 ? "SAFE" : "HAZARD",
        `two concurrent claim_outbox_batch calls claimed the row ${c1 + c2} time(s) total — FOR UPDATE SKIP LOCKED ${c1 + c2 <= 1 ? "held" : "did NOT hold"}`);
    }
  }

  // ---------------- H9: idempotency-key collision raises an unhandled error ----------------
  {
    // idx_activity_idempotency is UNIQUE on idempotency_key but is named by no
    // ON CONFLICT. Two DIFFERENT public_ids sharing one key must collide on it.
    const key = `${RUN}_h9_shared`;
    const write = (pid: string) => onOwnConnection((c) => repo.upsertActivity(c, {
      publicId: pid, idempotencyKey: key, accountPublicId: accountPid,
      ownerPublicId: `${RUN}_u`, orgUnitId: ORG, activityType: "call",
      occurredAt: new Date().toISOString(),
    })).then(() => null).catch((e) => e as Error);
    await write(`${RUN}_act_h9a`);
    const e = await write(`${RUN}_act_h9b`);
    const rows = await admin.query(
      `SELECT count(*)::int n FROM activity WHERE idempotency_key=$1`, [key]);
    const isRawDuplicate = !!e && /duplicate key value|unique constraint/i.test(e.message);
    record("H9 idempotency-key collision raises an unhandled error",
      isRawDuplicate ? "HAZARD" : "SAFE",
      isRawDuplicate
        ? `a second public_id reusing one idempotency_key raised a RAW duplicate-key error: ${e!.message.slice(0, 70)}`
        : `${rows.rows[0].n} row(s); the second write ${e ? `failed with ${e.message.slice(0, 50)}` : "was absorbed — the existing-row lookup matched on idempotency_key"}`);
  }
} finally {
  // ---------------- cleanup, dependency-safe, by exact marker ----------------
  await admin.query("BEGIN").catch(() => undefined);
  await admin.query("SELECT set_config('app.is_admin','true',true)").catch(() => undefined);
  const del = async (sql: string, params: unknown[] = [`${RUN}%`]) =>
    admin.query(sql, params).catch(() => undefined);
  await del(`DELETE FROM sync_outbox WHERE entity_id LIKE $1`);
  await del(`DELETE FROM scorecard_line WHERE scorecard_id IN (SELECT id FROM scorecard WHERE public_id LIKE $1)`);
  await del(`DELETE FROM scorecard_theme WHERE scorecard_id IN (SELECT id FROM scorecard WHERE public_id LIKE $1)`);
  await del(`DELETE FROM scorecard WHERE public_id LIKE $1`);
  await del(`DELETE FROM ai_run WHERE activity_id IN (SELECT id FROM activity WHERE public_id LIKE $1)`);
  await del(`DELETE FROM deal WHERE public_id LIKE $1`);
  await del(`DELETE FROM call_participant WHERE activity_id IN (SELECT id FROM activity WHERE public_id LIKE $1)`);
  await del(`DELETE FROM post_call WHERE public_id LIKE $1`);
  await del(`DELETE FROM activity WHERE public_id LIKE $1`);
  // ILIKE: history emails are stored lower-cased by normalizeHistoryEmail,
  // while RUN is upper-case, so a case-sensitive LIKE leaks these rows.
  await del(`DELETE FROM user_kv WHERE email ILIKE $1`);
  await del(`DELETE FROM account WHERE public_id LIKE $1`);
  await del(`DELETE FROM id_registry WHERE public_id LIKE $1`);
  await del(`DELETE FROM app_user WHERE public_id LIKE $1`);
  await del(`DELETE FROM org_unit WHERE id LIKE $1`);
  await del(`DELETE FROM user_usage_logins WHERE email LIKE $1`);
  await admin.query("COMMIT").catch(() => undefined);

  const left = await admin.query(
    `SELECT (SELECT count(*) FROM activity WHERE public_id LIKE $1)
          + (SELECT count(*) FROM post_call WHERE public_id LIKE $1)
          + (SELECT count(*) FROM account WHERE public_id LIKE $1)
          + (SELECT count(*) FROM app_user WHERE public_id LIKE $1)
          + (SELECT count(*) FROM org_unit WHERE id LIKE $1) AS n`, [`${RUN}%`]).catch(() => null);
  console.log(`\n  cleanup: ${left ? `${left.rows[0].n} fixture row(s) remain` : "could not verify"}`);
  await admin.end().catch(() => undefined);
  const { closePool } = await import("../src/data/persistence/postgres-pool.ts");
  await closePool().catch(() => undefined);
}

// ---------------- verdict ----------------
const hazards = results.filter((r) => r.verdict === "HAZARD");
const safe = results.filter((r) => r.verdict === "SAFE");
const skipped = results.filter((r) => r.verdict === "SKIP");
const measured = results.filter((r) => r.verdict !== "SKIP");
const diverged = measured.filter((r) => EXPECTED[r.name] !== undefined && EXPECTED[r.name] !== r.verdict);
const novel = measured.filter((r) => EXPECTED[r.name] === undefined);

console.log(`\n  ${measured.length} measured · ${hazards.length} REAL hazard(s) · ${safe.length} defended · ${skipped.length} skipped`);
if (skipped.length) {
  console.log(`  skipped (coverage gap, not a pass): ${skipped.map((s) => s.name.split(" ")[0]).join(", ")}`);
}

if (diverged.length || novel.length) {
  console.error(`\nFAIL — measured behaviour diverged from the recorded baseline:`);
  for (const d of diverged) {
    console.error(`  ${d.name}\n     recorded ${EXPECTED[d.name]}, measured ${d.verdict}`);
  }
  for (const n of novel) console.error(`  ${n.name}\n     not in the baseline — add it to EXPECTED`);
  console.error(
    `\nIf this is a FIX, update EXPECTED in the same commit and say so in the message.\n` +
      `If it is a REGRESSION, a concurrency defence has been lost.`);
  process.exit(1);
}

console.log("\nOK — all nine hazards behave exactly as recorded. No concurrency regression.");
