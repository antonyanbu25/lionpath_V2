#!/usr/bin/env tsx
/**
 * ASTRA AUDIT — POST-REBASE VERIFICATION (2026-09-09)
 * Re-runs the F-001 / F-005 scenario against commit 0dfd6b1
 * ("fix(worker): make upsertPostCall race-safe on public_id, not just
 * idempotency_key") to check whether the teammate's fix (a) resolves F-001
 * and (b) reintroduces F-005 now that the masking 23505 is gone.
 *
 * AUDIT ARTEFACT ONLY. Disposable local database only. Cleans up after itself.
 */
import {
  closePool, PostgresRepository, upsertAppUser, upsertOrgUnit, withSystemContext,
} from "../../../worker/src/data/persistence/index.ts";
import type { PgClient, PostgresEnv } from "../../../worker/src/data/persistence/index.ts";

const env: PostgresEnv = { DATABASE_URL: process.env.DATABASE_URL };
const repo = new PostgresRepository();

const ORG = "__astra_verify_org__";
const OWNER = "__astra_verify_user__";
const ACCOUNT = "__astra_verify_account__";
const POSTCALL = "pc_astra_verify_0001";
const ACTIVITY = `act_${POSTCALL}`;
const HISTORY_KEY = `call_${POSTCALL}`;
const DOMAIN_KEY = "call_zoom:astraverifyabc";

async function cleanup(client: PgClient) {
  await client.query(`DELETE FROM post_call WHERE public_id = $1 OR idempotency_key = ANY($2::text[])`,
    [POSTCALL, [HISTORY_KEY, DOMAIN_KEY]]);
  await client.query(`DELETE FROM id_registry WHERE public_id = ANY($1::text[])`,
    [[POSTCALL, ACTIVITY, ACCOUNT, OWNER]]);
  await client.query(`DELETE FROM activity WHERE public_id = $1 OR idempotency_key = ANY($2::text[])`,
    [ACTIVITY, [HISTORY_KEY, DOMAIN_KEY]]);
  await client.query(`DELETE FROM account WHERE public_id = $1`, [ACCOUNT]);
  await client.query(`DELETE FROM app_user WHERE public_id = $1 OR email = $2`, [OWNER, "astra-verify@example.com"]);
  await client.query(`DELETE FROM org_unit WHERE id = $1`, [ORG]);
}

