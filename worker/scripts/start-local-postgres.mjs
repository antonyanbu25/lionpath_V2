#!/usr/bin/env node
/**
 * Stand up a local Janus Postgres (no Homebrew/Docker), apply schema, write
 * worker/.dev.vars. Data lives in worker/.local-pg (gitignored).
 *
 * Usage:
 *   node worker/scripts/start-local-postgres.mjs
 *   node worker/scripts/start-local-postgres.mjs --apply-only
 */
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";
import { WORKER_ROOT } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";

const applyOnly = process.argv.includes("--apply-only");
const PORT = Number(process.env.LOCAL_PG_PORT || 5432);
const SUPERUSER = "postgres";
const SUPER_PASSWORD = "password";
const APP_PASSWORD = "janus_app_password";
const DATA_DIR = join(WORKER_ROOT, ".local-pg");
const DEV_VARS = join(WORKER_ROOT, ".dev.vars");
const MIGRATIONS_URL = `postgresql://${SUPERUSER}:${SUPER_PASSWORD}@127.0.0.1:${PORT}/janus`;
const APP_URL = `postgresql://janus_app:${APP_PASSWORD}@127.0.0.1:${PORT}/janus`;

function upsertDevVars() {
  const block = [
    `# Local Janus Postgres (worker/scripts/start-local-postgres.mjs)`,
    `DATABASE_URL_MIGRATIONS='${MIGRATIONS_URL}'`,
    `DATABASE_URL='${APP_URL}'`,
    `PERSISTENCE_MODE=firestore`,
  ].join("\n");
  if (!existsSync(DEV_VARS)) {
    writeFileSync(DEV_VARS, `${block}\n`);
    console.log("Wrote", DEV_VARS);
    return;
  }
  let text = readFileSync(DEV_VARS, "utf8");
  for (const [key, value] of [
    ["DATABASE_URL_MIGRATIONS", MIGRATIONS_URL],
    ["DATABASE_URL", APP_URL],
  ]) {
    const line = `${key}='${value}'`;
    const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, line);
    else text = `${text.trimEnd()}\n${line}\n`;
  }
  if (!/^PERSISTENCE_MODE=/m.test(text)) {
    text = `${text.trimEnd()}\nPERSISTENCE_MODE=firestore\n`;
  }
  writeFileSync(DEV_VARS, text.endsWith("\n") ? text : `${text}\n`);
  console.log("Updated", DEV_VARS);
}

function applySchema() {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [join(WORKER_ROOT, "scripts", "apply-janus-schema.mjs")], {
      cwd: join(WORKER_ROOT, ".."),
      env: {
        ...process.env,
        DATABASE_URL_MIGRATIONS: MIGRATIONS_URL,
        DATABASE_URL: MIGRATIONS_URL,
      },
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`apply-janus-schema exited ${code}`));
    });
  });
}

async function ensureJanusDatabase(pg) {
  const adminUrl = `postgresql://${SUPERUSER}:${SUPER_PASSWORD}@127.0.0.1:${PORT}/postgres`;
  const { default: pgMod } = await import("pg");
  const client = new pgMod.Client(pgClientConfig(adminUrl));
  await client.connect();
  try {
    const r = await client.query("SELECT 1 FROM pg_database WHERE datname = 'janus'");
    if (r.rowCount === 0) {
      await pg.createDatabase("janus");
      console.log("Created database janus");
    }
  } finally {
    await client.end();
  }
}

async function verifySeMotion() {
  const { default: pgMod } = await import("pg");
  const client = new pgMod.Client(pgClientConfig(MIGRATIONS_URL));
  await client.connect();
  try {
    const cols = await client.query(
      `SELECT table_name, column_name, column_default, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('post_call', 'scorecard')
          AND column_name = 'se_motion'
        ORDER BY table_name`,
    );
    if (cols.rowCount !== 2) {
      throw new Error(`se_motion missing: ${JSON.stringify(cols.rows)}`);
    }
    const checks = await client.query(
      `SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conname IN ('chk_post_call_se_motion', 'chk_scorecard_se_motion')
        ORDER BY 1`,
    );
    console.log("se_motion columns:", cols.rows);
    console.log("se_motion checks:", checks.rows);
  } finally {
    await client.end();
  }
}

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: SUPERUSER,
  password: SUPER_PASSWORD,
  port: PORT,
  persistent: true,
});

if (!existsSync(join(DATA_DIR, "PG_VERSION"))) {
  console.log("Initialising cluster at", DATA_DIR);
  await pg.initialise();
}

console.log(`Starting Postgres on 127.0.0.1:${PORT}`);
await pg.start();
await ensureJanusDatabase(pg);
upsertDevVars();
await applySchema();
await verifySeMotion();
console.log("\nLocal SQL wired. post_call.se_motion + scorecard.se_motion are live.");
console.log("Keep this process running while you use the database.");

if (applyOnly) {
  await pg.stop();
  process.exit(0);
}

const stop = async () => {
  try {
    await pg.stop();
  } catch {
    /* already stopped */
  }
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
