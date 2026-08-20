#!/usr/bin/env node
/**
 * Phase 0 repro: create empty janus_repro DB and run schema apply against it.
 * Expectation: #1 (enum txn) fails on 11_deal_contact.sql.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../package.json"));
const pg = require("pg");

loadDevVars();
const url = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL_MIGRATIONS required");
  process.exit(1);
}

const admin = new pg.Client(pgClientConfig(url.replace(/\/janus(\?|$)/, "/postgres$1")));
await admin.connect();
await admin.query("DROP DATABASE IF EXISTS janus_repro");
await admin.query("CREATE DATABASE janus_repro");
await admin.end();
console.log("created empty janus_repro");

const reproUrl = url.replace(/\/janus(\?|$)/, "/janus_repro$1");
const child = spawn("node", ["worker/scripts/apply-janus-schema.mjs"], {
  env: { ...process.env, DATABASE_URL_MIGRATIONS: reproUrl, DATABASE_URL: reproUrl },
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
