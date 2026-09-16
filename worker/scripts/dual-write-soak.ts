#!/usr/bin/env node
/**
 * Dual-write soak — verifies SQL primary + sync_outbox enqueue (PERSISTENCE_MODE=dual).
 *
 * Usage: npx tsx worker/scripts/dual-write-soak.ts
 * Loads worker/.dev.vars; requires DATABASE_URL (janus_app).
 */

import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";
import {
  DualWriteRepository,
  withSystemContext,
  closePool,
} from "../src/data/persistence/index.ts";
import type { PostgresEnv } from "../src/data/persistence/postgres-pool.ts";

loadDevVars();
process.env.PERSISTENCE_MODE = "dual";

const env: PostgresEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  PG_POOL_MAX: process.env.PG_POOL_MAX,
};

const stamp = Date.now();
const accountPublicId = `__dual_soak_acc_${stamp}__`;
const accountName = `Dual Soak ${stamp}`;

async function main() {
  if (!env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL required in worker/.dev.vars");
    process.exit(1);
  }

  // Ensure pg pool uses Cloud SQL SSL settings (pg v9 compat).
  const cs = pgClientConfig(env.DATABASE_URL).connectionString;
  if (cs) process.env.DATABASE_URL = cs;

  const port = new DualWriteRepository();

  await withSystemContext(async (client) => {
    await port.upsertAccount(client, {
      publicId: accountPublicId,
      name: accountName,
      domain: "dual-soak.example.com",
    });
  }, env);

  await withSystemContext(async (client) => {
    const acct = await client.query(
      `SELECT public_id, name FROM account WHERE public_id = $1`,
      [accountPublicId],
    );
    if (acct.rows.length !== 1) {
      throw new Error(`account row missing: ${accountPublicId}`);
    }
    console.log("[ok] SQL account row:", acct.rows[0].public_id, acct.rows[0].name);

    const outbox = await client.query(
      `SELECT entity_type, entity_id, operation, status
       FROM sync_outbox
       WHERE entity_type = 'account' AND entity_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [accountPublicId],
    );
    if (outbox.rows.length !== 1) {
      throw new Error(`sync_outbox row missing for ${accountPublicId}`);
    }
    const row = outbox.rows[0];
    console.log("[ok] sync_outbox:", row.entity_type, row.entity_id, row.operation, row.status);

    await client.query(`DELETE FROM sync_outbox WHERE entity_type = 'account' AND entity_id = $1`, [
      accountPublicId,
    ]);
    await client.query(`DELETE FROM account WHERE public_id = $1`, [accountPublicId]);
    console.log("[ok] cleaned up soak rows");
  }, env);

  await closePool();
  console.log("\nDual-write soak passed.");
}

main().catch((err) => {
  console.error("dual-write soak failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
