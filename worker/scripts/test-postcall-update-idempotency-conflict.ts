#!/usr/bin/env tsx
/**
 * Regression: post-call re-analysis can present conflicting activity identity
 * pairs. The SQL repository must resolve either conflict to the existing
 * activity row so the post_call update path can continue.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx worker/scripts/test-postcall-update-idempotency-conflict.ts
 */
import assert from "node:assert/strict";

import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";
import {
  closePool,
  PostgresRepository,
  upsertAppUser,
  upsertOrgUnit,
  withSystemContext,
} from "../src/data/persistence/index.ts";
import type { PgClient, PostgresEnv } from "../src/data/persistence/index.ts";

loadDevVars();

const env: PostgresEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  PG_POOL_MAX: process.env.PG_POOL_MAX,
};

const repo = new PostgresRepository();

const orgUnitId = "__postcall_update_conflict_org__";
const ownerPublicId = "__postcall_update_conflict_user__";
const accountPublicId = "__postcall_update_conflict_account__";
const activityOldPublicId = "act_old";
const activityNewPublicId = "act_new";
const activityIdempotencyKey = "call_same";
const liveActivityPublicId = "act_live_conflict";
const liveActivityOldIdempotencyKey = "call_live_original";
const liveActivityNewIdempotencyKey = "call_live_reanalysis";
const postCallPublicIds = [
  "__postcall_update_conflict_postcall_idem__",
  "__postcall_update_conflict_postcall_public__",
];
const postCallIdempotencyKeys = [
  "__postcall_update_conflict_postcall_same__",
  "__postcall_update_conflict_postcall_live__",
];
const activityPublicIds = [activityOldPublicId, activityNewPublicId, liveActivityPublicId];
const activityIdempotencyKeys = [
  activityIdempotencyKey,
  liveActivityOldIdempotencyKey,
  liveActivityNewIdempotencyKey,
];

async function cleanup(client: PgClient) {
  await client.query(`DELETE FROM post_call WHERE public_id = ANY($1::text[]) OR idempotency_key = ANY($2::text[])`, [
    postCallPublicIds,
    postCallIdempotencyKeys,
  ]);
  await client.query(
    `DELETE FROM id_registry
     WHERE (entity_type = 'post_call' AND public_id = ANY($1::text[]))
        OR (entity_type = 'activity' AND public_id = ANY($2::text[]))
        OR (entity_type = 'account' AND public_id = $3)
        OR (entity_type = 'app_user' AND public_id = $4)`,
    [postCallPublicIds, activityPublicIds, accountPublicId, ownerPublicId],
  );
  await client.query(`DELETE FROM activity WHERE public_id = ANY($1::text[]) OR idempotency_key = ANY($2::text[])`, [
    activityPublicIds,
    activityIdempotencyKeys,
  ]);
  await client.query(`DELETE FROM account WHERE public_id = $1`, [accountPublicId]);
  await client.query(`DELETE FROM app_user WHERE public_id = $1 OR email = $2`, [
    ownerPublicId,
    "postcall-update-conflict@example.com",
  ]);
  await client.query(`DELETE FROM org_unit WHERE id = $1`, [orgUnitId]);
}

async function seedParents(client: PgClient) {
  await upsertOrgUnit(client, {
    id: orgUnitId,
    name: "Post-call update conflict regression",
    unitType: "squad",
    path: `/${orgUnitId}/`,
  });
  await upsertAppUser(client, {
    publicId: ownerPublicId,
    email: "postcall-update-conflict@example.com",
    displayName: "Post-call Update Conflict",
    orgUnitId,
  });
  await repo.upsertAccount(client, {
    publicId: accountPublicId,
    name: "Post-call Update Conflict Account",
    domain: "postcall-update-conflict.example.com",
  });
}

async function runSameIdempotencyKeyDifferentPublicIdRegression(client: PgClient) {
  const postCallPublicId = postCallPublicIds[0];
  const postCallIdempotencyKey = postCallIdempotencyKeys[0];

  const existingActivityId = await repo.upsertActivity(client, {
    publicId: activityOldPublicId,
    idempotencyKey: activityIdempotencyKey,
    accountPublicId,
    ownerPublicId,
    orgUnitId,
    activityType: "call",
    subject: "Original post-call activity",
    occurredAt: "2026-08-21T10:00:00.000Z",
  });

  const existingPostCallId = await repo.upsertPostCall(client, {
    publicId: postCallPublicId,
    idempotencyKey: postCallIdempotencyKey,
    activityPublicId: activityOldPublicId,
    transcriptRef: "gs://postcall-regression/original.txt",
    analysis: { marker: "old" },
    detail: { summary: "before update" },
    pipelineState: "analysis_done",
    analysisShapeVersion: "1",
    detailShapeVersion: "1",
  });

  const conflictingActivityId = await repo.upsertActivity(client, {
    publicId: activityNewPublicId,
    idempotencyKey: activityIdempotencyKey,
    accountPublicId,
    ownerPublicId,
    orgUnitId,
    activityType: "call",
    subject: "Updated post-call activity",
    occurredAt: "2026-08-21T10:30:00.000Z",
  });

  assert.equal(
    conflictingActivityId,
    existingActivityId,
    "same activity idempotency key must return the existing activity id",
  );

  const newActivityMapping = await client.query(
    `SELECT internal_id FROM id_registry WHERE entity_type = 'activity' AND public_id = $1`,
    [activityNewPublicId],
  );
  assert.equal(Number(newActivityMapping.rows[0]?.internal_id), existingActivityId);

  const updatedPostCallId = await repo.upsertPostCall(client, {
    publicId: postCallPublicId,
    idempotencyKey: postCallIdempotencyKey,
    activityPublicId: activityNewPublicId,
    transcriptRef: "gs://postcall-regression/updated.txt",
    analysis: { marker: "new" },
    detail: { summary: "after update" },
    pipelineState: "detail_done",
    analysisShapeVersion: "1",
    detailShapeVersion: "1",
  });

  assert.equal(updatedPostCallId, existingPostCallId, "post_call idempotency update must reuse existing row");

  const postCall = await client.query(
    `SELECT activity_id, transcript_ref, analysis, detail, pipeline_state
     FROM post_call
     WHERE id = $1`,
    [existingPostCallId],
  );
  assert.equal(Number(postCall.rows[0]?.activity_id), existingActivityId);
  assert.equal(postCall.rows[0]?.transcript_ref, "gs://postcall-regression/updated.txt");
  assert.equal(postCall.rows[0]?.analysis?.marker, "new");
  assert.equal(postCall.rows[0]?.detail?.summary, "after update");
  assert.equal(postCall.rows[0]?.pipeline_state, "detail_done");
}

