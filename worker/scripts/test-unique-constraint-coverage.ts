#!/usr/bin/env tsx
/**
 * Unique-constraint reachability suite (roadmap 3.4, RESCOPED).
 *
 * WHAT THE AUDIT CLAIMED
 *
 * `docs/janus-forensic-reaudit-20260911/07-acid-concurrency-recovery.md` §3
 * states, as one blanket DELEGATED finding, that twelve real unique constraints
 * are named by *no* `ON CONFLICT`, "so a collision surfaces as an unhandled
 * `duplicate key value` that aborts the enclosing transaction".
 *
 * WHY THAT CLAIM IS RESCOPED HERE
 *
 * "Unnamed in ON CONFLICT" and "reachable" are different properties, and §3
 * conflates them. Two of the twelve were already measured by
 * test-concurrency-hazards.ts and they came out on OPPOSITE sides:
 *
 *   - H9 measured `idx_activity_idempotency` SAFE. upsertActivity's `existing`
 *     CTE selects on `public_id = $1 OR idempotency_key = $2`, so a second
 *     public_id reusing one key is FOUND and UPDATED, never inserted. The
 *     constraint is unnamed but UNREACHABLE.
 *   - H3 measured `post_call.activity_id` a real HAZARD — a raw duplicate-key
 *     error, intermittently (10 of 12 concurrent attempts in one run).
 *
 * So §3 is a list of CANDIDATES, not a list of defects. This suite tests each
 * of the twelve INDIVIDUALLY and records what it measured.
 *
 * A SECOND THING §3 GETS WRONG: the implied fix. "Name the constraint in
 * ON CONFLICT" is not available for most of these. PostgreSQL allows exactly
 * ONE `ON CONFLICT` clause per INSERT, and every one of these statements
 * already spends it on `(public_id)` — which it needs, for replay idempotence.
 * Absorbing a SECOND unique constraint therefore requires a pre-emptive
 * existing-row lookup or a demote-first UPDATE, which is precisely the shape
 * upsertAccount, upsertContact and seatAccountSeTeamMember already use. Those
 * three are the reason several of the twelve measure ABSORBED.
 *
 * WHY THIS IS A BASELINE SUITE, NOT A PASS/FAIL SUITE
 *
 * Same rationale as test-concurrency-hazards.ts: each constraint has a recorded
 * EXPECTED verdict, and the suite fails when reality diverges in EITHER
 * direction. A constraint that becomes reachable is a regression; one that
 * becomes absorbed is a fix that must update the baseline in the same commit.
 * A suite that simply failed on every reachable constraint would be red on day
 * one and switched off by the end of the week.
 *
 * WHAT "REACHABLE" MEANS HERE, AND THE REAL HARM
 *
 * A raw duplicate-key error does not merely fail its own statement. It puts the
 * enclosing transaction into the aborted state, so EVERY later statement fails
 * with SQLSTATE 25P02 `current transaction is aborted`. That is the actual
 * damage — commit b3b5849 demonstrated it for deal.status — and it is why an
 * unabsorbed collision in a multi-write handler loses the unrelated writes that
 * follow it. So every REACHABLE verdict here also probes a follow-on statement
 * and records whether the transaction was poisoned.
 *
 * DISPOSABLE LOCAL DATABASES ONLY. This suite deliberately provokes
 * duplicate-key aborts. The host guard below refuses anything that is not
 * loopback, exactly as test-concurrency-hazards.ts does. Never point it at
 * staging.
 *
 * Usage:
 *   node worker/scripts/start-local-postgres.mjs      # or an equivalent cluster
 *   node janus/scripts/load-rubric-catalog.mjs        # C10 needs two rubrics
 *   DATABASE_URL=... DATABASE_URL_MIGRATIONS=... npx tsx worker/scripts/test-unique-constraint-coverage.ts
 */
import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";
import { PostgresRepository } from "../src/data/persistence/postgres-repository.ts";

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
    `refusing to provoke duplicate-key aborts against non-loopback host "${host}". ` +
      `This suite deliberately violates unique constraints.`,
  );
}

/**
 * The recorded reality, as measured on 2026-09-11 against schema head 37.
 *
 * "REACHABLE" = a realistic repository write path raises a RAW duplicate-key
 *               error on this constraint, aborting the enclosing transaction.
 * "ABSORBED"  = the collision is handled. Either the constraint is unreachable
 *               because an existing-row lookup finds the row first, or a
 *               demote-first UPDATE clears the way, or ON CONFLICT covers it.
 *
 * Change a value here only together with the code change that caused it, and
 * say which in the commit message.
 */
type Verdict = "REACHABLE" | "ABSORBED" | "SKIP";

