#!/usr/bin/env tsx
/**
 * ASTRA AUDIT REPRO — F-001 / H2
 * Dual-writer idempotency-key collision on `post_call`.
 *
 * AUDIT ARTEFACT ONLY. Read-only with respect to product code; it creates and
 * then removes its own uniquely-named synthetic fixtures. Run ONLY against a
 * disposable local database.
 *
 * What it proves
 * --------------
 * In the existing-account post-call flow the two SQL writers run in this order:
 *   1. POST /api/history  -> tryHistoryPostCallSqlWrite  (routes.ts:2915)
 *        idempotencyKey = `call_${rec.callIdentityKey || id}`  (routes.ts:2976)
 *        The history record built by web/history.js:savePostCallAnalysis has NO
 *        callIdentityKey field, so this is ALWAYS `call_<postCallPublicId>`.
 *   2. POST /api/domain-write -> upsertPostCallWithSummary   (routes.ts:2727)
 *        idempotencyKey = `call_${postCall.callIdentityKey || id}` (routes.ts:2729)
 *        web/domain/dual-write.js:233 always sets callIdentityKey, so this is
 *        `call_zoom:<recordingId>` for any call with a Zoom link.
 *
 * Both writers use the SAME post_call.public_id but DIFFERENT idempotency_key.
 * PostgresRepository.upsertPostCall conflict-targets only the partial unique
 * index on idempotency_key (postgres-repository.ts:424), while public_id and
 * activity_id are both plain UNIQUE (02_phase2_activities.sql:88,90).
 * The second writer therefore raises 23505 instead of updating.
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres:...@127.0.0.1:<port>/janus \
 *     npx tsx docs/astra-audit/repros/repro-h2-dual-writer-idempotency-collision.ts
 */
import {
  closePool,
  PostgresRepository,
  upsertAppUser,
  upsertOrgUnit,
  withSystemContext,
} from "../../../worker/src/data/persistence/index.ts";
import type { PgClient, PostgresEnv } from "../../../worker/src/data/persistence/index.ts";

const env: PostgresEnv = { DATABASE_URL: process.env.DATABASE_URL };
const repo = new PostgresRepository();

const ORG = "__astra_h2_org__";
const OWNER = "__astra_h2_user__";
const ACCOUNT = "__astra_h2_account__";
const POSTCALL = "pc_astra_h2_0001";           // the ONE public_id both writers use
const ACTIVITY = `act_${POSTCALL}`;            // both writers derive this identically
const HISTORY_KEY = `call_${POSTCALL}`;        // writer 1 (no callIdentityKey on the record)
const DOMAIN_KEY = "call_zoom:astrah2abc";     // writer 2 (callIdentityKey from the Zoom link)

async function cleanup(client: PgClient) {
  await client.query(`DELETE FROM post_call WHERE public_id = $1 OR idempotency_key = ANY($2::text[])`,
    [POSTCALL, [HISTORY_KEY, DOMAIN_KEY]]);
  await client.query(`DELETE FROM id_registry WHERE public_id = ANY($1::text[])`,
    [[POSTCALL, ACTIVITY, ACCOUNT, OWNER]]);
  await client.query(`DELETE FROM activity WHERE public_id = $1 OR idempotency_key = ANY($2::text[])`,
    [ACTIVITY, [HISTORY_KEY, DOMAIN_KEY]]);
  await client.query(`DELETE FROM account WHERE public_id = $1`, [ACCOUNT]);
  await client.query(`DELETE FROM app_user WHERE public_id = $1 OR email = $2`, [OWNER, "astra-h2@example.com"]);
  await client.query(`DELETE FROM org_unit WHERE id = $1`, [ORG]);
}

async function seed(client: PgClient) {
  await upsertOrgUnit(client, { id: ORG, name: "Astra H2 repro", unitType: "squad", path: `/${ORG}/` });
  await upsertAppUser(client, { publicId: OWNER, email: "astra-h2@example.com", displayName: "Astra H2", orgUnitId: ORG });
  await repo.upsertAccount(client, { publicId: ACCOUNT, name: "Astra H2 Account", domain: "astra-h2.example.com" });
}

function activityRow(idempotencyKey: string, subject: string) {
  return {
    publicId: ACTIVITY, idempotencyKey, accountPublicId: ACCOUNT, ownerPublicId: OWNER,
    orgUnitId: ORG, activityType: "call" as const, subject,
    occurredAt: "2026-09-08T10:00:00.000Z",
  };
}

const results: string[] = [];
function record(line: string) { results.push(line); console.log(line); }

