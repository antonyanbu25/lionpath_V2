#!/usr/bin/env node
/**
 * Point authIndex/{firebaseUid} at the canonical users/{id} doc for an email.
 * Fixes seniorLeaderIds UUID vs session usr_dummy_* drift after seed/migrate.
 *
 * Usage:
 *   node worker/scripts/reconcile-auth-index.mjs --email antony.sagayaraj@freshworks.com
 *   node worker/scripts/reconcile-auth-index.mjs --email antony.sagayaraj@freshworks.com --dry-run
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { dryRun: false, email: "" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--email") args.email = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage: node worker/scripts/reconcile-auth-index.mjs --email user@freshworks.com [--dry-run]`);
      process.exit(0);
    }
  }
  if (!args.email) {
    console.error("Missing --email");
    process.exit(1);
  }
  args.email = args.email.trim().toLowerCase();
  return args;
}

async function loadAdmin(projectId) {
  let mod;
  try {
    mod = await import("firebase-admin");
  } catch {
    console.error("firebase-admin not installed. Run: cd worker && npm install firebase-admin");
    process.exit(1);
  }
  const admin = mod.default ?? mod;
  if (!admin.apps?.length) {
    admin.initializeApp(projectId ? { projectId } : undefined);
  }
  return admin;
}

async function main() {
  const args = parseArgs(process.argv);
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "";
  const admin = await loadAdmin(projectId || undefined);
  const db = admin.firestore();
  const auth = admin.auth();
  const ts = Date.now();

  let authUid;
  try {
    authUid = (await auth.getUserByEmail(args.email)).uid;
  } catch (err) {
    console.error(`Firebase Auth user not found for ${args.email}:`, err.code || err.message);
    process.exit(1);
  }

  const usersSnap = await db.collection("users").where("email", "==", args.email).get();
  if (usersSnap.empty) {
    console.error(`No users/* doc for ${args.email}`);
    process.exit(1);
  }

  const docs = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const canonical =
    docs.find((d) => (d.orgId && d.role === "manager") || !(d.id || "").startsWith("usr_dummy_")) ||
    docs[0];

  const patch = {
    userId: canonical.id,
    email: args.email,
    updatedAt: ts,
  };

  console.log(`Canonical user: users/${canonical.id} (role=${canonical.role || "?"}, orgId=${canonical.orgId || "(none)"})`);
  console.log(`authIndex/${authUid} →`, patch);

  if (args.dryRun) {
    console.log("[dry-run] No writes.");
    return;
  }

  await db.collection("authIndex").doc(authUid).set(patch, { merge: true });
  await db.collection("users").doc(canonical.id).set(
    {
      id: canonical.id,
      email: args.email,
      authUid,
      role: canonical.role || "manager",
      orgId: canonical.orgId || "org_freshworks_se",
      updatedAt: ts,
    },
    { merge: true },
  );

  const dummy = docs.find((d) => d.id !== canonical.id && d.id.startsWith("usr_dummy_"));
  if (dummy) {
    console.warn(`Duplicate dummy doc still present: users/${dummy.id} — delete manually after verifying login.`);
  }

  console.log("Done. User should sign out, clear site data, and sign in again.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
