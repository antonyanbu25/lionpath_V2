#!/usr/bin/env tsx
/**
 * ASTRA AUDIT REPRO — F-005 / H1 and F-006 / H3
 * Destructive `detail = EXCLUDED.detail` UPSERT + pipeline_state regression.
 *
 * AUDIT ARTEFACT ONLY. Disposable local database only. Cleans up after itself.
 *
 * Why this matters even though F-001 currently masks it
 * ----------------------------------------------------
 * Today the two post_call writers use different idempotency keys, so the second
 * one raises 23505 (see repro-h2-...) and the ON CONFLICT branch is never taken.
 * The moment F-001 is "fixed" by aligning the keys, the ON CONFLICT branch
 * becomes live — and it is destructive. This repro exercises that branch
 * directly, so the remediation order (fix H1 BEFORE H2) is evidence-based.
 *
 * Writer under test: PostgresRepository.upsertPostCall
 *   postgres-repository.ts:424-429
 *     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET
 *       ... detail = EXCLUDED.detail, pipeline_state = EXCLUDED.pipeline_state ...
 * Caller under test: tryHistoryPostCallSqlWrite
 *   routes.ts:2996  detail: null
 *   routes.ts:3000  pipelineState: "analysis_done"
 *
 * Usage:
 *   DATABASE_URL=postgresql://janus_app:...@127.0.0.1:<port>/janus \
 *     npx tsx docs/astra-audit/repros/repro-h1-detail-erasure-and-pipeline-regression.ts
 */
import {
  closePool, PostgresRepository, upsertAppUser, upsertOrgUnit, withSystemContext,
} from "../../../worker/src/data/persistence/index.ts";
import type { PgClient, PostgresEnv } from "../../../worker/src/data/persistence/index.ts";

const env: PostgresEnv = { DATABASE_URL: process.env.DATABASE_URL };
const repo = new PostgresRepository();

const ORG = "__astra_h1_org__";
const OWNER = "__astra_h1_user__";
const ACCOUNT = "__astra_h1_account__";
const POSTCALL = "pc_astra_h1_0001";
const ACTIVITY = `act_${POSTCALL}`;
const KEY = "call_zoom:astrah1abc";   // SAME key for both writes — the post-F-001-fix world

async function cleanup(client: PgClient) {
  await client.query(`DELETE FROM post_call WHERE public_id = $1 OR idempotency_key = $2`, [POSTCALL, KEY]);
  await client.query(`DELETE FROM id_registry WHERE public_id = ANY($1::text[])`, [[POSTCALL, ACTIVITY, ACCOUNT, OWNER]]);
  await client.query(`DELETE FROM activity WHERE public_id = $1 OR idempotency_key = $2`, [ACTIVITY, KEY]);
  await client.query(`DELETE FROM account WHERE public_id = $1`, [ACCOUNT]);
  await client.query(`DELETE FROM app_user WHERE public_id = $1 OR email = $2`, [OWNER, "astra-h1@example.com"]);
  await client.query(`DELETE FROM org_unit WHERE id = $1`, [ORG]);
}

