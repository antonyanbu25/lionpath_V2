#!/usr/bin/env node
/**
 * Point authIndex/{firebaseUid} at the canonical users/{id} doc for an email.
 * Fixes seniorLeaderIds UUID vs session usr_dummy_* drift after seed/migrate.
 *
 * Usage:
 *   node worker/scripts/reconcile-auth-index.mjs --email antony.sagayaraj@freshworks.com
 *   node worker/scripts/reconcile-auth-index.mjs --email vipin.thomas@freshworks.com --promote
 *   node worker/scripts/reconcile-auth-index.mjs --email user@freshworks.com --dry-run
 */

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_ORG_ID = "org_freshworks_se";
const DIRECTOR_EMAIL = "vipin.thomas@freshworks.com";

function parseArgs(argv) {
  const args = { dryRun: false, promote: false, email: "" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--promote") args.promote = true;
    else if (argv[i] === "--email") args.email = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(
        `Usage: node worker/scripts/reconcile-auth-index.mjs --email user@freshworks.com [--promote] [--dry-run]`,
      );
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

/** Prefer Firebase UUID profiles over usr_dummy_* seed ids. */
function pickCanonicalUser(docs, promote) {
  const nonDummy = docs.find((d) => !String(d.id || "").startsWith("usr_dummy_"));
  if (nonDummy) return { canonical: nonDummy, promoted: false, fromDummyId: null, newId: null };

  const dummy = docs.find((d) => String(d.id || "").startsWith("usr_dummy_")) || docs[0];
  if (!promote) return { canonical: dummy, promoted: false, fromDummyId: null, newId: null };

  const newId = `usr_${randomUUID()}`;
  const { id: _old, ...rest } = dummy;
  return {
    canonical: { ...rest, id: newId },
    promoted: true,
    fromDummyId: dummy.id,
    newId,
  };
}

async function patchManagerReferences(db, fromId, toId, dryRun) {
  if (!fromId || !toId || fromId === toId) return;

  const usersSnap = await db.collection("users").where("managerId", "==", fromId).get();
  for (const doc of usersSnap.docs) {
    console.log(`users/${doc.id}: managerId ${fromId} → ${toId}`);
    if (!dryRun) await doc.ref.set({ managerId: toId, updatedAt: Date.now() }, { merge: true });
  }

  const teamsSnap = await db.collection("teams").where("managerId", "==", fromId).get();
  for (const doc of teamsSnap.docs) {
    console.log(`teams/${doc.id}: managerId ${fromId} → ${toId}`);
    if (!dryRun) await doc.ref.set({ managerId: toId, updatedAt: Date.now() }, { merge: true });
  }
}

async function patchOrgDirector(db, email, canonicalId, fromDummyId, dryRun) {
  const orgRef = db.collection("orgs").doc(DEFAULT_ORG_ID);
  const orgSnap = await orgRef.get();
  if (!orgSnap.exists) return;

  const org = orgSnap.data();
  const isDirector = email === DIRECTOR_EMAIL.trim().toLowerCase();
  const directorMatches =
    isDirector &&
    (!org.directorId || org.directorId === fromDummyId || String(org.directorId).startsWith("usr_dummy_"));

  if (!directorMatches) return;

  console.log(`orgs/${DEFAULT_ORG_ID}: directorId ${org.directorId || "(none)"} → ${canonicalId}`);
  if (!dryRun) {
    await orgRef.set(
      {
        directorId: canonicalId,
        directorEmail: email,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  }
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
  const { canonical, promoted, fromDummyId, newId } = pickCanonicalUser(docs, args.promote);

  const patch = {
    userId: canonical.id,
    email: args.email,
    updatedAt: ts,
  };

  console.log(
    `Canonical user: users/${canonical.id} (role=${canonical.role || "?"}, orgId=${canonical.orgId || "(none)"})`,
  );
  if (promoted) {
    console.log(`Promoted from users/${fromDummyId} → users/${newId}`);
  }
  console.log(`authIndex/${authUid} →`, patch);

  if (args.dryRun) {
    if (promoted) {
      await patchOrgDirector(db, args.email, canonical.id, fromDummyId, true);
      await patchManagerReferences(db, fromDummyId, canonical.id, true);
    }
    console.log("[dry-run] No writes.");
    return;
  }

  if (promoted) {
    await db.collection("users").doc(canonical.id).set(
      {
        ...canonical,
        id: canonical.id,
        email: args.email,
        authUid,
        orgId: canonical.orgId || DEFAULT_ORG_ID,
        status: canonical.status || "active",
        createdAt: canonical.createdAt || ts,
        updatedAt: ts,
      },
      { merge: true },
    );
    await patchOrgDirector(db, args.email, canonical.id, fromDummyId, false);
    await patchManagerReferences(db, fromDummyId, canonical.id, false);
  }

  await db.collection("authIndex").doc(authUid).set(patch, { merge: true });
  await db.collection("users").doc(canonical.id).set(
    {
      id: canonical.id,
      email: args.email,
      authUid,
      role: canonical.role || "manager",
      orgId: canonical.orgId || DEFAULT_ORG_ID,
      updatedAt: ts,
    },
    { merge: true },
  );

  const dummy = docs.find((d) => d.id.startsWith("usr_dummy_") && d.id !== canonical.id);
  const legacyDummy = promoted ? fromDummyId : null;
  if (legacyDummy) {
    console.warn(`Legacy dummy doc users/${legacyDummy} — delete manually after verifying login.`);
  } else if (dummy) {
    console.warn(`Duplicate dummy doc still present: users/${dummy.id} — delete manually after verifying login.`);
  }

  console.log("Done. User should sign out, clear site data, and sign in again.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
