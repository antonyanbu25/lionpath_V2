#!/usr/bin/env node
/**
 * Read-only janus DB table population audit.
 * Runs verify-sql-network.mjs first; exit 1 if cannot connect.
 *
 * Usage: node worker/scripts/audit-sql-tables.mjs
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, "../package.json"));
const pg = require("pg");

const TABLES = [
  "account",
  "contact",
  "deal",
  "deal_contact",
  "activity",
  "pre_call",
  "post_call",
  "ai_run",
  "ai_artifact",
  "scorecard",
  "score_override",
  "org_unit",
  "app_user",
  "user_identity",
  "user_role",
  "app_role",
  "id_registry",
  "sync_outbox",
  "integration",
  "shape_version",
];

function runNetworkGate() {
  const script = join(__dirname, "verify-sql-network.mjs");
  const result = spawnSync(process.execPath, [script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function tableExists(client, table) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return r.rowCount > 0;
}

async function columnExists(client, table, column) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return r.rowCount > 0;
}

async function auditTable(client, table) {
  if (!(await tableExists(client, table))) {
    return { table, missing: true };
  }
  const countR = await client.query(`SELECT count(*)::bigint AS n FROM "${table}"`);
  const count = Number(countR.rows[0]?.n ?? 0);
  if (count === 0) {
    return { table, count: 0 };
  }

  const hasUpdated = await columnExists(client, table, "updated_at");
  const hasPublicId = await columnExists(client, table, "public_id");
  const hasCreated = await columnExists(client, table, "created_at");

  let freshness = null;
  if (hasUpdated) {
    const fr = await client.query(`SELECT max(updated_at) AS v FROM "${table}"`);
    freshness = fr.rows[0]?.v;
  } else if (hasCreated) {
    const fr = await client.query(`SELECT max(created_at) AS v FROM "${table}"`);
    freshness = fr.rows[0]?.v;
  } else {
    const fr = await client.query(`SELECT max(id) AS v FROM "${table}"`);
    freshness = fr.rows[0]?.v;
  }

  let samplePublicId = null;
  if (hasPublicId) {
    const sr = await client.query(
      `SELECT public_id FROM "${table}" WHERE public_id IS NOT NULL LIMIT 1`,
    );
    samplePublicId = sr.rows[0]?.public_id ?? null;
  }

  return { table, count, freshness, samplePublicId };
}

async function main() {
  loadDevVars();
  const mode = (process.env.PERSISTENCE_MODE || "(unset)").trim();
  console.log("\n=== SQL table population audit ===");
  console.log("PERSISTENCE_MODE:", mode);

  runNetworkGate();

  const url = (process.env.DATABASE_URL || "").trim();
  const client = new pg.Client({
    ...pgClientConfig(url),
    connectionTimeoutMillis: 15_000,
  });

  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.is_admin', 'true', true)`);

    console.log("\n--- Table row counts (admin session) ---\n");
    console.log(
      "table".padEnd(18) +
        "rows".padStart(8) +
        "  " +
        "freshness (max updated_at/id)".padEnd(28) +
        "sample public_id",
    );
    console.log("-".repeat(80));

    for (const table of TABLES) {
      const row = await auditTable(client, table);
      if (row.missing) {
        console.log(`${table.padEnd(18)}${"N/A".padStart(8)}  (table does not exist)`);
        continue;
      }
      const fresh =
        row.freshness instanceof Date
          ? row.freshness.toISOString()
          : row.freshness != null
            ? String(row.freshness)
            : "—";
      const sample = row.samplePublicId ?? "—";
      console.log(
        `${row.table.padEnd(18)}${String(row.count).padStart(8)}  ${fresh.padEnd(28)}${sample}`,
      );
    }

    if (await tableExists(client, "sync_outbox")) {
      console.log("\n--- sync_outbox by status ---\n");
      const statusR = await client.query(
        `SELECT status::text, count(*)::bigint AS n FROM sync_outbox GROUP BY status ORDER BY status`,
      );
      for (const s of statusR.rows) {
        console.log(`  ${s.status}: ${s.n}`);
      }
    }

    if (await tableExists(client, "ai_run")) {
      console.log("\n--- ai_run (last 5 by id) ---\n");
      const aiR = await client.query(
        `SELECT id, activity_id, pass_name, model, created_at
         FROM ai_run ORDER BY id DESC LIMIT 5`,
      );
      for (const r of aiR.rows) {
        console.log(
          `  id=${r.id} activity_id=${r.activity_id} pass=${r.pass_name} model=${r.model} at=${r.created_at}`,
        );
      }
    }

    if (await tableExists(client, "activity")) {
      console.log("\n--- activity (last 5 by id) ---\n");
      const actR = await client.query(
        `SELECT id, public_id, activity_type, created_at, updated_at
         FROM activity ORDER BY id DESC LIMIT 5`,
      );
      for (const r of actR.rows) {
        console.log(
          `  id=${r.id} public_id=${r.public_id} type=${r.activity_type} updated=${r.updated_at}`,
        );
      }
    }

    if (!(await tableExists(client, "shape_version"))) {
      console.log(
        "\nNote: shape_version is not a table — version markers live on JSONB columns (see janus/schema/10_shape_version.sql).",
      );
    }

    await client.query("COMMIT");
    console.log("\nOK — audit complete.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
