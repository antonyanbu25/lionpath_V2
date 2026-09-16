#!/usr/bin/env node
/**
 * Verify DATABASE_URL vars loaded from worker/.dev.vars.
 * Run: node worker/scripts/verify-db-env.mjs
 * Never paste connection strings into zsh — edit worker/.dev.vars in the editor.
 */

import { loadDevVars } from "./lib/load-dev-vars.mjs";

function redact(url) {
  if (!url) return null;
  try {
    const u = new URL(url.replace(/^postgresql:/, "http:"));
    return {
      user: u.username,
      host: u.hostname,
      port: u.port,
      db: u.pathname.replace(/^\//, ""),
      passwordLen: (u.password || "").length,
    };
  } catch {
    return { parseError: true };
  }
}

loadDevVars();

const migrations = process.env.DATABASE_URL_MIGRATIONS;
const runtime = process.env.DATABASE_URL;
const mode = process.env.PERSISTENCE_MODE || "(unset)";

console.log("worker/.dev.vars check:");
console.log("  DATABASE_URL_MIGRATIONS:", migrations ? redact(migrations) : "NOT SET");
console.log("  DATABASE_URL:", runtime ? redact(runtime) : "NOT SET");
console.log("  PERSISTENCE_MODE:", mode);

const ok = !!migrations && !!runtime;
if (!ok) {
  console.error("\nAdd to worker/.dev.vars (single quotes around URLs if password has ! ? #):");
  console.error("  DATABASE_URL_MIGRATIONS='postgresql://postgres:PASSWORD@HOST:5432/janus?sslmode=require'");
  console.error("  DATABASE_URL='postgresql://janus_app:PASSWORD@HOST:5432/janus?sslmode=require'");
  process.exit(1);
}

console.log("\nOK — env vars parsed. Next:");
console.log("  node worker/scripts/verify-sql-network.mjs   # network + auth gate (run first)");
console.log("  node worker/scripts/apply-janus-schema.mjs");
console.log("  node janus/tests/grants_smoke.test.mjs");