async function main() {
await withSystemContext(async (client) => {
  await cleanup(client);
  await upsertOrgUnit(client, { id: ORG, name: "Astra H1 repro", unitType: "squad", path: `/${ORG}/` });
  await upsertAppUser(client, { publicId: OWNER, email: "astra-h1@example.com", displayName: "Astra H1", orgUnitId: ORG });
  await repo.upsertAccount(client, { publicId: ACCOUNT, name: "Astra H1 Account", domain: "astra-h1.example.com" });
  await repo.upsertActivity(client, {
    publicId: ACTIVITY, idempotencyKey: KEY, accountPublicId: ACCOUNT, ownerPublicId: OWNER,
    orgUnitId: ORG, activityType: "call", subject: "Call", occurredAt: "2026-09-08T10:00:00.000Z",
  });

  // ---- STEP 1: a fully hydrated post_call, as the domain writer would leave it
  await repo.upsertPostCall(client, {
    publicId: POSTCALL, idempotencyKey: KEY, activityPublicId: ACTIVITY,
    transcriptRef: "gs://astra/transcript.txt",
    analysis: { callHeader: { company: "Astra H1" }, marker: "hydrated" },
    detail: {
      followUps: [{ id: "fu_1", text: "send pricing" }, { id: "fu_2", text: "loop in security" }],
      objections: [{ id: "ob_1", text: "no SSO" }],
      videoFacts: [{ id: "vf_1", slidesShown: 12 }],
      timelineSegments: [{ id: "ts_1", label: "discovery" }],
      technicalCommit: { status: "committed" },
    },
    pipelineState: "signals_done",          // the state a FINISHED pipeline should carry
    analysisShapeVersion: "1", detailShapeVersion: "2",
  });
  const before = await client.query(
    `SELECT pipeline_state, detail_shape_version, transcript_ref,
            jsonb_array_length(COALESCE(detail->'followUps','[]'::jsonb))  AS follow_ups,
            jsonb_array_length(COALESCE(detail->'objections','[]'::jsonb)) AS objections,
            jsonb_array_length(COALESCE(detail->'videoFacts','[]'::jsonb)) AS video_facts,
            detail->'technicalCommit'->>'status' AS tc_status
     FROM post_call WHERE public_id = $1`, [POSTCALL]);
  console.log("[1] hydrated row:", JSON.stringify(before.rows[0]));

  // ---- STEP 2: ONE ordinary history patch — exactly tryHistoryPostCallSqlWrite's payload
  await repo.upsertPostCall(client, {
    publicId: POSTCALL, idempotencyKey: KEY, activityPublicId: ACTIVITY,
    transcriptRef: null,                     // rec.detailGcsUri/transcriptRef absent on a history record
    analysis: { callHeader: { company: "Astra H1" }, marker: "history-patch" },
    detail: null,                            // routes.ts:2996
    pipelineState: "analysis_done",          // routes.ts:3000
    analysisShapeVersion: "1", detailShapeVersion: "1",
  });
  const after = await client.query(
    `SELECT pipeline_state, detail_shape_version, transcript_ref, detail IS NULL AS detail_null,
            analysis->>'marker' AS marker
     FROM post_call WHERE public_id = $1`, [POSTCALL]);
  console.log("[2] after ONE history patch:", JSON.stringify(after.rows[0]));

  console.log("\n=== VERDICT ===");
  const r = after.rows[0];
  const erased = r.detail_null === true;
  const regressed = r.pipeline_state === "analysis_done";
  const refLost = r.transcript_ref === null;
  console.log(`detail erased to NULL ............ ${erased ? "YES — DATA LOSS" : "no"}`);
  console.log(`pipeline_state regressed ......... ${regressed ? "YES (signals_done -> analysis_done)" : "no"}`);
  console.log(`transcript_ref cleared ........... ${refLost ? "YES" : "no"}`);
  console.log(`detail_shape_version rolled back . ${r.detail_shape_version === "1" ? "YES (2 -> 1)" : "no"}`);
  if (erased && regressed) {
    console.log("\nCONFIRMED: a single history patch destroys every post_call.detail collection");
    console.log("(followUps, objections, videoFacts, timelineSegments, technicalCommit) and");
    console.log("regresses pipeline_state. No merge, no COALESCE, no guard.");
    console.log("Contrast routes.ts:2400-2409, which does the same job non-destructively:");
    console.log("  UPDATE post_call SET analysis = COALESCE($2::jsonb, analysis),");
    console.log("                       detail   = COALESCE($3::jsonb, detail)");
  }

  await cleanup(client);
  const proof = await client.query(
    `SELECT (SELECT count(*)::int FROM post_call WHERE public_id=$1) pc,
            (SELECT count(*)::int FROM activity  WHERE public_id=$2) act,
            (SELECT count(*)::int FROM account   WHERE public_id=$3) acct,
            (SELECT count(*)::int FROM app_user  WHERE public_id=$4) usr,
            (SELECT count(*)::int FROM org_unit  WHERE id=$5) org`,
    [POSTCALL, ACTIVITY, ACCOUNT, OWNER, ORG]);
  console.log(`\n[cleanup] leftover fixture rows: ${JSON.stringify(proof.rows[0])}`);
}, env);
await closePool();
}
main().catch((e) => { console.error(e); process.exit(1); });
