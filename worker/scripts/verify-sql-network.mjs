#!/usr/bin/env node
/**
 * Cloud SQL network + auth gate — run BEFORE claiming SQL read/write works.
 *
 * Proves, in order:
 *   1. DATABASE_URL is set and parses
 *   2. TCP reachability to host:5432 (network path open)
 *   3. PostgreSQL accepts the connection (SSL + credentials)
 *   4. SELECT 1 succeeds as janus_app
 *
 * Usage:
 *   node worker/scripts/verify-sql-network.mjs           # requires DATABASE_URL
 *   node worker/scripts/verify-sql-network.mjs --allow-skip  # exit 0 when unset (CI optional)
 *
 * Exit codes:
 *   0 — network + auth OK
 *   1 — DATABASE_URL unset (unless --allow-skip) or any check failed
 *
 * Agents: do NOT skip this. HTTP 200 from /api/domain-write does NOT prove SQL
 * was written — see docs/SQL_AGENT_VERIFICATION.md.
 */

import net from "node:net";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, "../package.json"));
const pg = require("pg");

const allowSkip = process.argv.includes("--allow-skip");
const TCP_TIMEOUT_MS = 12_000;
const PG_TIMEOUT_MS = 15_000;

function fail(msg) {
  console.error(`\n[FAIL] ${msg}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`[PASS] ${msg}`);
}

function parsePgUrl(connectionString) {
  const u = new URL(connectionString.replace(/^postgresql:/, "http:"));
  return {
    user: u.username,
    host: u.hostname,
    port: Number(u.port || 5432),
    db: u.pathname.replace(/^\//, ""),
    passwordLen: (u.password || "").length,
  };
}

function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`TCP timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(Date.now() - started);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function pgProbe(connectionString) {
  const started = Date.now();
  const client = new pg.Client({
    ...pgClientConfig(connectionString),
    connectionTimeoutMillis: PG_TIMEOUT_MS,
  });
  try {
    await client.connect();
    const ping = await client.query("SELECT 1 AS ok");
    const who = await client.query("SELECT current_user, current_database()");
    const row = who.rows[0];
    return {
      ms: Date.now() - started,
      ok: ping.rows[0]?.ok === 1,
      user: row?.current_user,
      database: row?.current_database,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  loadDevVars();

  const url = (process.env.DATABASE_URL || "").trim();
  const mode = (process.env.PERSISTENCE_MODE || "(unset)").trim();

  console.log("Cloud SQL network gate");
  console.log("  PERSISTENCE_MODE:", mode);

  if (!url) {
    if (allowSkip) {
      console.log("[SKIP] DATABASE_URL unset — network gate not run (--allow-skip).");
      process.exit(0);
    }
    fail(
      "DATABASE_URL unset. Copy worker/.dev.vars.example → worker/.dev.vars and set " +
        "DATABASE_URL='postgresql://janus_app:…@HOST:5432/janus?sslmode=require'. " +
        "Run node worker/scripts/verify-db-env.mjs first.",
    );
  }

  let parsed;
  try {
    parsed = parsePgUrl(url);
  } catch {
    fail("DATABASE_URL is not a valid postgresql URL.");
  }

  console.log("  target:", {
    user: parsed.user,
    host: parsed.host,
    port: parsed.port,
    db: parsed.db,
    passwordLen: parsed.passwordLen,
  });

  if (parsed.user === "postgres") {
    console.warn(
      "[WARN] DATABASE_URL uses postgres superuser. Runtime checks should use janus_app. " +
        "Use DATABASE_URL_MIGRATIONS for postgres.",
    );
  }

  if (mode === "firestore" || mode === "(unset)") {
    console.warn(
      "[WARN] PERSISTENCE_MODE is firestore (or unset). The worker will NOT write CRM data " +
        "to SQL even when the network gate passes. Set PERSISTENCE_MODE=dual or sql for SQL writes.",
    );
  }

  // 1. TCP
  try {
    const tcpMs = await tcpProbe(parsed.host, parsed.port, TCP_TIMEOUT_MS);
    pass(`TCP ${parsed.host}:${parsed.port} reachable (${tcpMs}ms)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(
      `TCP to ${parsed.host}:${parsed.port} failed: ${msg}\n` +
        "  Network path to Cloud SQL is NOT open from this environment.\n" +
        "  Check: authorized networks on the Cloud SQL instance, VPN/office IP, " +
        "corporate firewall, or use Cloud SQL Auth Proxy. See docs/SQL_AGENT_VERIFICATION.md.",
    );
  }

  // 2. PostgreSQL auth + SELECT 1
  try {
    const result = await pgProbe(url);
    if (!result.ok) fail("SELECT 1 returned unexpected result.");
    pass(
      `PostgreSQL auth OK as ${result.user}@${result.database} (${result.ms}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(
      `PostgreSQL connection failed after TCP succeeded: ${msg}\n` +
        "  TCP is open but SSL/auth/database name may be wrong. " +
        "Verify password, sslmode=require, and that schema was applied.",
    );
  }

  console.log("\nOK — Cloud SQL network + janus_app auth verified.");
  console.log("Next:");
  console.log("  node janus/tests/grants_smoke.test.mjs");
  console.log("  cd worker && npm run test:sql-gates");
  console.log("  docs/SQL_AGENT_VERIFICATION.md — full agent ladder");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