async function runSamePublicIdDifferentIdempotencyKeyRegression(client: PgClient) {
  const postCallPublicId = postCallPublicIds[1];
  const postCallIdempotencyKey = postCallIdempotencyKeys[1];

  const existingActivityId = await repo.upsertActivity(client, {
    publicId: liveActivityPublicId,
    idempotencyKey: liveActivityOldIdempotencyKey,
    accountPublicId,
    ownerPublicId,
    orgUnitId,
    activityType: "call",
    subject: "Live original post-call activity",
    occurredAt: "2026-08-21T11:00:00.000Z",
  });

  const existingPostCallId = await repo.upsertPostCall(client, {
    publicId: postCallPublicId,
    idempotencyKey: postCallIdempotencyKey,
    activityPublicId: liveActivityPublicId,
    transcriptRef: "gs://postcall-regression/live-original.txt",
    analysis: { marker: "live-old" },
    detail: { summary: "live before update" },
    pipelineState: "analysis_done",
    analysisShapeVersion: "1",
    detailShapeVersion: "1",
  });

  const conflictingActivityId = await repo.upsertActivity(client, {
    publicId: liveActivityPublicId,
    idempotencyKey: liveActivityNewIdempotencyKey,
    accountPublicId,
    ownerPublicId,
    orgUnitId,
    activityType: "call",
    subject: "Live re-analysis post-call activity",
    occurredAt: "2026-08-21T11:30:00.000Z",
  });

  assert.equal(
    conflictingActivityId,
    existingActivityId,
    "same activity public_id with a different idempotency key must return the existing activity id",
  );

  const activityRows = await client.query(
    `SELECT id FROM activity WHERE public_id = $1 OR idempotency_key = ANY($2::text[]) ORDER BY id`,
    [liveActivityPublicId, [liveActivityOldIdempotencyKey, liveActivityNewIdempotencyKey]],
  );
  assert.deepEqual(
    activityRows.rows.map((row) => Number(row.id)),
    [existingActivityId],
    "activity public_id conflict must not create a duplicate activity row",
  );

  const updatedPostCallId = await repo.upsertPostCall(client, {
    publicId: postCallPublicId,
    idempotencyKey: postCallIdempotencyKey,
    activityPublicId: liveActivityPublicId,
    transcriptRef: "gs://postcall-regression/live-updated.txt",
    analysis: { marker: "live-new" },
    detail: { summary: "live after update" },
    pipelineState: "detail_done",
    analysisShapeVersion: "1",
    detailShapeVersion: "1",
  });

  assert.equal(updatedPostCallId, existingPostCallId, "post_call update must reuse the existing live-conflict row");

  const postCall = await client.query(
    `SELECT activity_id, transcript_ref, analysis, detail, pipeline_state
     FROM post_call
     WHERE id = $1`,
    [existingPostCallId],
  );
  assert.equal(Number(postCall.rows[0]?.activity_id), existingActivityId);
  assert.equal(postCall.rows[0]?.transcript_ref, "gs://postcall-regression/live-updated.txt");
  assert.equal(postCall.rows[0]?.analysis?.marker, "live-new");
  assert.equal(postCall.rows[0]?.detail?.summary, "live after update");
  assert.equal(postCall.rows[0]?.pipeline_state, "detail_done");
}

async function main() {
  if (!env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required; worker/.dev.vars is loaded when present.");
  }

  const connectionString = pgClientConfig(env.DATABASE_URL).connectionString;
  if (connectionString) process.env.DATABASE_URL = connectionString;

  await withSystemContext(async (client) => {
    await cleanup(client);
    await seedParents(client);

    await runSameIdempotencyKeyDifferentPublicIdRegression(client);
    await runSamePublicIdDifferentIdempotencyKeyRegression(client);

    await cleanup(client);
  }, env);

  await closePool();
  console.log("test-postcall-update-idempotency-conflict: ok");
}

main().catch(async (err) => {
  await closePool().catch(() => undefined);
  console.error(err);
  process.exit(1);
});