async function main() {
await withSystemContext(async (client) => {
  await cleanup(client);
  await upsertOrgUnit(client, { id: ORG, name: "Astra verify", unitType: "squad", path: `/${ORG}/` });
  await upsertAppUser(client, { publicId: OWNER, email: "astra-verify@example.com", displayName: "Astra Verify", orgUnitId: ORG });
  await repo.upsertAccount(client, { publicId: ACCOUNT, name: "Astra Verify Account", domain: "astra-verify.example.com" });
  await repo.upsertActivity(client, {
    publicId: ACTIVITY, idempotencyKey: HISTORY_KEY, accountPublicId: ACCOUNT, ownerPublicId: OWNER,
    orgUnitId: ORG, activityType: "call", subject: "Call", occurredAt: "2026-09-09T10:00:00.000Z",
  });

  // ---- WRITER 1: history path (hydrated content, as if the user's call
  // already went through summarise/gaps/video before this SQL projection ran)
  const w1 = await repo.upsertPostCall(client, {
    publicId: POSTCALL, idempotencyKey: HISTORY_KEY, activityPublicId: ACTIVITY,
    transcriptRef: "gs://astra/transcript.txt",
    analysis: { callHeader: { company: "Astra Verify" }, marker: "history-writer-1" },
    detail: { followUps: [{ id: "fu_1", text: "send pricing" }], objections: [{ id: "ob_1", text: "no SSO" }] },
    pipelineState: "signals_done",
    analysisShapeVersion: "1", detailShapeVersion: "2",
  });
  console.log(`[1] history writer #1 (hydrated) inserted id=${w1}`);

  // ---- WRITER 2: domain-write path fires next (different idempotency key,
  // this is the exact F-001 collision) — BEFORE the fix this threw 23505.
  let domainOutcome = "no error";
  try {
    await repo.upsertActivity(client, {
      publicId: ACTIVITY, idempotencyKey: DOMAIN_KEY, accountPublicId: ACCOUNT, ownerPublicId: OWNER,
      orgUnitId: ORG, activityType: "call", subject: "Call", occurredAt: "2026-09-09T10:00:00.000Z",
    });
    await repo.upsertPostCall(client, {
      publicId: POSTCALL, idempotencyKey: DOMAIN_KEY, activityPublicId: ACTIVITY,
      analysis: { callHeader: { company: "Astra Verify" }, marker: "domain-writer" },
      detail: null,               // dual-write.js's postCallDraft has no detail key -- E-040
      pipelineState: "analysis_done",
      analysisShapeVersion: "1", detailShapeVersion: "1",
    });
  } catch (err) {
    domainOutcome = (err as Error).message;
  }
  console.log(`[2] domain writer outcome: ${domainOutcome}`);

  // ---- WRITER 3: a LATER history patch, same shape tryHistoryPostCallSqlWrite
  // sends today (routes.ts:3055-3066) -- detail: null, pipelineState: "analysis_done"
  await repo.upsertPostCall(client, {
    publicId: POSTCALL, idempotencyKey: HISTORY_KEY, activityPublicId: ACTIVITY,
    transcriptRef: null,
    analysis: { callHeader: { company: "Astra Verify" }, marker: "history-writer-2-later-patch" },
    detail: null,                 // routes.ts:3061, unchanged by the rebase
    pipelineState: "analysis_done",
    analysisShapeVersion: "1", detailShapeVersion: "1",
  });

  const final = await client.query(
    `SELECT idempotency_key, analysis->>'marker' AS marker, detail IS NULL AS detail_null,
            transcript_ref, pipeline_state, detail_shape_version
     FROM post_call WHERE public_id = $1`, [POSTCALL]);
  const dupes = await client.query(`SELECT count(*)::int AS n FROM post_call WHERE public_id = $1`, [POSTCALL]);

  console.log(`[3] FINAL row: ${JSON.stringify(final.rows[0])}`);
  console.log(`[3] row count for this public_id: ${dupes.rows[0].n}`);

  console.log("\n=== VERDICT ===");
  const r = final.rows[0];
  console.log(`F-001 (23505 crash) still happens? ...... ${domainOutcome.includes("23505") || domainOutcome.includes("duplicate key") ? "YES — NOT FIXED" : "NO — FIXED"}`);
  console.log(`Exactly one row for this call? .......... ${dupes.rows[0].n === 1 ? "YES" : "NO (" + dupes.rows[0].n + " rows)"}`);
  console.log(`F-005 (detail silently nulled)? ......... ${r.detail_null ? "YES — REGRESSION, DATA LOSS" : "no"}`);
  console.log(`transcript_ref cleared? ................. ${r.transcript_ref === null ? "YES" : "no"}`);
  console.log(`pipeline_state regressed (signals_done -> analysis_done)? ${r.pipeline_state === "analysis_done" ? "YES" : "no"}`);

  await cleanup(client);
  const proof = await client.query(
    `SELECT (SELECT count(*)::int FROM post_call WHERE public_id=$1) pc,
            (SELECT count(*)::int FROM activity  WHERE public_id=$2) act,
            (SELECT count(*)::int FROM account   WHERE public_id=$3) acct
     `, [POSTCALL, ACTIVITY, ACCOUNT]);
  console.log(`\n[cleanup] leftover fixture rows: ${JSON.stringify(proof.rows[0])}`);
}, env);
await closePool();
}
main().catch((e) => { console.error(e); process.exit(1); });
