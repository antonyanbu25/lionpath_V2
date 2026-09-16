#!/usr/bin/env node
/**
 * Idempotent backfill: satellite collections → postCalls.detail embed.
 *
 * Usage:
 *   node worker/scripts/backfill-postcall-detail.mjs --dry-run
 *   node worker/scripts/backfill-postcall-detail.mjs
 *   node worker/scripts/backfill-postcall-detail.mjs --batch-size 200
 *
 * Resumable via Firestore cursor doc `_migrations/postCallDetailBackfill`.
 * Requires: GOOGLE_APPLICATION_CREDENTIALS or gcloud application-default login
 */

const CURSOR_PATH = "_migrations/postCallDetailBackfill";
const DEFAULT_BATCH = 200;

const CHILD_COLLECTIONS = [
  { col: "videoFacts", key: "videoFacts" },
  { col: "timelineSegments", key: "timelineSegments" },
  { col: "timelineMarkers", key: "timelineMarkers" },
  { col: "tcDeltas", key: "tcDeltas" },
  { col: "meddpiccDeltas", key: "meddpiccDeltas" },
  { col: "objections", key: "objections" },
  { col: "followUps", key: "followUps" },
  { col: "momDrafts", key: "momDrafts" },
  { col: "dealSignals", key: "dealSignals" },
];

function parseArgs(argv) {
  const args = { dryRun: false, batchSize: DEFAULT_BATCH };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--batch-size") args.batchSize = Math.max(1, Number(argv[++i]) || DEFAULT_BATCH);
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage:
  node worker/scripts/backfill-postcall-detail.mjs [--dry-run] [--batch-size 200]`);
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
  if (!snap.exists) return { lastId: null, processed: 0, updated: 0 };
  return snap.data() || { lastId: null, processed: 0, updated: 0 };
}

/** @param {import("firebase-admin/firestore").Firestore} db */
async function saveCursor(db, cursor) {
  await db.doc(CURSOR_PATH).set({ ...cursor, updatedAt: Date.now() }, { merge: true });
}

/** @param {import("firebase-admin/firestore").Firestore} db @param {string} callId */
async function loadLegacyDetail(db, callId) {
  /** @type {Record<string, object[]>} */
  const detail = {};
  for (const { col, key } of CHILD_COLLECTIONS) {
    const snap = await db.collection(col).where("callId", "==", callId).get();
    detail[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  for (const col of ["productGaps", "whatWorks"]) {
    const snap = await db.collection(col).where("postCallId", "==", callId).get();
    detail[col] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  return detail;
}

function detailHasRows(detail) {
  return Object.values(detail).some((rows) => Array.isArray(rows) && rows.length);
}

async function main() {
  const args = parseArgs(process.argv);
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || undefined;
  const admin = await loadAdmin(projectId);
  const db = admin.firestore();
  const cursor = await loadCursor(db);

  let q = db.collection("postCalls").orderBy("__name__").limit(args.batchSize);
  if (cursor.lastId) q = q.startAfter(cursor.lastId);

  const snap = await q.get();
  if (snap.empty) {
    console.log("Backfill complete.", cursor);
    return;
  }

  let updated = 0;
  /** @type {string|null} */
  let lastId = cursor.lastId;

  for (const doc of snap.docs) {
    lastId = doc.id;
    const data = doc.data();
    const existing = data.detail || {};
    const hasEmbedded = Object.values(existing).some((v) => Array.isArray(v) && v.length);
    if (hasEmbedded) continue;

    const legacy = await loadLegacyDetail(db, doc.id);
    if (!detailHasRows(legacy)) continue;

    const patch = {
      detail: legacy,
      updatedAt: Date.now(),
    };

    if (args.dryRun) {
      console.log("[dry-run] would embed detail for", doc.id, Object.fromEntries(
        Object.entries(legacy).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
      ));
    } else {
      await doc.ref.set(patch, { merge: true });
    }
    updated++;
  }

  const nextCursor = {
    lastId,
    processed: (cursor.processed || 0) + snap.size,
    updated: (cursor.updated || 0) + updated,
  };
  if (!args.dryRun) await saveCursor(db, nextCursor);

  console.log(
    args.dryRun ? "[dry-run]" : "Batch done:",
    `scanned=${snap.size}`,
    `embedded=${updated}`,
    `cursor=${lastId}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
