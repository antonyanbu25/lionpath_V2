#!/usr/bin/env node
/**
 * Migrate Firestore users from Firebase-uid-as-User.id to internal usr_* ids.
 *
 * For each legacy user doc (id == authUid or id starts with dummy-):
 *   1. Create/update users/{internalId} with authUid field
 *   2. Write authIndex/{firebaseUid} → { userId: internalId }
 *   3. Rewrite ownerId on lifecycles, prepBriefs, postCalls, tasks
 *   4. Update team managerId / memberIds
 *   5. Optionally delete legacy user doc (--delete-legacy)
 *
 * Usage:
 *   node worker/scripts/migrate-user-ids.mjs --dry-run
 *   node worker/scripts/migrate-user-ids.mjs
 *   node worker/scripts/migrate-user-ids.mjs --delete-legacy
 *
 * Requires: GOOGLE_APPLICATION_CREDENTIALS or gcloud application-default login
 */

import { randomUUID } from "node:crypto";

function parseArgs(argv) {
  const args = { dryRun: false, deleteLegacy: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--delete-legacy") args.deleteLegacy = true;
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage:
  node worker/scripts/migrate-user-ids.mjs [--dry-run] [--delete-legacy]`);
      process.exit(0);
    }
  }
  return args;
}

function stableUserIdForEmail(email) {
  const key = String(email || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `usr_dummy_${key || "user"}`;
}

function resolveInternalUserId(user) {
  if (user.id?.startsWith("usr_")) return user.id;
  if (user.email) {
    const fromEmail = stableUserIdForEmail(user.email);
    if (user.id?.startsWith("dummy-")) return fromEmail;
    if (!user.id?.includes("-") || user.id === user.authUid) {
      return user.id?.startsWith("usr_") ? user.id : `usr_${randomUUID()}`;
    }
  }
  if (user.id?.startsWith("dummy-")) {
    return stableUserIdForEmail(user.id.slice("dummy-".length));
  }
  return `usr_${randomUUID()}`;
}

async function loadAdmin(projectId) {
  let mod;
  try {
    mod = await import("firebase-admin");
  } catch {
    console.error("firebase-admin not installed. Run: cd worker && npm install");
    process.exit(1);
  }
  const admin = mod.default ?? mod;
  if (!admin.apps?.length) {
    admin.initializeApp(projectId ? { projectId } : undefined);
  }
  return admin;
}

async function rewriteOwnerIds(db, collection, oldId, newId, dryRun) {
  const snap = await db.collection(collection).where("ownerId", "==", oldId).get();
  if (snap.empty) return 0;
  for (const doc of snap.docs) {
    if (dryRun) {
      console.log(`[dry-run] ${collection}/${doc.id} ownerId: ${oldId} → ${newId}`);
    } else {
      await doc.ref.update({ ownerId: newId });
    }
  }
  return snap.size;
}

async function main() {
  const args = parseArgs(process.argv);
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "";
  const admin = await loadAdmin(projectId || undefined);
  const db = admin.firestore();
  const ts = Date.now();

  const usersSnap = await db.collection("users").get();
  const idMap = new Map();

  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const user = { id: doc.id, ...data };
    if (user.id.startsWith("usr_") && user.id === doc.id) {
      if (user.authUid) idMap.set(user.authUid, user.id);
      continue;
    }
    const internalId = resolveInternalUserId(user);
    idMap.set(doc.id, internalId);
    if (user.authUid) idMap.set(user.authUid, internalId);

    const profile = {
      id: internalId,
      email: user.email,
      authUid: user.authUid || (doc.id.length > 20 && !doc.id.startsWith("dummy-") ? doc.id : null),
      displayName: user.displayName || user.email?.split("@")[0] || "User",
      role: user.role || "se",
      teamId: user.teamId ?? null,
      managerId: user.managerId ?? null,
      status: user.status ?? "active",
      createdAt: user.createdAt ?? ts,
      updatedAt: ts,
    };

    if (args.dryRun) {
      console.log(`[dry-run] users/${internalId} ← legacy ${doc.id}`, profile.email);
    } else {
      await db.collection("users").doc(internalId).set(profile, { merge: true });
      if (profile.authUid) {
        await db.collection("authIndex").doc(profile.authUid).set(
          { userId: internalId, email: profile.email, updatedAt: ts },
          { merge: true }
        );
      }
      console.log(`Migrated user ${profile.email}: ${doc.id} → ${internalId}`);
    }
  }

  for (const [oldId, newId] of idMap.entries()) {
    if (oldId === newId) continue;

    const lc = await rewriteOwnerIds(db, "lifecycles", oldId, newId, args.dryRun);
    const prep = await rewriteOwnerIds(db, "prepBriefs", oldId, newId, args.dryRun);
    const calls = await rewriteOwnerIds(db, "postCalls", oldId, newId, args.dryRun);
    const tasks = await rewriteOwnerIds(db, "tasks", oldId, newId, args.dryRun);
    const total = lc + prep + calls + tasks;
    if (total) {
      console.log(`${args.dryRun ? "[dry-run] " : ""}Rewrote ownerId on ${total} doc(s): ${oldId} → ${newId}`);
    }

    const teamsSnap = await db.collection("teams").get();
    for (const teamDoc of teamsSnap.docs) {
      const team = teamDoc.data();
      let changed = false;
      const patch = { ...team };
      if (team.managerId === oldId) {
        patch.managerId = newId;
        changed = true;
      }
      if (Array.isArray(team.memberIds) && team.memberIds.includes(oldId)) {
        patch.memberIds = [...new Set(team.memberIds.map((m) => (m === oldId ? newId : m)))];
        changed = true;
      }
      if (changed) {
        if (args.dryRun) {
          console.log(`[dry-run] teams/${teamDoc.id} manager/members ${oldId} → ${newId}`);
        } else {
          await teamDoc.ref.set({ ...patch, updatedAt: ts }, { merge: true });
        }
      }
    }

    if (args.deleteLegacy && !args.dryRun && oldId !== newId && !oldId.startsWith("usr_")) {
      const legacyRef = db.collection("users").doc(oldId);
      const legacySnap = await legacyRef.get();
      if (legacySnap.exists) {
        await legacyRef.delete();
        console.log(`Deleted legacy user doc users/${oldId}`);
      }
    }
  }

  console.log(args.dryRun ? "Dry run complete." : "Migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