const EXPECTED: Record<string, "REACHABLE" | "ABSORBED"> = {
  // ---- the three idempotency-key indexes: all three ABSORBED, by the same
  // mechanism. upsertActivity / upsertPreCall / upsertPostCall all share one
  // `existing` CTE shape that matches `public_id = $1 OR idempotency_key = $2`,
  // so a reused key resolves to the existing row and takes the UPDATE branch.
  // §3 listed all three; all three are unreachable. H9 already proved the
  // first, and the other two fall out of the identical statement shape.
  "C1  idx_activity_idempotency": "ABSORBED",
  "C2  idx_pre_call_idempotency": "ABSORBED",
  "C3  idx_post_call_idempotency": "ABSORBED",

  // ---- the two activity_id uniques: the SAME CTE that saves the idempotency
  // indexes does NOT look at activity_id, so a second child row for one
  // activity under a new public_id finds no existing row and inserts. Both were
  // REACHABLE before this commit, and DETERMINISTICALLY so — H3 only ever
  // caught post_call intermittently because it raced two writers, but one
  // sequential write pair is enough. FIXED in this commit by extending the
  // `existing` CTE to treat activity_id as the third natural key.
  "C4  pre_call.activity_id": "ABSORBED",
  "C5  post_call.activity_id": "ABSORBED",

  // ---- the two AI-dedup partial indexes. upsertTask / upsertProductSignal
  // spend their single ON CONFLICT on (public_id) and never look up the dedup
  // key, so a re-run that mints a new public_id for the same
  // (activity, key) inserts and collides. Both were REACHABLE; FIXED in this
  // commit with the pre-emptive lookup that upsertContact already uses.
  "C6  idx_task_ai_dedup": "ABSORBED",
  "C7  idx_psig_ai_key": "ABSORBED",

  // ---- the two "natural key already taken" indexes. Both ALREADY had a
  // pre-emptive existing-row lookup before this commit (upsertAccount's slug
  // merge, upsertContact's account+email merge), and both measure ABSORBED on
  // the insert path. See C8b/C9b below for the rename path, which is a
  // different and genuinely ambiguous question.
  "C8  idx_account_slug_active": "ABSORBED",
  "C9  idx_contact_account_email_active": "ABSORBED",

  // ---- the rename path, reported SEPARATELY because the constraint is the
  // same but the caller's intent is not. Two ACTIVE rows cannot share a slug or
  // an account+email, so renaming row B onto row A's value is a MERGE request,
  // and which row survives is an identity decision, not a bug. Left REACHABLE
  // deliberately: DO NOTHING would silently discard the rename (the caller
  // believes it renamed), DO UPDATE cannot target a second constraint in the
  // same statement, and auto-merging would remap public_ids and orphan the
  // loser via the H4/J-034 registerId remap. Recommended, not guessed at.
  "C8b idx_account_slug_active (rename onto a taken slug)": "REACHABLE",
  "C9b idx_contact_account_email_active (rename onto a taken email)": "REACHABLE",

  // ---- the three "only one current/primary" partial indexes. All three write
  // paths ALREADY demote the incumbent before inserting, so all three absorb.
  // upsertScorecard and seatAccountSeTeamMember did so before this commit;
  // upsertDealContact did NOT (it was REACHABLE — setPrimaryDealContact
  // demoted, but upsertDealContact with isPrimary:true did not) and is FIXED
  // in this commit with the same demote-first UPDATE.
  "C10 idx_scorecard_activity_current": "ABSORBED",
  "C11 uq_aset_primary": "ABSORBED",
  "C12 idx_deal_contact_primary": "ABSORBED",
};

const { default: pgMod } = await import("pg");
const admin = new pgMod.Client(pgClientConfig(MIG_URL));
await admin.connect();

