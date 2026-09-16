#!/usr/bin/env node
/**
 * Firestore -> export JSON dumper.
 *
 * migrate-firestore-to-sql.mjs consumes an export JSON but nothing in the repo
 * produced one. This is that producer. READ-ONLY on Firestore.
 *
 * Credentials (any one, same convention as worker/src/data/firestore-admin.ts):
 *   FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'   (inline)
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json                  (file)
 *   gcloud auth application-default login                            (ADC)
 * Plus FIREBASE_PROJECT_ID (default: se-singha-paathi).
 *
 * Usage:
 *   node worker/scripts/export-firestore.mjs --out ./firestore-export.json
 *   node worker/scripts/export-firestore.mjs --out ./e.json --counts-only
 *   node worker/scripts/export-firestore.mjs --out ./e.json --only accounts,deals
 *
 * Then:
 *   node worker/scripts/migration-preflight.mjs --export ./e.json
 */

import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDevVars } from "./lib/load-dev-vars.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(__dirname, "../package.json"));

/**
 * Every collection the SQL migration path cares about. `key` is the name the
 * export JSON must use (migrate-firestore-to-sql.mjs reads these exact keys).
 */
const COLLECTIONS = [
  { key: "orgs", collection: "orgs" },
  { key: "teams", collection: "teams" },
  { key: "users", collection: "users" },
  { key: "authIndex", collection: "authIndex" },
  { key: "accounts", collection: "accounts" },
  { key: "contacts", collection: "contacts" },
  { key: "deals", collection: "deals" },
  { key: "lifecycles", collection: "lifecycles" },
  { key: "dealContacts", collection: "dealContacts" },
  { key: "prepBriefs", collection: "prepBriefs" },
  { key: "postCalls", collection: "postCalls" },
  // No migration path today — exported so preflight can size the gap.
  { key: "tasks", collection: "tasks" },
  { key: "scorecards", collection: "scorecards" },
  { key: "scorecardLines", collection: "scorecardLines" },
  { key: "productGaps", collection: "productGaps" },
];

function parseArgs(argv) {
  const a = { out: "", countsOnly: false, only: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out") a.out = argv[++i];
    else if (argv[i] === "--counts-only") a.countsOnly = true;
    else if (argv[i] === "--only") a.only = new Set(argv[++i].split(",").map((s) => s.trim()));
  }
  if (!a.out && !a.countsOnly) {
    console.error("usage: export-firestore.mjs --out <file> [--counts-only] [--only a,b]");
    process.exit(2);
  }
  return a;
}

/** Firestore Timestamps are not JSON-serialisable; toTs() in the migration reads _seconds. */
function plain(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return value;
  if (typeof value.toDate === "function" && typeof value.seconds === "number") {
    return { _seconds: value.seconds, _nanoseconds: value.nanoseconds ?? 0 };
  }
  if (Array.isArray(value)) return value.map(plain);
  if (value.constructor && value.constructor.name === "DocumentReference") return value.path;
  if (Buffer.isBuffer(value)) return `<bytes:${value.length}>`;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = plain(v);
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  try { loadDevVars(); } catch { /* .dev.vars is optional here */ }

  const admin = require("firebase-admin");
  const projectId = (process.env.FIREBASE_PROJECT_ID || "se-singha-paathi").trim();
  const saJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();

  if (!saJson && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.warn("[export] no FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS — falling back to ADC.");
  }
  admin.initializeApp(
    saJson
      ? { credential: admin.credential.cert(JSON.parse(saJson)), projectId }
      : { projectId },
  );
  const db = admin.firestore();
  console.log(`[export] project=${projectId}`);

  const data = {};
  const counts = {};
  const targets = COLLECTIONS.filter((c) => !args.only || args.only.has(c.key));

  for (const { key, collection } of targets) {
    try {
      if (args.countsOnly) {
        counts[key] = (await db.collection(collection).count().get()).data().count;
        console.log(`  ${key.padEnd(16)} ${String(counts[key]).padStart(7)}`);
        continue;
      }
      const docs = [];
      let last = null;
      // Paginate: a single .get() on a large collection exhausts memory and
      // risks a deadline exceeded on the server side.
      for (;;) {
        let q = db.collection(collection).orderBy("__name__").limit(500);
        if (last) q = q.startAfter(last);
        const snap = await q.get();
        if (snap.empty) break;
        for (const d of snap.docs) docs.push({ id: d.id, ...plain(d.data()) });
        last = snap.docs[snap.docs.length - 1];
        if (snap.size < 500) break;
      }
      data[key] = docs;
      counts[key] = docs.length;
      console.log(`  ${key.padEnd(16)} ${String(docs.length).padStart(7)}`);
    } catch (err) {
      console.warn(`  ${key.padEnd(16)}   ERROR: ${err.message}`);
      if (!args.countsOnly) data[key] = [];
      counts[key] = `ERROR: ${err.message}`;
    }
  }

  if (args.countsOnly) {
    console.log("\ncounts:", JSON.stringify(counts, null, 1));
    return;
  }

  // authIndex maps authUid -> userId; fold it onto users so app_user/user_identity
  // get the real Firebase UID instead of falling back to the doc id.
  if (Array.isArray(data.users) && Array.isArray(data.authIndex)) {
    const uidByUserId = new Map();
    for (const ai of data.authIndex) if (ai.userId) uidByUserId.set(ai.userId, ai.id);
    let filled = 0;
    for (const u of data.users) {
      if (!u.authUid && uidByUserId.has(u.id)) { u.authUid = uidByUserId.get(u.id); filled++; }
    }
    console.log(`[export] backfilled authUid onto ${filled} user(s) from authIndex`);
  }

  await fs.writeFile(args.out, JSON.stringify(data, null, 1), "utf8");
  const { size } = await fs.stat(args.out);
  console.log(`\n[export] wrote ${args.out} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`[export] next: node worker/scripts/migration-preflight.mjs --export ${args.out}`);
}

main().catch((e) => { console.error("export-firestore error:", e.message); process.exit(1); });
