#!/usr/bin/env node
/**
 * Idempotent backfill: postCalls → callSummaries thin list projection.
 *
 * Usage:
 *   node worker/scripts/backfill-call-summaries.mjs --dry-run
 *   node worker/scripts/backfill-call-summaries.mjs
 *   node worker/scripts/backfill-call-summaries.mjs --batch-size 500
 *
 * Resumable via Firestore cursor doc `_migrations/callSummariesBackfill`.
 * Requires: GOOGLE_APPLICATION_CREDENTIALS or gcloud application-default login
 */

import { buildCallSummaryFromPostCall } from "../../web/domain/call-summary.js";

const CURSOR_PATH = "_migrations/callSummariesBackfill";
const DEFAULT_BATCH = 500;

function parseArgs(argv) {
  const args = { dryRun: false, batchSize: DEFAULT_BATCH };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--batch-size") args.batchSize = Math.max(1, Number(argv[++i]) || DEFAULT_BATCH);
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage:
  node worker/scripts/backfill-call-summaries.mjs [--dry-run] [--batch-size 500]`);
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
    console.error("firebase-admin not installed. Run: cd worker && npm install");
    process.exit(1);
  }
  const admin = mod.default ?? mod;
  if (!admin.apps?.length) {
    admin.initializeApp(projectId ? { projectId } : undefined);
  }
  return admin;
}

/** @param {import("firebase-admin/firestore").Firestore} db */
async function loadCursor(db) {
  const snap = await db.doc(CURSOR_PATH).get();
  if (!snap.exists) {
    return { lastCreatedAt: 0, lastId: "", completed: false, processed: 0, written: 0 };
  }
  return { processed: 0, written: 0, ...snap.data() };
}

/** @param {import("firebase-admin/firestore").Firestore} db @param {object} patch */
async function saveCursor(db, patch, dryRun) {
  if (dryRun) return;
  await db.doc(CURSOR_PATH).set({ ...patch, updatedAt: Date.now() }, { merge: true });
}

/** @param {Map<string, object>} accounts @param {Map<string, object>} deals @param {object} postCall */
function enrichForSummary(accounts, deals, users, scorecardsByCall, followUpCounts, objectionCounts, postCall) {
  const account = accounts.get(postCall.accountId);
  const deal = postCall.dealId ? deals.get(postCall.dealId) : null;
  const owner = users.get(postCall.ownerId);
  const scorecard = scorecardsByCall.get(postCall.id);
  return buildCallSummaryFromPostCall(postCall, {
    ownerName: owner?.displayName || owner?.email || null,
    accountName: account?.name || null,
    dealTitle: deal?.title || null,
    dealStage: deal?.stage || null,
    dealType: deal?.type || null,
    qip: scorecard
      ? {
          overall: scorecard.overall ?? postCall.qualityScore ?? null,
          categoryScores: scorecard.categoryScores || null,
          confidence: scorecard.confidence ?? postCall.analysisConfidence,
          provisional: scorecard.provisional ?? postCall.provisional,
          rubricVersion: scorecard.rubricVersion ?? postCall.rubricVersion,
        }
      : undefined,
    followUpCount: followUpCounts.get(postCall.id) ?? undefined,
    objectionCount: objectionCounts.get(postCall.id) ?? undefined,
    hasVideoFacts: false,
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "";
  const admin = await loadAdmin(projectId || undefined);
  const db = admin.firestore();

  const cursor = await loadCursor(db);
  if (cursor.completed && !args.dryRun) {
    console.log("Backfill already marked complete. Re-run with cursor reset to process again.");
    return;
  }

  const accountsSnap = await db.collection("accounts").get();
  /** @type {Map<string, object>} */
  const accounts = new Map(accountsSnap.docs.map((d) => [d.id, d.data()]));

  const dealsSnap = await db.collection("deals").get();
  /** @type {Map<string, object>} */
  const deals = new Map(dealsSnap.docs.map((d) => [d.id, d.data()]));

  const usersSnap = await db.collection("users").get();
  /** @type {Map<string, object>} */
  const users = new Map(usersSnap.docs.map((d) => [d.id, d.data()]));

  let processed = cursor.processed || 0;
  let written = cursor.written || 0;
  let lastCreatedAt = cursor.lastCreatedAt || 0;
  let lastId = cursor.lastId || "";

  while (true) {
    let q = db.collection("postCalls").orderBy("createdAt", "asc").orderBy(admin.firestore.FieldPath.documentId(), "asc").limit(args.batchSize);
    if (lastCreatedAt > 0 || lastId) {
      q = q.startAfter(lastCreatedAt, lastId);
    }
    const snap = await q.get();
    if (snap.empty) break;

    /** @type {Map<string, object>} */
    const scorecardsByCall = new Map();
    /** @type {Map<string, number>} */
    const followUpCounts = new Map();
    /** @type {Map<string, number>} */
    const objectionCounts = new Map();

    const callIds = snap.docs.map((d) => d.id);
    for (let i = 0; i < callIds.length; i += 30) {
      const chunk = callIds.slice(i, i + 30);
      const [scSnap, fuSnap, obSnap] = await Promise.all([
        db.collection("scorecards").where("callId", "in", chunk).get(),
        db.collection("followUps").where("callId", "in", chunk).get(),
        db.collection("objections").where("callId", "in", chunk).get(),
      ]);
      for (const d of scSnap.docs) {
        const row = d.data();
        if (row.callId && !scorecardsByCall.has(row.callId)) scorecardsByCall.set(row.callId, row);
      }
      for (const d of fuSnap.docs) {
        const id = d.data().callId;
        if (id) followUpCounts.set(id, (followUpCounts.get(id) || 0) + 1);
      }
      for (const d of obSnap.docs) {
        const id = d.data().callId;
        if (id) objectionCounts.set(id, (objectionCounts.get(id) || 0) + 1);
      }
    }

    const batch = args.dryRun ? null : db.batch();
    for (const doc of snap.docs) {
      const postCall = { id: doc.id, ...doc.data() };
      processed += 1;
      const summary = enrichForSummary(
        accounts,
        deals,
        users,
        scorecardsByCall,
        followUpCounts,
        objectionCounts,
        postCall,
      );
      written += 1;
      if (args.dryRun) {
        console.log(`[dry-run] callSummaries/${summary.id} ← postCalls/${postCall.id}`);
      } else {
        batch.set(db.collection("callSummaries").doc(summary.id), summary, { merge: true });
      }
      lastCreatedAt = postCall.createdAt || lastCreatedAt;
      lastId = doc.id;
    }

    if (!args.dryRun && batch) {
      await batch.commit();
    }

    await saveCursor(
      db,
      { lastCreatedAt, lastId, processed, written, completed: false },
      args.dryRun,
    );
    console.log(`Processed ${processed} postCalls (${written} summaries written) — cursor ${lastCreatedAt}/${lastId}`);

    if (snap.size < args.batchSize) break;
  }

  await saveCursor(
    db,
    { lastCreatedAt, lastId, processed, written, completed: true },
    args.dryRun,
  );

  console.log(
    args.dryRun
      ? `Dry run complete. ${written} summary(ies) would be written from ${processed} postCall(s).`
      : `Backfill complete. ${written} callSummaries written from ${processed} postCalls.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