async function main() {
await withSystemContext(async (client) => {
  await cleanup(client);
  await seed(client);

  // ---- WRITER 1: POST /api/history -----------------------------------------
  await repo.upsertActivity(client, activityRow(HISTORY_KEY, "Call"));
  const firstId = await repo.upsertPostCall(client, {
    publicId: POSTCALL, idempotencyKey: HISTORY_KEY, activityPublicId: ACTIVITY,
    analysis: { callHeader: { company: "Astra H2" }, marker: "history-writer" },
    detail: null,                                  // routes.ts:2996 — always null
    pipelineState: "analysis_done",                // routes.ts:3000 — always this
    analysisShapeVersion: "1", detailShapeVersion: "1",
  });
  record(`[1] history writer inserted post_call id=${firstId} idempotency_key=${HISTORY_KEY}`);

  const after1 = await client.query(
    `SELECT idempotency_key, pipeline_state, detail IS NULL AS detail_null FROM post_call WHERE public_id = $1`,
    [POSTCALL]);
  record(`[1] row state: ${JSON.stringify(after1.rows[0])}`);

  // ---- WRITER 2: POST /api/domain-write ------------------------------------
  // Inside ONE transaction, exactly as trySqlDomainWrite/withSessionContext do.
  await client.query("SAVEPOINT astra_domain_write");
  let domainOutcome: string;
  try {
    await repo.upsertActivity(client, activityRow(DOMAIN_KEY, "Call"));
    record(`[2] domain writer upsertActivity OK (CTE resolved on public_id — activity is safe)`);
    await repo.upsertPostCall(client, {
      publicId: POSTCALL, idempotencyKey: DOMAIN_KEY, activityPublicId: ACTIVITY,
      analysis: { callHeader: { company: "Astra H2" }, marker: "domain-writer" },
      detail: { followUps: [{ id: "fu_1", text: "send pricing" }] },
      pipelineState: "analysis_done",
      analysisShapeVersion: "1", detailShapeVersion: "1",
    });
    domainOutcome = "NO ERROR — post_call upsert succeeded";
    record(`[2] UNEXPECTED: ${domainOutcome}`);
  } catch (err) {
    const e = err as { code?: string; constraint?: string; message?: string };
    domainOutcome = `${e.code} on constraint ${e.constraint}`;
    record(`[2] domain writer upsertPostCall FAILED: ${domainOutcome}`);
    record(`[2] message: ${e.message}`);
    await client.query("ROLLBACK TO SAVEPOINT astra_domain_write");
  }

  // ---- CONSEQUENCE ---------------------------------------------------------
  const final = await client.query(
    `SELECT idempotency_key, analysis->>'marker' AS marker, detail IS NULL AS detail_null, pipeline_state
     FROM post_call WHERE public_id = $1`, [POSTCALL]);
  record(`[3] FINAL row: ${JSON.stringify(final.rows[0])}`);
  const dupes = await client.query(`SELECT count(*)::int AS n FROM post_call WHERE public_id = $1`, [POSTCALL]);
  record(`[3] rows for public_id ${POSTCALL}: ${dupes.rows[0].n}`);

  console.log("\n=== VERDICT ===");
  if (/23505/.test(domainOutcome)) {
    console.log("CONFIRMED: the domain dual-write aborts with a unique violation.");
    console.log("Everything linkPostCallToLifecycle does AFTER attachPostCall — scorecard,");
    console.log("participants, videoFacts, timeline, followUps, objections, MoM, qualification,");
    console.log("technicalCommit, deal traction (Pass 8), ARR, product gaps, deal/account");
    console.log("summaries (Pass 9), contact frameworks, identity stamping — never executes.");
  } else {
    console.log("NOT REPRODUCED — re-examine the writer key derivation.");
  }

  await cleanup(client);
  const proof = await client.query(
    `SELECT (SELECT count(*)::int FROM post_call WHERE public_id = $1) AS pc,
            (SELECT count(*)::int FROM activity WHERE public_id = $2) AS act,
            (SELECT count(*)::int FROM account  WHERE public_id = $3) AS acct,
            (SELECT count(*)::int FROM app_user WHERE public_id = $4) AS usr,
            (SELECT count(*)::int FROM org_unit WHERE id = $5)        AS org`,
    [POSTCALL, ACTIVITY, ACCOUNT, OWNER, ORG]);
  console.log(`\n[cleanup] leftover fixture rows: ${JSON.stringify(proof.rows[0])}`);
}, env);

await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
