#!/usr/bin/env node
/**
 * Backfill existing se_history blobs into PostgreSQL user_kv.
 *
 * Preferred source: /tmp/nafisa-sweep/*.json when present.
 * Fallback source: Firestore Admin se_history collection, including chunks.
 *
 * Usage:
 *   node worker/scripts/backfill-history-to-pg.mjs --dry-run
 *   node worker/scripts/backfill-history-to-pg.mjs
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { loadDevVars } from "./lib/load-dev-vars.mjs";
import { pgClientConfig } from "./lib/pg-client-config.mjs";

const LOCAL_SWEEP_DIR = "/tmp/nafisa-sweep";
const COLLECTION = "se_history";
const CHUNKS_COLLECTION = "chunks";
const dryRun = process.argv.includes("--dry-run");

const KEY_RE = /^(history|tasks|feedback):(.+)$/;
const COLUMN_BY_PREFIX = new Map([
  ["history", "history"],
  ["tasks", "tasks"],
  ["feedback", "feedback"],
]);

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function emailFromLocalStem(stem) {
  const idx = stem.lastIndexOf("_");
  if (idx <= 0 || idx === stem.length - 1) return normalizeEmail(stem);
  return normalizeEmail(`${stem.slice(0, idx)}@${stem.slice(idx + 1)}`);
}

function parseKey(key) {
  const match = KEY_RE.exec(String(key || ""));
  if (!match) return null;
  const prefix = match[1];
  const email = prefix === "feedback" && match[2] === "global" ? "__global__" : normalizeEmail(match[2]);
  if (!email) return null;
  return { column: COLUMN_BY_PREFIX.get(prefix), email, key };
}

function localKeyFromFile(file) {
  if (!file.endsWith(".json")) return null;
  const base = file.slice(0, -".json".length);
  for (const prefix of ["history", "tasks", "feedback"]) {
    const marker = `${prefix}_`;
    if (!base.startsWith(marker)) continue;
    const stem = base.slice(marker.length);
    if (prefix === "feedback" && stem === "global") return "feedback:global";
    return `${prefix}:${emailFromLocalStem(stem)}`;
  }
  return null;
}

function parseJsonString(value, label) {
  try {
    JSON.parse(value);
    return value;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in ${label}: ${detail}`);
  }
}

function readLocalBlobs() {
  if (!existsSync(LOCAL_SWEEP_DIR)) return [];
  const rows = [];
  for (const file of readdirSync(LOCAL_SWEEP_DIR).sort()) {
    const key = localKeyFromFile(file);
    if (!key) continue;
    const parsed = parseKey(key);
    if (!parsed) continue;
    const path = join(LOCAL_SWEEP_DIR, file);
    rows.push({
      ...parsed,
      source: "local",
      value: parseJsonString(readFileSync(path, "utf8"), path),
    });
  }
  return rows;
}

async function initFirestore() {
  const adminMod = await import("firebase-admin");
  const admin = adminMod.default ?? adminMod;
  const projectId = (process.env.FIREBASE_PROJECT_ID || "").trim();
  if (!projectId) {
    throw new Error("Set FIREBASE_PROJECT_ID for Firestore fallback backfill.");
  }
  if (!admin.apps?.length) {
    const jsonRaw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
    if (jsonRaw) {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(jsonRaw)),
        projectId,
      });
    } else {
      admin.initializeApp(projectId ? { projectId } : undefined);
    }
  }
  return admin.firestore();
}

async function readChunkedValue(db, docRef, chunkCount) {
  if (!Number.isInteger(chunkCount) || chunkCount <= 0) return null;
  const refs = Array.from({ length: chunkCount }, (_, index) =>
    docRef.collection(CHUNKS_COLLECTION).doc(String(index).padStart(6, "0")),
  );
  const snaps = await db.getAll(...refs);
  const chunks = [];
  for (const snap of snaps) {
    const value = snap.data()?.value;
    if (typeof value !== "string") return null;
    chunks.push(value);
  }
  return chunks.join("");
}

async function readFirestoreBlobs() {
  const db = await initFirestore();
  const snap = await db.collection(COLLECTION).get();
  const rows = [];
  for (const doc of snap.docs) {
    const parsed = parseKey(doc.id);
    if (!parsed) continue;
    const data = doc.data() || {};
    let value = typeof data.value === "string" ? data.value : null;
    if (!value && data.storage === "chunks" && typeof data.chunkCount === "number") {
      value = await readChunkedValue(db, doc.ref, data.chunkCount);
    }
    if (!value) continue;
    rows.push({
      ...parsed,
      source: "firestore",
      value: parseJsonString(value, `Firestore ${COLLECTION}/${doc.id}`),
    });
  }
  return rows;
}

function summarize(rows) {
  const summary = { history: 0, tasks: 0, feedback: 0 };
  for (const row of rows) summary[row.column] += 1;
  return summary;
}

async function upsertRows(rows) {
  const url = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL || "";
  if (!url) throw new Error("Set DATABASE_URL_MIGRATIONS or DATABASE_URL for PostgreSQL backfill.");
  const client = new pg.Client(pgClientConfig(url));
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      await client.query("SELECT set_config('app.email', $1, true)", [row.email]);
      await client.query(
        `INSERT INTO user_kv (email, ${row.column}, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (email) DO UPDATE
         SET ${row.column} = EXCLUDED.${row.column},
             updated_at = now()`,
        [row.email, row.value],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  } finally {
    await client.end();
  }
}

loadDevVars();

const localRows = readLocalBlobs();
const rows = localRows.length ? localRows : await readFirestoreBlobs();
const source = localRows.length ? "local" : "firestore";
const summary = summarize(rows);

console.log(
  `${dryRun ? "dry-run: " : ""}backfill source=${source} rows=${rows.length} ` +
    `history=${summary.history} tasks=${summary.tasks} feedback=${summary.feedback}`,
);

if (dryRun) process.exit(0);
if (!rows.length) {
  console.log("No se_history blobs found.");
  process.exit(0);
}

await upsertRows(rows);
console.log("Backfill complete.");
