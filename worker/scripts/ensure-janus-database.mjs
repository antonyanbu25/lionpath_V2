#!/usr/bin/env node
/**
 * Create the janus database if missing (CI + local). Idempotent.
 * Uses postgres superuser URL; defaults match .github/workflows/ci.yml service.
 */
import pg from "pg";

const adminUrl =
  process.env.DATABASE_URL_ADMIN ||
  process.env.DATABASE_URL_MIGRATIONS?.replace(/\/janus(\?|$)/, "/postgres$1") ||
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";

const client = new pg.Client({ connectionString: adminUrl });
await client.connect();
try {
  await client.query("CREATE DATABASE janus");
  console.log("Created database janus");
} catch (err) {
  if (err && err.code === "42P04") {
    console.log("Database janus already exists");
  } else {
    throw err;
  }
} finally {
  await client.end();
}
