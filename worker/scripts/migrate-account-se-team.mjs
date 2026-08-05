#!/usr/bin/env node
/**
 * One-off migration: backfill account.seTeam from active lifecycles.
 * Run once after deploy — list/detail reads must never write seTeam.
 *
 * Usage:
 *   node worker/scripts/migrate-account-se-team.mjs [--dry-run]
 */

import { loadEnv } from "./lib/load-env.mjs";

await loadEnv();

const dryRun = process.argv.includes("--dry-run");

const adminMod = await import("firebase-admin");
const admin = adminMod.default ?? adminMod;
if (!admin.apps?.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
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

const db = admin.firestore();
const MAX_SE_TEAM_SIZE = 5;

async function listActiveLifecyclesForAccount(accountId) {
  const snap = await db
    .collection("lifecycles")
    .where("accountId", "==", accountId)
    .where("status", "==", "active")
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function main() {
  const accountsSnap = await db.collection("accounts").get();
  let updated = 0;
  let skipped = 0;

  for (const doc of accountsSnap.docs) {
    const account = { id: doc.id, ...doc.data() };
    if (account.seTeam?.length) {
      skipped += 1;
      continue;
    }

    const lifecycles = await listActiveLifecyclesForAccount(account.id);
    if (!lifecycles.length) {
      skipped += 1;
      continue;
    }

    const sorted = [...lifecycles].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const ts = Date.now();
    const seTeam = [];
    const seen = new Set();

    for (const lc of sorted) {
      if (seTeam.length >= MAX_SE_TEAM_SIZE) break;
      const ownerId = lc.ownerId;
      if (!ownerId || seen.has(ownerId)) continue;
      seen.add(ownerId);
      seTeam.push({
        seUserId: ownerId,
        role: seTeam.length === 0 ? "primary" : "secondary",
        addedAt: lc.createdAt || ts,
      });
    }

    const primarySeUserId = seTeam.find((m) => m.role === "primary")?.seUserId || seTeam[0]?.seUserId || null;
    const patch = { seTeam, primarySeUserId, updatedAt: ts };

    if (dryRun) {
      console.log("[dry-run] Would update account", account.id, patch);
    } else {
      await doc.ref.set(patch, { merge: true });
    }
    updated += 1;
  }

  console.log(`Done. updated=${updated} skipped=${skipped} dryRun=${dryRun}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
