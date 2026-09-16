#!/usr/bin/env node
/**
 * Export the authoritative user public_ids from Firestore as JSON.
 *
 * The id on a real user is `usr_${crypto.randomUUID()}`, minted by
 * worker/scripts/seed-firestore-users.mjs and stored on the Firestore user
 * document. It CANNOT be derived from the email -- stableUserIdForEmail()
 * produces `usr_dummy_<email>` and is for local/dummy users only.
 *
 * In dual mode the browser sends that exact id as ownerId, and upsertActivity
 * resolves it through id_registry. So app_user.public_id has to match it
 * character for character or every write fails with
 * "id_registry: no mapping for app_user/usr_...".
 *
 * This is an IDENTIFIER alignment, not a data migration. It copies no call
 * data, no accounts, no scores -- only the email -> id mapping that lets the
 * two systems refer to the same person. The clean slate (D6) is unaffected.
 *
 * Requires Firebase Admin credentials, same as the seed script:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   node janus/scripts/export-user-ids.mjs > user-ids.json
 *   node janus/scripts/export-user-ids.mjs --check      # report, write nothing
 *
 * Then:
 *   node janus/scripts/provision-identity.mjs --ids user-ids.json
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import { loadDevVars, WORKER_ROOT } from "../../worker/scripts/lib/load-dev-vars.mjs";

const require = createRequire(join(WORKER_ROOT, "package.json"));
loadDevVars();

const checkOnly = process.argv.includes("--check");
const log = (...a) => console.error(...a);   // stderr, so stdout stays clean JSON

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIREBASE_PROJECT_ID) {
  log(
    "Set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path (same\n" +
      "credential worker/scripts/seed-firestore-users.mjs uses).",
  );
  process.exit(1);
}

let admin;
try {
  admin = require("firebase-admin");
} catch {
  log("firebase-admin is not installed. Run: npm install --prefix worker");
  process.exit(1);
}

if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  admin.initializeApp(projectId ? { projectId } : undefined);
}

const db = admin.firestore();
const snap = await db.collection("users").get();

const mapping = {};
const anomalies = [];

for (const doc of snap.docs) {
  const data = doc.data() || {};
  const email = String(data.email || "").trim().toLowerCase();
  // The doc id and the `id` field should agree; seed-firestore-users.mjs
  // writes the doc AT the internal id. Prefer the field, fall back to the id.
  const id = String(data.id || doc.id || "").trim();

  if (!email) {
    anomalies.push(`doc ${doc.id}: no email — skipped`);
    continue;
  }
  if (!id.startsWith("usr_")) {
    anomalies.push(`${email}: id "${id}" does not start with usr_ — skipped`);
    continue;
  }
  if (data.id && doc.id !== data.id) {
    anomalies.push(`${email}: doc id (${doc.id}) != id field (${data.id}) — using the field`);
  }
  if (mapping[email] && mapping[email] !== id) {
    anomalies.push(`${email}: TWO user docs with different ids (${mapping[email]}, ${id})`);
  }
  mapping[email] = id;
}

log(`Firestore users: ${snap.size} doc(s), ${Object.keys(mapping).length} usable mapping(s)`);
if (anomalies.length) {
  log(`\n${anomalies.length} anomaly(ies):`);
  for (const a of anomalies) log("  - " + a);
}

const dummies = Object.entries(mapping).filter(([, id]) => id.startsWith("usr_dummy_"));
if (dummies.length) {
  log(
    `\n${dummies.length} user(s) still carry a usr_dummy_ id, which means they were created\n` +
      `locally and never went through the Firestore seed. They will provision fine, but\n` +
      `confirm they are real people and not leftover test accounts:`,
  );
  for (const [email] of dummies) log(`  ${email}`);
}

if (checkOnly) {
  log("\n--check — no JSON written.");
  process.exit(0);
}

process.stdout.write(JSON.stringify(mapping, null, 2) + "\n");