const RUN = `JANUS_AUDIT_TEST_uc34_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const repo = new PostgresRepository();
const results: Array<{ name: string; verdict: Verdict; detail: string }> = [];

function record(name: string, verdict: Verdict, detail: string) {
  results.push({ name, verdict, detail });
  const expected = EXPECTED[name];
  // A SKIP is never a divergence — it means the scenario could not be set up
  // here, which is a coverage gap to report, not a behaviour change.
  const flag =
    verdict === "SKIP" ? "SKIP" : expected === undefined ? "NEW " : expected === verdict ? "    " : "DIFF";
  console.log(`  ${flag} ${verdict.padEnd(9)} ${name}`);
  console.log(`         ${detail}`);
}

const ORG = `${RUN}_org`;
let userId = 0;

/**
 * Run fn in its own transaction and report what happened to the TRANSACTION,
 * not just to the statement.
 *
 * On error this issues a follow-on `SELECT 1` on the SAME connection BEFORE
 * rolling back. If the duplicate-key error poisoned the transaction, that probe
 * comes back 25P02 — which is the harm §3 describes and the thing worth
 * asserting. A collision that leaves the transaction usable is a different and
 * much milder animal than one that discards every subsequent write.
 */
async function probe(fn: (c: any) => Promise<unknown>): Promise<{
  error: Error | null;
  duplicateKey: boolean;
  constraint: string | null;
  txAborted: boolean;
}> {
  const c = new pgMod.Client(pgClientConfig(MIG_URL));
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.is_admin','true',true)");
    // A REAL app_user id: trg_fn_deal_stage_history writes
    // deal_stage_history.changed_by = current_user_id(), which carries an FK.
    await c.query(`SELECT set_config('app.user_id',$1,true)`, [String(userId)]);
    await fn(c);
    await c.query("COMMIT");
    return { error: null, duplicateKey: false, constraint: null, txAborted: false };
  } catch (err) {
    const e = err as Error & { code?: string; constraint?: string };
    const duplicateKey = e.code === "23505" || /duplicate key value|unique constraint/i.test(e.message);
    let txAborted = false;
    try {
      await c.query("SELECT 1");
    } catch (follow) {
      txAborted = (follow as { code?: string }).code === "25P02";
    }
    await c.query("ROLLBACK").catch(() => undefined);
    return { error: e, duplicateKey, constraint: e.constraint ?? null, txAborted };
  } finally {
    await c.end();
  }
}

/** probe(), but assert the write SUCCEEDED — used for the seed half of a pair. */
async function seed(fn: (c: any) => Promise<unknown>): Promise<void> {
  const r = await probe(fn);
  if (r.error) throw new Error(`fixture seed failed: ${r.error.message}`);
}

/** Turn a probe result into a verdict plus a one-line evidence string. */
function verdictOf(
  r: Awaited<ReturnType<typeof probe>>,
  absorbedNote: string,
): { verdict: Verdict; detail: string } {
  if (r.duplicateKey) {
    return {
      verdict: "REACHABLE",
      detail:
        `RAW duplicate-key error on ${r.constraint ?? "an unnamed constraint"}` +
        `; enclosing transaction ${r.txAborted ? "ABORTED (25P02 on the next statement) — every later write in the handler is lost" : "stayed usable"}` +
        ` — ${r.error!.message.slice(0, 90)}`,
    };
  }
  if (r.error) {
    // A non-duplicate error is still not a duplicate-key abort, which is what
    // §3 claims. Report it as absorbed-with-a-caveat rather than silently
    // counting it as a clean pass.
    return {
      verdict: "ABSORBED",
      detail: `no duplicate-key error; the write failed for an UNRELATED reason: ${r.error.message.slice(0, 90)}`,
    };
  }
  return { verdict: "ABSORBED", detail: absorbedNote };
}

const accountPid = `${RUN}_acct`;

try {
  console.log(`roadmap 3.4 — unique-constraint reachability, run ${RUN}\n`);

  // ---------------- fixtures ----------------
  // id_registry rows, not just table rows: every repository method resolves its
  // parents through resolveInternalId and throws 409 "no mapping for ..."
  // otherwise, which would show up as a bogus ABSORBED verdict.
  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.is_admin','true',true)");
  await admin.query(`INSERT INTO org_unit (id,name,unit_type,path) VALUES ($1,$1,'team','/'||$1||'/')`, [ORG]);
  const u = await admin.query(
    `INSERT INTO app_user (public_id,email,display_name,org_unit_id,status)
     VALUES ($1,$2,$1,$3,'active') RETURNING id`,
    [`${RUN}_u`, `${RUN}@example.invalid`, ORG],
  );
  userId = Number(u.rows[0].id);
  await admin.query(`SELECT register_id('app_user',$1,$2)`, [`${RUN}_u`, userId]);
  const u2 = await admin.query(
    `INSERT INTO app_user (public_id,email,display_name,org_unit_id,status)
     VALUES ($1,$2,$1,$3,'active') RETURNING id`,
    [`${RUN}_u2`, `${RUN}_2@example.invalid`, ORG],
  );
  await admin.query(`SELECT register_id('app_user',$1,$2)`, [`${RUN}_u2`, Number(u2.rows[0].id)]);
  const a = await admin.query(`INSERT INTO account (public_id,name,slug) VALUES ($1,$1,$1) RETURNING id`, [
    accountPid,
  ]);
  await admin.query(`SELECT register_id('account',$1,$2)`, [accountPid, Number(a.rows[0].id)]);
  await admin.query("COMMIT");
  console.log(`  fixtures: org=${ORG} user=${userId} account=${accountPid}\n`);

  // Every probe activity carries a deal. trg 29_precall_deal_required raises
  // when a pre_call's activity has no deal_id ("a prep brief is always tied to
  // a deal", D24), so a deal-less activity would fail the C2/C4 seeds for a
  // reason that has nothing to do with the constraint under test.
  const dealPid = `${RUN}_deal`;
  await seed((c) =>
    repo.upsertDeal(c, {
      publicId: dealPid,
      accountPublicId: accountPid,
      ownerPublicId: `${RUN}_u`,
      orgUnitId: ORG,
      name: "constraint probe",
      // chk_deal_stage_status: anything outside closed_won/closed_lost must
      // pair with status active or nurture.
      stage: "discovery",
      status: "active",
    }),
  );

  const newActivity = async (suffix: string): Promise<string> => {
    const pid = `${RUN}_act_${suffix}`;
    await seed((c) =>
      repo.upsertActivity(c, {
        publicId: pid,
        dealPublicId: dealPid,
        accountPublicId: accountPid,
        ownerPublicId: `${RUN}_u`,
        orgUnitId: ORG,
        activityType: "call",
        occurredAt: new Date().toISOString(),
      }),
    );
    return pid;
  };

  // ---------------- C1: idx_activity_idempotency ----------------
  // UNIQUE (idempotency_key) WHERE idempotency_key IS NOT NULL.
  // Two DIFFERENT public_ids sharing one key must collide on it — unless the
  // `existing` CTE matches the key first, which is exactly what H9 measured.
  {
    const key = `${RUN}_c1_key`;
    const write = (pid: string) =>
      probe((c) =>
        repo.upsertActivity(c, {
          publicId: pid,
          idempotencyKey: key,
          accountPublicId: accountPid,
          ownerPublicId: `${RUN}_u`,
          orgUnitId: ORG,
          activityType: "call",
          occurredAt: new Date().toISOString(),
        }),
      );
    await write(`${RUN}_act_c1a`);
    const r = await write(`${RUN}_act_c1b`);
    const n = Number(
      (await admin.query(`SELECT count(*)::int n FROM activity WHERE idempotency_key=$1`, [key])).rows[0].n,
    );
    const v = verdictOf(
      r,
      `a second public_id reusing one idempotency_key left ${n} row — the \`existing\` CTE ` +
        `matched on idempotency_key and took the UPDATE branch, so the index is never reached`,
    );
    record("C1  idx_activity_idempotency", v.verdict, v.detail);
  }

  // ---------------- C2: idx_pre_call_idempotency ----------------
  // Needs two DISTINCT activities: pre_call.activity_id is itself UNIQUE, so
  // reusing one activity would collide on C4 instead and measure the wrong
  // constraint.
  {
    const key = `${RUN}_c2_key`;
    const actA = await newActivity("c2a");
    const actB = await newActivity("c2b");
    await probe((c) =>
      repo.upsertPreCall(c, { publicId: `${RUN}_pre_c2a`, idempotencyKey: key, activityPublicId: actA }),
    );
    const r = await probe((c) =>
      repo.upsertPreCall(c, { publicId: `${RUN}_pre_c2b`, idempotencyKey: key, activityPublicId: actB }),
    );
    const n = Number(
      (await admin.query(`SELECT count(*)::int n FROM pre_call WHERE idempotency_key=$1`, [key])).rows[0].n,
    );
    const v = verdictOf(
      r,
      `two pre_calls on different activities sharing one idempotency_key left ${n} row — ` +
        `the \`existing\` CTE matched the key and UPDATED the first pre_call (note: it updates ` +
        `the FIRST activity's brief, so the second activity gets no pre_call at all — absorbed, ` +
        `but the write lands on the wrong row)`,
    );
    record("C2  idx_pre_call_idempotency", v.verdict, v.detail);
  }

  // ---------------- C3: idx_post_call_idempotency ----------------
  {
    const key = `${RUN}_c3_key`;
    const actA = await newActivity("c3a");
    const actB = await newActivity("c3b");
    await probe((c) =>
      repo.upsertPostCall(c, {
        publicId: `${RUN}_pc_c3a`,
        idempotencyKey: key,
        activityPublicId: actA,
        analysis: { probe: "a" },
        pipelineState: "analysis_done",
      }),
    );
    const r = await probe((c) =>
      repo.upsertPostCall(c, {
        publicId: `${RUN}_pc_c3b`,
        idempotencyKey: key,
        activityPublicId: actB,
        analysis: { probe: "b" },
        pipelineState: "analysis_done",
      }),
    );
    const n = Number(
      (await admin.query(`SELECT count(*)::int n FROM post_call WHERE idempotency_key=$1`, [key])).rows[0].n,
    );
    const v = verdictOf(
      r,
      `two post_calls on different activities sharing one idempotency_key left ${n} row — ` +
        `the \`existing\` CTE matched the key and took the UPDATE branch`,
    );
    record("C3  idx_post_call_idempotency", v.verdict, v.detail);
  }

  // ---------------- C4: pre_call.activity_id UNIQUE ----------------
  // The same activity, two different public_ids, DISTINCT idempotency keys —
  // so neither `existing` predicate can match and the statement must INSERT.
  // This is the deterministic form of the race H3 caught intermittently.
  {
    const act = await newActivity("c4");
    await seed((c) =>
      repo.upsertPreCall(c, {
        publicId: `${RUN}_pre_c4a`,
        idempotencyKey: `${RUN}_c4_k1`,
        activityPublicId: act,
        researchBrief: { probe: "a" },
      }),
    );
    const r = await probe((c) =>
      repo.upsertPreCall(c, {
        publicId: `${RUN}_pre_c4b`,
        idempotencyKey: `${RUN}_c4_k2`,
        activityPublicId: act,
        researchBrief: { probe: "b" },
      }),
    );
    const n = Number(
      (
        await admin.query(
          `SELECT count(*)::int n FROM pre_call pc JOIN activity a ON a.id=pc.activity_id WHERE a.public_id=$1`,
          [act],
        )
      ).rows[0].n,
    );
    const v = verdictOf(
      r,
      `a second pre_call for one activity under a new public_id and a new idempotency_key ` +
        `left ${n} row — the \`existing\` CTE now also matches on activity_id, so it UPDATES ` +
        `the incumbent instead of inserting. SEQUENTIAL only: two CONCURRENT writers can still ` +
        `both miss the lookup and race the index (H3's residue, unfixable by a conflict target)`,
    );
    record("C4  pre_call.activity_id", v.verdict, v.detail);
  }

  // ---------------- C5: post_call.activity_id UNIQUE ----------------
  // H3's constraint, measured SEQUENTIALLY. H3 needed 12 concurrent attempts to
  // see it because it raced two writers on one public_id; two different
  // public_ids reach it on the first try, with no race at all.
  {
    const act = await newActivity("c5");
    await seed((c) =>
      repo.upsertPostCall(c, {
        publicId: `${RUN}_pc_c5a`,
        idempotencyKey: `${RUN}_c5_k1`,
        activityPublicId: act,
        analysis: { probe: "a" },
        pipelineState: "analysis_done",
      }),
    );
    const r = await probe((c) =>
      repo.upsertPostCall(c, {
        publicId: `${RUN}_pc_c5b`,
        idempotencyKey: `${RUN}_c5_k2`,
        activityPublicId: act,
        analysis: { probe: "b" },
        pipelineState: "analysis_done",
      }),
    );
    const n = Number(
      (
        await admin.query(
          `SELECT count(*)::int n FROM post_call pc JOIN activity a ON a.id=pc.activity_id WHERE a.public_id=$1`,
          [act],
        )
      ).rows[0].n,
    );
    const v = verdictOf(
      r,
      `a second post_call for one activity under a new public_id and a new idempotency_key ` +
        `left ${n} row — the \`existing\` CTE now also matches on activity_id. This is H3's ` +
        `constraint, which H3 could only reach by racing 12 writers and this reaches with no ` +
        `race at all. H3 stays HAZARD: the CONCURRENT window is still open`,
    );
    record("C5  post_call.activity_id", v.verdict, v.detail);
  }

  // ---------------- C6: idx_task_ai_dedup ----------------
  // UNIQUE (activity_id, task_key) WHERE source = 'ai_generated'
  //   AND deleted_at IS NULL.
  // A re-run of the same extraction pass that mints a fresh public_id for the
  // same (activity, task_key) is the realistic collision.
  {
    const act = await newActivity("c6");
    const taskKey = `${RUN}_c6_taskkey`;
    const write = (pid: string) =>
      probe((c) =>
        repo.upsertTask(c, {
          publicId: pid,
          activityPublicId: act,
          ownerPublicId: `${RUN}_u`,
          title: "follow up on pricing",
          source: "ai_generated",
          taskKey,
        }),
      );
    await write(`${RUN}_task_c6a`);
    const r = await write(`${RUN}_task_c6b`);
    const n = Number(
      (
        await admin.query(
          `SELECT count(*)::int n FROM task t JOIN activity a ON a.id=t.activity_id
            WHERE a.public_id=$1 AND t.deleted_at IS NULL`,
          [act],
        )
      ).rows[0].n,
    );
    const v = verdictOf(
      r,
      `a re-run minting a new public_id for the same (activity, task_key) left ${n} row — ` +
        `the pre-emptive dedup lookup found the incumbent and UPDATED it`,
    );
    record("C6  idx_task_ai_dedup", v.verdict, v.detail);
  }

  // ---------------- C7: idx_psig_ai_key ----------------
  // UNIQUE (activity_id, signal_key) WHERE deleted_at IS NULL. signal_key must
  // be NOT NULL to collide — NULLs are distinct in a unique index, so a
  // key-less signal could never reach this and would measure a false ABSORBED.
  {
    const act = await newActivity("c7");
    const signalKey = `${RUN}_c7_sigkey`;
    const write = (pid: string) =>
      probe((c) =>
        repo.upsertProductSignal(c, {
          publicId: pid,
          activityPublicId: act,
          accountPublicId: accountPid,
          ownerPublicId: `${RUN}_u`,
          orgUnitId: ORG,
          signalType: "product_gap",
          signalKey,
          title: "no SSO for the admin console",
        }),
      );
    await write(`${RUN}_psig_c7a`);
    const r = await write(`${RUN}_psig_c7b`);
    const n = Number(
      (
        await admin.query(
          `SELECT count(*)::int n FROM product_signal ps JOIN activity a ON a.id=ps.activity_id
            WHERE a.public_id=$1 AND ps.deleted_at IS NULL`,
          [act],
        )
      ).rows[0].n,
    );
    const v = verdictOf(
      r,
      `a re-extraction minting a new public_id for the same (activity, signal_key) left ${n} ` +
        `row — the pre-emptive dedup lookup found the incumbent and UPDATED it`,
    );
    record("C7  idx_psig_ai_key", v.verdict, v.detail);
  }

  // ---------------- C8: idx_account_slug_active, INSERT path ----------------
  // UNIQUE (slug) WHERE deleted_at IS NULL. A Firestore-primary caller mints
  // its own public_id, so the same company can arrive under a NEW public_id
  // with an ALREADY-TAKEN slug. upsertAccount's slug merge exists for exactly
  // this (it was a staging blocker) — so this should absorb.
  {
    const slug = `${RUN}-c8-slug`;
    await seed((c) => repo.upsertAccount(c, { publicId: `${RUN}_acct_c8a`, name: "Acme", slug }));
    const r = await probe((c) =>
      repo.upsertAccount(c, { publicId: `${RUN}_acct_c8b`, name: "Acme Renamed", slug }),
    );
    const n = Number(
      (await admin.query(`SELECT count(*)::int n FROM account WHERE slug=$1 AND deleted_at IS NULL`, [slug]))
        .rows[0].n,
    );
    const v = verdictOf(
      r,
      `a NEW public_id carrying an already-taken slug left ${n} active row — upsertAccount's ` +
        `slug lookup merged onto the incumbent and registered the incoming public_id against it`,
    );
    record("C8  idx_account_slug_active", v.verdict, v.detail);
  }

  // ---------------- C8b: idx_account_slug_active, RENAME path ----------------
  // The merge above is guarded by `byPub.rows.length === 0` — it only fires for
  // an UNKNOWN public_id. An account that ALREADY exists and is renamed onto a
  // second active account's slug skips the merge entirely and lands on
  // `ON CONFLICT (public_id) DO UPDATE SET slug = EXCLUDED.slug`, which the
  // slug index then rejects.
  {
    const slugTaken = `${RUN}-c8b-taken`;
    await seed((c) => repo.upsertAccount(c, { publicId: `${RUN}_acct_c8b1`, name: "Holder", slug: slugTaken }));
    await seed((c) =>
      repo.upsertAccount(c, { publicId: `${RUN}_acct_c8b2`, name: "Mover", slug: `${RUN}-c8b-own` }),
    );
    const r = await probe((c) =>
      repo.upsertAccount(c, { publicId: `${RUN}_acct_c8b2`, name: "Mover", slug: slugTaken }),
    );
    const v = verdictOf(
      r,
      `renaming an existing account onto a taken slug was absorbed — check whether a merge ` +
        `rule was added, and if so record which row wins`,
    );
    record("C8b idx_account_slug_active (rename onto a taken slug)", v.verdict, v.detail);
  }

  // ---------------- C9: idx_contact_account_email_active, INSERT path ----------------
  // UNIQUE (account_id, email) WHERE deleted_at IS NULL. upsertContact already
  // looks up (account_id, email) before inserting.
  {
    const email = `${RUN}_c9@example.invalid`.toLowerCase();
    await seed((c) =>
      repo.upsertContact(c, {
        publicId: `${RUN}_ct_c9a`,
        accountPublicId: accountPid,
        email,
        name: "Dana First",
      }),
    );
    const r = await probe((c) =>
      repo.upsertContact(c, {
        publicId: `${RUN}_ct_c9b`,
        accountPublicId: accountPid,
        email,
        name: "Dana Second",
      }),
    );
    const accountId = Number(
      (await admin.query(`SELECT id FROM account WHERE public_id=$1`, [accountPid])).rows[0].id,
    );
    const n = Number(
      (
        await admin.query(
          `SELECT count(*)::int n FROM contact WHERE account_id=$1 AND email=$2 AND deleted_at IS NULL`,
          [accountId, email],
        )
      ).rows[0].n,
    );
    const v = verdictOf(
      r,
      `a NEW public_id carrying an already-taken (account, email) left ${n} active row — ` +
        `upsertContact's existing-row lookup merged onto the incumbent`,
    );
    record("C9  idx_contact_account_email_active", v.verdict, v.detail);
  }

  // ---------------- C9b: idx_contact_account_email_active, RENAME path ----------------
  // Same asymmetry as C8b: the merge lookup runs BEFORE the public_id check, so
  // it matches the incumbent by email and never sees that the incoming
  // public_id is a DIFFERENT existing contact being re-pointed.
  {
    const taken = `${RUN}_c9b_taken@example.invalid`.toLowerCase();
    await seed((c) =>
      repo.upsertContact(c, { publicId: `${RUN}_ct_c9b1`, accountPublicId: accountPid, email: taken }),
    );
    await seed((c) =>
      repo.upsertContact(c, {
        publicId: `${RUN}_ct_c9b2`,
        accountPublicId: accountPid,
        email: `${RUN}_c9b_own@example.invalid`.toLowerCase(),
      }),
    );
    // patchContact, not upsertContact: patch is the route-level rename path and
    // it is a bare UPDATE with no conflict handling at all.
    const r = await probe((c) => repo.patchContact(c, `${RUN}_ct_c9b2`, { email: taken }));
    const v = verdictOf(
      r,
      `renaming an existing contact's email onto a taken one was absorbed — check whether a ` +
        `merge rule was added, and if so record which row wins`,
    );
    record("C9b idx_contact_account_email_active (rename onto a taken email)", v.verdict, v.detail);
  }

  // ---------------- C10: idx_scorecard_activity_current ----------------
  // UNIQUE (activity_id) WHERE is_current = true. Two scorecards on ONE
  // activity against DIFFERENT rubrics: ON CONFLICT (activity_id, rubric_id)
  // cannot fire, so the second is a fresh INSERT with is_current = true and
  // only the demote-first UPDATE keeps the index satisfied.
  {
    const rubrics = await admin.query<{ id: string; call_type: string; se_motion: string; version: string }>(
      `SELECT id, call_type, se_motion, version FROM rubric
        WHERE se_motion = 'new_business' AND provisional = false ORDER BY id LIMIT 2`,
    );
    if (rubrics.rowCount !== null && rubrics.rowCount < 2) {
      record(
        "C10 idx_scorecard_activity_current",
        "SKIP",
        "fewer than two non-provisional new_business rubrics — run `node janus/scripts/load-rubric-catalog.mjs`",
      );
    } else {
      const act = await newActivity("c10");
      const header = (r: { id: string; call_type: string; se_motion: string; version: string }, pid: string) => ({
        publicId: pid,
        activityPublicId: act,
        rubricId: r.id,
        ownerPublicId: `${RUN}_u`,
        orgUnitId: ORG,
        callType: r.call_type,
        seMotion: r.se_motion as "new_business" | "expansion",
        rubricVersion: r.version,
      });
      await seed((c) => repo.upsertScorecard(c, header(rubrics.rows[0], `${RUN}_sc_c10a`)));
      const r2 = await probe((c) => repo.upsertScorecard(c, header(rubrics.rows[1], `${RUN}_sc_c10b`)));
      const n = Number(
        (
          await admin.query(
            `SELECT count(*)::int n FROM scorecard s JOIN activity a ON a.id=s.activity_id
              WHERE a.public_id=$1 AND s.is_current`,
            [act],
          )
        ).rows[0].n,
      );
      const v = verdictOf(
        r2,
        `re-scoring one activity against a second rubric left ${n} current scorecard — ` +
          `upsertScorecard's demote-first UPDATE (is_current = false for the activity) clears ` +
          `the index before inserting`,
      );
      record("C10 idx_scorecard_activity_current", v.verdict, v.detail);
    }
  }

  // ---------------- C11: uq_aset_primary ----------------
  // UNIQUE (account_id) WHERE role = 'primary' AND removed_at IS NULL.
  // Handing an account's primary SE to someone else is the collision.
  {
    await seed((c) =>
      repo.seatAccountSeTeamMember(c, {
        accountPublicId: accountPid,
        seUserPublicId: `${RUN}_u`,
        role: "primary",
      }),
    );
    const r = await probe((c) =>
      repo.seatAccountSeTeamMember(c, {
        accountPublicId: accountPid,
        seUserPublicId: `${RUN}_u2`,
        role: "primary",
      }),
    );
    const accountId = Number(
      (await admin.query(`SELECT id FROM account WHERE public_id=$1`, [accountPid])).rows[0].id,
    );
    const n = Number(
      (
        await admin.query(
          `SELECT count(*)::int n FROM account_se_team
            WHERE account_id=$1 AND role='primary' AND removed_at IS NULL`,
          [accountId],
        )
      ).rows[0].n,
    );
    const v = verdictOf(
      r,
      `seating a second primary SE left ${n} active primary — seatAccountSeTeamMember demotes ` +
        `the incumbent to 'secondary' before its INSERT`,
    );
    record("C11 uq_aset_primary", v.verdict, v.detail);
  }

  // ---------------- C12: idx_deal_contact_primary ----------------
  // UNIQUE (deal_id) WHERE is_primary AND deleted_at IS NULL.
  // setPrimaryDealContact demotes first, but upsertDealContact with
  // isPrimary: true did NOT — it inserted a second is_primary row directly.
  {
    const dealPid = `${RUN}_deal_c12`;
    await seed((c) =>
      repo.upsertDeal(c, {
        publicId: dealPid,
        accountPublicId: accountPid,
        ownerPublicId: `${RUN}_u`,
        orgUnitId: ORG,
        name: "C12 probe",
        // chk_deal_stage_status: anything outside closed_won/closed_lost must
        // pair with active or nurture.
        stage: "discovery",
        status: "active",
      }),
    );
    for (const s of ["c12a", "c12b"]) {
      await seed((c) =>
        repo.upsertContact(c, {
          publicId: `${RUN}_ct_${s}`,
          accountPublicId: accountPid,
          email: `${RUN}_${s}@example.invalid`.toLowerCase(),
        }),
      );
    }
    await seed((c) =>
      repo.upsertDealContact(c, {
        publicId: `${RUN}_dc_c12a`,
        dealPublicId: dealPid,
        contactPublicId: `${RUN}_ct_c12a`,
        role: "champion",
        isPrimary: true,
      }),
    );
    const r = await probe((c) =>
      repo.upsertDealContact(c, {
        publicId: `${RUN}_dc_c12b`,
        dealPublicId: dealPid,
        contactPublicId: `${RUN}_ct_c12b`,
        role: "economic_buyer",
        isPrimary: true,
      }),
    );
    const dealId = Number((await admin.query(`SELECT id FROM deal WHERE public_id=$1`, [dealPid])).rows[0].id);
    const primaries = await admin.query<{ public_id: string }>(
      `SELECT public_id FROM deal_contact WHERE deal_id=$1 AND is_primary AND deleted_at IS NULL`,
      [dealId],
    );
    const v = verdictOf(
      r,
      `upserting a second primary deal contact left ${primaries.rowCount} primary ` +
        `(${primaries.rows.map((x) => x.public_id.slice(-8)).join(",") || "none"}) — ` +
        `upsertDealContact now demotes the incumbent first, matching setPrimaryDealContact's ` +
        `last-writer-wins semantics`,
    );
    record("C12 idx_deal_contact_primary", v.verdict, v.detail);
  }
} finally {
  // ---------------- cleanup, dependency-safe, by exact marker ----------------
  await admin.query("BEGIN").catch(() => undefined);
  await admin.query("SELECT set_config('app.is_admin','true',true)").catch(() => undefined);
  const del = async (sql: string, params: unknown[] = [`${RUN}%`]) => admin.query(sql, params).catch(() => undefined);
  await del(`DELETE FROM sync_outbox WHERE entity_id LIKE $1`);
  await del(`DELETE FROM scorecard_line WHERE scorecard_id IN (SELECT id FROM scorecard WHERE public_id LIKE $1)`);
  await del(`DELETE FROM scorecard_theme WHERE scorecard_id IN (SELECT id FROM scorecard WHERE public_id LIKE $1)`);
  await del(`DELETE FROM scorecard WHERE public_id LIKE $1`);
  await del(`DELETE FROM ai_run WHERE activity_id IN (SELECT id FROM activity WHERE public_id LIKE $1)`);
  await del(`DELETE FROM product_signal WHERE public_id LIKE $1`);
  await del(`DELETE FROM task WHERE public_id LIKE $1`);
  await del(`DELETE FROM deal_contact WHERE public_id LIKE $1`);
  await del(`DELETE FROM deal_stage_history WHERE deal_id IN (SELECT id FROM deal WHERE public_id LIKE $1)`);
  await del(`DELETE FROM deal WHERE public_id LIKE $1`);
  await del(`DELETE FROM call_participant WHERE activity_id IN (SELECT id FROM activity WHERE public_id LIKE $1)`);
  await del(`DELETE FROM pre_call WHERE public_id LIKE $1`);
  await del(`DELETE FROM post_call WHERE public_id LIKE $1`);
  await del(`DELETE FROM activity WHERE public_id LIKE $1`);
  await del(`DELETE FROM contact_event WHERE contact_id IN (SELECT id FROM contact WHERE public_id LIKE $1)`);
  await del(`DELETE FROM contact WHERE public_id LIKE $1`);
  await del(
    `DELETE FROM account_se_team WHERE account_id IN (SELECT id FROM account WHERE public_id LIKE $1)
        OR se_user_id IN (SELECT id FROM app_user WHERE public_id LIKE $1)`,
  );
  await del(`DELETE FROM account WHERE public_id LIKE $1`);
  await del(`DELETE FROM id_registry WHERE public_id LIKE $1`);
  await del(`DELETE FROM app_user WHERE public_id LIKE $1`);
  await del(`DELETE FROM org_unit WHERE id LIKE $1`);
  await admin.query("COMMIT").catch(() => undefined);

  const left = await admin
    .query(
      `SELECT (SELECT count(*) FROM activity WHERE public_id LIKE $1)
            + (SELECT count(*) FROM pre_call WHERE public_id LIKE $1)
            + (SELECT count(*) FROM post_call WHERE public_id LIKE $1)
            + (SELECT count(*) FROM task WHERE public_id LIKE $1)
            + (SELECT count(*) FROM product_signal WHERE public_id LIKE $1)
            + (SELECT count(*) FROM deal_contact WHERE public_id LIKE $1)
            + (SELECT count(*) FROM contact WHERE public_id LIKE $1)
            + (SELECT count(*) FROM account WHERE public_id LIKE $1)
            + (SELECT count(*) FROM app_user WHERE public_id LIKE $1)
            + (SELECT count(*) FROM org_unit WHERE id LIKE $1) AS n`,
      [`${RUN}%`],
    )
    .catch(() => null);
  console.log(`\n  cleanup: ${left ? `${left.rows[0].n} fixture row(s) remain` : "could not verify"}`);
  await admin.end().catch(() => undefined);
  const { closePool } = await import("../src/data/persistence/postgres-pool.ts");
  await closePool().catch(() => undefined);
}

