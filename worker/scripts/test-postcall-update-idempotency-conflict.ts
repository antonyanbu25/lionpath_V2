#!/usr/bin/env tsx
/**
 * Regression: a post-call re-analysis can reuse the same activity idempotency
 * key while presenting a newer activity public_id. The SQL repository must
 * resolve the newer public_id to the existing activity row so the post_call
 * update path can continue.
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
const postCallPublicId = "__postcall_update_conflict_postcall__";
const postCallIdempotencyKey = "__postcall_update_conflict_postcall_same__";

async function cleanup(client: PgClient) {
  await client.query(`DELETE FROM post_call WHERE public_id = $1 OR idempotency_key = $2`, [
    postCallPublicId,
    postCallIdempotencyKey,
  ]);
  await client.query(
    `DELETE FROM id_registry
     WHERE (entity_type = 'post_call' AND public_id = $1)
        OR (entity_type = 'activity' AND public_id = ANY($2::text[]))
        OR (entity_type = 'account' AND public_id = $3)
        OR (entity_type = 'app_user' AND public_id = $4)`,
    [postCallPublicId, [activityOldPublicId, activityNewPublicId], accountPublicId, ownerPublicId],
  );
  await client.query(`DELETE FROM activity WHERE public_id = ANY($1::text[]) OR idempotency_key = $2`, [
    [activityOldPublicId, activityNewPublicId],
    activityIdempotencyKey,
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

async function main() {
  if (!env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required; worker/.dev.vars is loaded when present.");
  }

  const connectionString = pgClientConfig(env.DATABASE_URL).connectionString;
  if (connectionString) process.env.DATABASE_URL = connectionString;

  await withSystemContext(async (client) => {
    await cleanup(client);
    await seedParents(client);

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
