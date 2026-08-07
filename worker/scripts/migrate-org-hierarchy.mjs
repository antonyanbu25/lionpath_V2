#!/usr/bin/env node
/**
 * Backfill orgId on users, teams, and lifecycle artifacts for existing Firestore data.
 * Optionally backfill org.seniorLeaderIds from known Freshworks CX SE emails.
 *
 * Usage:
 *   node worker/scripts/migrate-org-hierarchy.mjs
 *   node worker/scripts/migrate-org-hierarchy.mjs --dry-run
 *   node worker/scripts/migrate-org-hierarchy.mjs --org-id org_freshworks_se --team-id demo-team
 */

import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_ORG_ID = "org_freshworks_se";
const LEGACY_TEAM_ID = "demo-team";
const DIRECTOR_EMAIL = "vipin.thomas@freshworks.com";
const SENIOR_LEADER_EMAILS = [
  "antony.sagayaraj@freshworks.com",
  "preethi.sri@freshworks.com",
  "preethi.sriram@freshworks.com",
];

function parseArgs(argv) {
  const args = {
    dryRun: false,
    orgId: DEFAULT_ORG_ID,
    legacyTeamId: LEGACY_TEAM_ID,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--org-id") args.orgId = argv[++i];
    else if (argv[i] === "--team-id") args.legacyTeamId = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage: node worker/scripts/migrate-org-hierarchy.mjs [--dry-run] [--org-id id] [--team-id legacyTeamId]`);
      process.exit(0);
    }
  }
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

async function patchCollection(db, name, predicate, patchFn, dryRun) {
  const snap = await db.collection(name).get();
  let count = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    if (!predicate(data)) continue;
    const patch = patchFn(data);
    if (!patch || !Object.keys(patch).length) continue;
    count++;
    if (dryRun) {
      console.log(`[dry-run] ${name}/${doc.id}:`, patch);
    } else {
      await doc.ref.set(patch, { merge: true });
    }
  }
  return count;
}

async function resolveUserIdsByEmail(db, emails) {
  const snap = await db.collection("users").get();
  const emailToId = new Map();
  for (const doc of snap.docs) {
    const email = String(doc.data()?.email || "").trim().toLowerCase();
    if (email) emailToId.set(email, doc.id);
  }
  return emails.map((e) => emailToId.get(e.trim().toLowerCase())).filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv);
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "";
  const admin = await loadAdmin(projectId || undefined);
  const db = admin.firestore();
  const ts = Date.now();

  const orgRef = db.collection("orgs").doc(args.orgId);
  const orgSnap = await orgRef.get();
  const existingOrg = orgSnap.exists ? orgSnap.data() : {};

  let directorId = existingOrg.directorId || null;
  let seniorLeaderIds = existingOrg.seniorLeaderIds || [];
  let seniorLeaderEmails = existingOrg.seniorLeaderEmails || [];
  let directorEmail = existingOrg.directorEmail || null;

  const [directorIds, seniorIds] = await Promise.all([
    resolveUserIdsByEmail(db, [DIRECTOR_EMAIL]),
    resolveUserIdsByEmail(db, SENIOR_LEADER_EMAILS),
  ]);

  if (directorIds[0] && (!directorId || String(directorId).startsWith("usr_dummy_"))) {
    directorId = directorIds[0];
  }
  if (!directorEmail) directorEmail = DIRECTOR_EMAIL;
  if (!seniorLeaderIds.length && seniorIds.length) {
    seniorLeaderIds = seniorIds;
  }
  if (!seniorLeaderEmails.length) {
    seniorLeaderEmails = SENIOR_LEADER_EMAILS.map((e) => e.trim().toLowerCase());
  }

  if (!directorId) {
    const teamsSnap = await db.collection("teams").get();
    for (const t of teamsSnap.docs) {
      const data = t.data();
      if (data.managerId && !directorId) directorId = data.managerId;
    }
  }

  const teamsSnap = await db.collection("teams").get();

  const orgDoc = {
    id: args.orgId,
    name: existingOrg.name || "Freshworks CX Solution Engineering",
    directorId: directorId || "",
    directorEmail: directorEmail || "",
    seniorLeaderIds,
    seniorLeaderEmails,
    teamIds: teamsSnap.docs.map((d) => d.id),
    updatedAt: ts,
  };
  if (!orgSnap.exists) orgDoc.createdAt = ts;

  if (args.dryRun) {
    console.log("[dry-run] Would upsert org:", orgDoc);
  } else {
    await orgRef.set(orgDoc, { merge: true });
    console.log(
      `Org ${args.orgId} ready (directorId=${orgDoc.directorId || "(none)"}, seniorLeaders=${seniorLeaderIds.length}).`
    );
  }

  const teamCount = await patchCollection(
    db,
    "teams",
    () => true,
    (data) => ({ orgId: data.orgId || args.orgId, updatedAt: ts }),
    args.dryRun
  );

  const userCount = await patchCollection(
    db,
    "users",
    () => true,
    (data) => {
      const patch = { updatedAt: ts };
      if (!data.orgId) patch.orgId = args.orgId;
      if (data.teamId === args.legacyTeamId && !data.orgId) patch.orgId = args.orgId;
      return patch;
    },
    args.dryRun
  );

  for (const col of ["lifecycles", "prepBriefs", "postCalls", "tasks"]) {
    const n = await patchCollection(
      db,
      col,
      (data) => !data.orgId && !!data.teamId,
      (data) => ({ orgId: args.orgId, updatedAt: ts }),
      args.dryRun
    );
    console.log(`${col}: ${n} document(s) ${args.dryRun ? "would be" : ""} patched with orgId`);
  }

  console.log(`teams: ${teamCount}, users: ${userCount} ${args.dryRun ? "would be" : ""} patched`);
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
