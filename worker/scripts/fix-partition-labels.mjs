#!/usr/bin/env node
/**
 * One-time fix: schema 06 labelled webhook_event partitions one week behind
 * ISO 8601 (w33 for 2026-08-17 week; ISO says w34). manage-partitions.mjs uses
 * ISO numbering, so the weekly cron would fail with overlap errors. Rename
 * live partitions to ISO labels. Metadata-only; no data moves.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../package.json"));
const pg = require("pg");

loadDevVars();
const url = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
const client = new pg.Client(pgClientConfig(url));
await client.connect();

const existing = await client.query(`
  SELECT c.relname AS name FROM pg_inherits i
  JOIN pg_class c ON c.oid = i.inhrelid
  JOIN pg_class p ON p.oid = i.inhparent
  WHERE p.relname = 'webhook_event'
`);
const names = new Set(existing.rows.map((r) => r.name));

const needsRename =
  names.has("webhook_event_2026_w33") &&
  names.has("webhook_event_2026_w34") &&
  !names.has("webhook_event_2026_w35");

if (!needsRename) {
  console.log("Nothing to rename — partitions already ISO-labelled:", [...names].sort().join(", "));
  await client.end();
  process.exit(0);
}

await client.query("BEGIN");
try {
  await client.query("ALTER TABLE webhook_event_2026_w33 RENAME TO webhook_event_2026_tmp_w33");
  await client.query("ALTER TABLE webhook_event_2026_w34 RENAME TO webhook_event_2026_w35");
  await client.query("ALTER TABLE webhook_event_2026_tmp_w33 RENAME TO webhook_event_2026_w34");
  await client.query("COMMIT");
  console.log("Renamed: w33->w34, w34->w35 (ISO 8601 labels)");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
}
await client.end();
