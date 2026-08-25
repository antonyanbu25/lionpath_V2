#!/usr/bin/env node
/** Inspect partition bounds for audit_log / webhook_event. */
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

const r = await client.query(`
  SELECT c.relname AS name, pg_get_expr(c.relpartbound, c.oid) AS bounds
  FROM pg_inherits i
  JOIN pg_class c ON c.oid = i.inhrelid
  JOIN pg_class p ON p.oid = i.inhparent
  WHERE p.relname IN ('audit_log', 'webhook_event')
  ORDER BY c.relname
`);
for (const row of r.rows) console.log(row.name, "=>", row.bounds);
await client.end();