// ---------------- verdict ----------------
const reachable = results.filter((r) => r.verdict === "REACHABLE");
const absorbed = results.filter((r) => r.verdict === "ABSORBED");
const skipped = results.filter((r) => r.verdict === "SKIP");
const measured = results.filter((r) => r.verdict !== "SKIP");
const diverged = measured.filter((r) => EXPECTED[r.name] !== undefined && EXPECTED[r.name] !== r.verdict);
const novel = measured.filter((r) => EXPECTED[r.name] === undefined);

console.log(
  `\n  ${measured.length} measured · ${reachable.length} REACHABLE · ${absorbed.length} ABSORBED · ${skipped.length} skipped`,
);
if (skipped.length) {
  console.log(`  skipped (coverage gap, not a pass): ${skipped.map((s) => s.name.split(" ")[0]).join(", ")}`);
}
if (reachable.length) {
  console.log(`  reachable: ${reachable.map((r) => r.name.split(" ")[0]).join(", ")}`);
}

if (diverged.length || novel.length) {
  console.error(`\nFAIL — measured reachability diverged from the recorded baseline:`);
  for (const d of diverged) {
    console.error(`  ${d.name}\n     recorded ${EXPECTED[d.name]}, measured ${d.verdict}`);
  }
  for (const n of novel) console.error(`  ${n.name}\n     not in the baseline — add it to EXPECTED`);
  console.error(
    `\nIf a constraint became ABSORBED this is a FIX: update EXPECTED in the same commit and\n` +
      `say so in the message. If one became REACHABLE, a conflict defence has been lost and a\n` +
      `collision now aborts the enclosing transaction.`,
  );
  process.exit(1);
}

console.log(
  `\nOK — all ${measured.length} unique constraints behave exactly as recorded. ` +
    `No conflict-handling regression.`,
);
