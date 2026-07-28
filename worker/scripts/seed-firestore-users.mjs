#!/usr/bin/env node
/**
 * Bootstrap Firestore teams and user roles for Firebase Google SSO.
 *
 * Requires Firebase Admin SDK credentials:
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Usage:
 *   node worker/scripts/seed-firestore-users.mjs --bootstrap-team
 *   node worker/scripts/seed-firestore-users.mjs --csv worker/scripts/seed-users.example.csv
 *   node worker/scripts/seed-firestore-users.mjs --bootstrap-team --csv worker/scripts/seed-users.example.csv
 *
 * CSV columns: email,role,teamId,displayName,orgId,managerEmail (displayName/orgId/managerEmail optional)
 * Roles: se | manager | admin
 *
 * Users must exist in Firebase Auth (sign in with Google once) before role assignment.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  TEAM_AJAY_ID,
  TEAM_DISPLAY_NAMES,
  TEAM_NAME_INTERNATIONAL_NB,
} from "../../web/domain/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_ORG_ID = "org_freshworks_se";
const DIRECTOR_EMAIL = "vipin.thomas@freshworks.com";
const SENIOR_LEADER_EMAILS = [
  "antony.sagayaraj@freshworks.com",
  "preethi.sri@freshworks.com",
  "preethi.sriram@freshworks.com",
];
const ALLOWED_ROLES = new Set(["se", "manager", "admin"]);

function newUserId() {
  return `usr_${crypto.randomUUID()}`;
}

function parseArgs(argv) {
  const args = {
    csv: "",
    bootstrapTeam: false,
    teamId: TEAM_AJAY_ID,
    teamName: TEAM_NAME_INTERNATIONAL_NB,
    orgId: DEMO_ORG_ID,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--csv") args.csv = argv[++i];
    else if (argv[i] === "--bootstrap-team") args.bootstrapTeam = true;
    else if (argv[i] === "--team-id") args.teamId = argv[++i];
    else if (argv[i] === "--team-name") args.teamName = argv[++i];
    else if (argv[i] === "--org-id") args.orgId = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage:
  node worker/scripts/seed-firestore-users.mjs --bootstrap-team
  node worker/scripts/seed-firestore-users.mjs --csv path/to/users.csv
Options:
  --team-id       Team document id (default: demo-team)
  --team-name     Display name for bootstrap team
  --dry-run       Print actions without writing`);
      process.exit(0);
    }
  }
  return args;
}

function nowIso() {
  return new Date().toISOString();
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

async function dryRunCsv(csvPath) {
  const text = await fs.readFile(csvPath, "utf8");
  const rows = parseCsv(text);
  for (const row of rows) {
    console.log("[dry-run] Would assign:", row);
  }
  console.log(`[dry-run] ${rows.length} user row(s) from ${csvPath}`);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && /^email,/i.test(line)) continue;
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length < 3) {
      console.warn(`Skipping invalid CSV line: ${line}`);
      continue;
    }
    const [email, role, teamId, displayName, orgId, managerEmail] = parts;
    if (!email || !role || !teamId) continue;
    const normalizedRole = role.toLowerCase();
    if (!ALLOWED_ROLES.has(normalizedRole)) {
      console.warn(`Skipping ${email}: invalid role "${role}"`);
      continue;
    }
    rows.push({
      email: email.toLowerCase(),
      role: normalizedRole,
      teamId: teamId === "-" ? null : teamId,
      displayName: displayName || email.split("@")[0],
      orgId: orgId || DEMO_ORG_ID,
      managerEmail: managerEmail ? managerEmail.toLowerCase() : null,
    });
  }
  return rows;
}

async function bootstrapTeam(db, args) {
  const ts = nowIso();
  const ref = db.collection("teams").doc(args.teamId);
  const snap = await ref.get();
  const data = {
    id: args.teamId,
    name: args.teamName,
    orgId: args.orgId,
    managerId: "",
    memberIds: [],
    createdAt: snap.exists ? snap.data()?.createdAt || ts : ts,
    updatedAt: ts,
  };
  if (args.dryRun) {
    console.log("[dry-run] Would upsert team:", data);
    return;
  }
  await ref.set(data, { merge: true });
  console.log(`Team ${args.teamId} ready.`);

  const orgRef = db.collection("orgs").doc(args.orgId);
  const orgSnap = await orgRef.get();
  const orgData = {
    id: args.orgId,
    name: orgSnap.exists ? orgSnap.data()?.name : "Freshworks CX Solution Engineering",
    directorId: orgSnap.exists ? orgSnap.data()?.directorId || "" : "",
    seniorLeaderIds: orgSnap.exists ? orgSnap.data()?.seniorLeaderIds || [] : [],
    teamIds: [...new Set([...(orgSnap.exists ? orgSnap.data()?.teamIds || [] : []), args.teamId])],
    updatedAt: ts,
  };
  if (!orgSnap.exists) orgData.createdAt = ts;
  if (args.dryRun) {
    console.log("[dry-run] Would upsert org:", orgData);
  } else {
    await orgRef.set(orgData, { merge: true });
    console.log(`Org ${args.orgId} ready.`);
  }
}

async function assignUsers(admin, db, rows, dryRun) {
  const auth = admin.auth();
  const ts = nowIso();
  const teamMembers = new Map();
  const emailToInternalId = new Map();

  for (const row of rows) {
    let authUid;
    try {
      const record = await auth.getUserByEmail(row.email);
      authUid = record.uid;
    } catch (err) {
      console.warn(`Skip ${row.email}: not in Firebase Auth (${err.code || err.message}). Sign in with Google once first.`);
      continue;
    }

    const existingByEmail = await db.collection("users").where("email", "==", row.email).limit(1).get();
    const existingDoc = existingByEmail.empty ? null : existingByEmail.docs[0];
    const existingData = existingDoc?.data() || {};

    const internalId =
      existingData.id?.startsWith("usr_")
        ? existingData.id
        : existingDoc?.id?.startsWith("usr_")
          ? existingDoc.id
          : newUserId();

    const userRef = db.collection("users").doc(internalId);
    const userDoc = {
      id: internalId,
      email: row.email,
      authUid,
      displayName: row.displayName,
      role: row.role,
      teamId: row.teamId,
      orgId: row.orgId,
      managerId: existingData.managerId ?? null,
      status: existingData.status ?? "active",
      createdAt: existingData.createdAt || ts,
      updatedAt: ts,
    };

    emailToInternalId.set(row.email, internalId);

    if (dryRun) {
      console.log("[dry-run] Would upsert user:", userDoc);
      console.log("[dry-run] Would upsert authIndex:", { authUid, userId: internalId });
    } else {
      await userRef.set(userDoc, { merge: true });
      await db.collection("authIndex").doc(authUid).set(
        { userId: internalId, email: row.email, updatedAt: Date.now() },
        { merge: true }
      );
      console.log(`User ${row.email} → id=${internalId}, role=${row.role}, teamId=${row.teamId}`);
    }

    if (row.role === "se" && row.teamId) {
      const list = teamMembers.get(row.teamId) || [];
      list.push(internalId);
      teamMembers.set(row.teamId, list);
    }
  }

  for (const row of rows) {
    if (!row.managerEmail) continue;
    const userId = emailToInternalId.get(row.email);
    const managerId = emailToInternalId.get(row.managerEmail);
    if (!userId || !managerId) continue;
    if (dryRun) {
      console.log(`[dry-run] Would set managerId for ${row.email} → ${row.managerEmail}`);
    } else {
      await db.collection("users").doc(userId).set({ managerId, updatedAt: ts }, { merge: true });
    }
  }

  const directorId = emailToInternalId.get(DIRECTOR_EMAIL) || "";
  const seniorLeaderIds = SENIOR_LEADER_EMAILS
    .map((e) => emailToInternalId.get(e))
    .filter(Boolean);
  const orgRef = db.collection("orgs").doc(DEMO_ORG_ID);
  const orgPatch = {
    name: "Freshworks CX Solution Engineering",
    updatedAt: ts,
  };
  if (directorId) orgPatch.directorId = directorId;
  if (seniorLeaderIds.length) orgPatch.seniorLeaderIds = seniorLeaderIds;

  if (directorId || seniorLeaderIds.length) {
    if (dryRun) {
      console.log("[dry-run] Would update org:", orgPatch);
    } else {
      await orgRef.set(orgPatch, { merge: true });
      console.log(`Org ${DEMO_ORG_ID}: directorId=${directorId || "(none)"}, seniorLeaders=${seniorLeaderIds.length}`);
    }
  }

  for (const [teamId, memberIds] of teamMembers) {
    const teamRef = db.collection("teams").doc(teamId);
    const teamSnap = await teamRef.get();
    const existing = teamSnap.exists ? teamSnap.data() : {};
    const teamManagerRow = rows.find((r) => r.role === "manager" && r.teamId === teamId);
    const teamManagerId = teamManagerRow ? emailToInternalId.get(teamManagerRow.email) : "";
    const mergedMembers = [...new Set([...(existing.memberIds || []), ...memberIds])];
    const patch = {
      id: teamId,
      name: TEAM_DISPLAY_NAMES[teamId] || existing.name || "SE Team",
      orgId: existing.orgId || DEMO_ORG_ID,
      managerId: existing.managerId || teamManagerId || "",
      memberIds: mergedMembers,
      updatedAt: ts,
    };
    if (!teamSnap.exists) patch.createdAt = ts;

    if (dryRun) {
      console.log("[dry-run] Would update team:", patch);
    } else {
      await teamRef.set(patch, { merge: true });
      console.log(`Team ${teamId}: ${mergedMembers.length} SE member(s), managerId=${patch.managerId || "(none)"}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.bootstrapTeam && !args.csv) {
    console.error("Provide --bootstrap-team and/or --csv. Use --help for usage.");
    process.exit(1);
  }

  if (args.dryRun && args.csv && !args.bootstrapTeam) {
    await dryRunCsv(path.resolve(process.cwd(), args.csv));
    console.log("Done.");
    return;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "";
  const admin = await loadAdmin(projectId || undefined);
  const db = admin.firestore();

  if (args.bootstrapTeam) {
    await bootstrapTeam(db, args);
  }

  if (args.csv) {
    const csvPath = path.resolve(process.cwd(), args.csv);
    const text = await fs.readFile(csvPath, "utf8");
    const rows = parseCsv(text);
    if (!rows.length) {
      console.warn("No valid rows in CSV.");
    } else {
      await assignUsers(admin, db, rows, args.dryRun);
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
