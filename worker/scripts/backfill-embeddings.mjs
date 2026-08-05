#!/usr/bin/env node
/**
 * Backfill precomputed RAG embeddings for callSummaries, accounts, and deals.
 *
 * Re-embeds when embedding is missing or embeddingModel !== current model.
 *
 * Usage:
 *   node worker/scripts/backfill-embeddings.mjs --dry-run
 *   node worker/scripts/backfill-embeddings.mjs
 *   node worker/scripts/backfill-embeddings.mjs --collection callSummaries --batch-size 100
 *   node worker/scripts/backfill-embeddings.mjs --delay-ms 150
 *
 * Env (auto-loaded from worker/.dev.vars and repo .env via loadEnv):
 *   FIREBASE_PROJECT_ID — required (also GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC)
 *   GEMINI_API_KEY — required for real run (not --dry-run)
 */

import {
  buildAccountSearchableText,
  buildCallSearchableText,
  buildDealSearchableText,
} from "../../web/domain/rag-embed-text.js";
import { loadEnv, requireFirebaseProjectId } from "./lib/load-env.mjs";

const EMBEDDING_MODEL = "text-embedding-004";
const CURSOR_PATH = "_migrations/embeddingsBackfill";
const DEFAULT_BATCH = 100;
const DEFAULT_DELAY_MS = 120;

function geminiKeyHelp() {
  return `GEMINI_API_KEY is required for a real backfill (not --dry-run).

Set it in one of:
  • worker/.dev.vars   (copy from worker/.dev.vars.example — same as npm run dev:node)
  • .env at repo root
  • shell:  $env:GEMINI_API_KEY="your-key"   (PowerShell)
            export GEMINI_API_KEY=your-key   (bash)

Get a key: https://aistudio.google.com/apikey`;
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    verbose: false,
    batchSize: DEFAULT_BATCH,
    delayMs: DEFAULT_DELAY_MS,
    collection: "all",
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--verbose" || argv[i] === "-v") args.verbose = true;
    else if (argv[i] === "--batch-size") args.batchSize = Math.max(1, Number(argv[++i]) || DEFAULT_BATCH);
    else if (argv[i] === "--delay-ms") args.delayMs = Math.max(0, Number(argv[++i]) || DEFAULT_DELAY_MS);
    else if (argv[i] === "--collection") args.collection = String(argv[++i] || "all");
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log(`Usage:
  node worker/scripts/backfill-embeddings.mjs [--dry-run] [--verbose] [--batch-size 100] [--delay-ms 120] [--collection all|callSummaries|accounts|deals]

Env (worker/.dev.vars, repo .env, or shell):
  FIREBASE_PROJECT_ID — required
  GOOGLE_APPLICATION_CREDENTIALS — service account JSON path (or gcloud ADC)
  GEMINI_API_KEY — required for real run (not --dry-run)`);
      process.exit(0);
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function needsEmbed(row) {
  const emb = row?.embedding;
  const model = row?.embeddingModel;
  if (!Array.isArray(emb) || emb.length !== 768) return true;
  return model !== EMBEDDING_MODEL;
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
    admin.initializeApp({ projectId });
  }
  return admin;
}

async function embedText(text, apiKey) {
  const trimmed = String(text || "").trim();
  if (!trimmed || !apiKey) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text: trimmed.slice(0, 2048) }] },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `embed HTTP ${res.status}`);
  }
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || !values.length) return null;
  return { embedding: values, embeddingModel: EMBEDDING_MODEL };
}

/** @param {import("firebase-admin/firestore").Firestore} db */
async function loadCursor(db) {
  const snap = await db.doc(CURSOR_PATH).get();
  if (!snap.exists) {
    return { lastCollection: "", lastId: "", processed: 0, written: 0, completed: false };
  }
  return { processed: 0, written: 0, ...snap.data() };
}

/** @param {import("firebase-admin/firestore").Firestore} db */
async function saveCursor(db, patch, dryRun) {
  if (dryRun) return;
  await db.doc(CURSOR_PATH).set({ ...patch, updatedAt: Date.now() }, { merge: true });
}

/** @param {object} row */
function callSummaryText(row) {
  return buildCallSearchableText(row);
}

/** @param {Map<string, object[]>} contactsByAccount @param {object} row */
function accountText(contactsByAccount, row) {
  const contacts = contactsByAccount.get(row.id) || [];
  return buildAccountSearchableText(row, contacts);
}

/** @param {Map<string, object>} accounts @param {object} row */
function dealText(accounts, row) {
  const account = accounts.get(row.accountId);
  return buildDealSearchableText(row, account);
}

/** Resume only within the same collection; ignore cursor when a prior run finished. */
function resumeLastId(cursorState, col) {
  if (cursorState.completed) return "";
  if (cursorState.lastCollection !== col) return "";
  return cursorState.lastId || "";
}

/** @param {import("firebase-admin/firestore").Firestore} db @param {string} col @param {object} args @param {string} apiKey @param {Map<string, object>} accounts @param {Map<string, object[]>} contactsByAccount @param {object} cursorState */
async function backfillCollection(db, col, args, apiKey, accounts, contactsByAccount, cursorState) {
  let processed = 0;
  let written = 0;
  let lastId = resumeLastId(cursorState, col);
  let skippedHasEmbed = 0;
  let skippedNoText = 0;

  if (args.verbose) {
    const total = (await db.collection(col).count().get()).data().count;
    console.log(
      `[verbose] ${col}: ${total} doc(s) in project; resume after id=${lastId || "(start)"}`,
    );
  }

  while (true) {
    let q = db.collection(col).orderBy(admin.firestore.FieldPath.documentId()).limit(args.batchSize);
    if (lastId) q = q.startAfter(lastId);

    const snap = await q.get();
    if (snap.empty) break;

    const batch = args.dryRun ? null : db.batch();
    let batchWrites = 0;
    for (const doc of snap.docs) {
      processed += 1;
      const row = { id: doc.id, ...doc.data() };
      if (!needsEmbed(row)) {
        skippedHasEmbed += 1;
        lastId = doc.id;
        continue;
      }

      let text = "";
      if (col === "callSummaries") text = callSummaryText(row);
      else if (col === "accounts") text = accountText(contactsByAccount, row);
      else if (col === "deals") text = dealText(accounts, row);

      if (!text) {
        skippedNoText += 1;
        lastId = doc.id;
        continue;
      }

      if (args.dryRun) {
        console.log(`[dry-run] ${col}/${doc.id} ← ${text.slice(0, 80)}…`);
        written += 1;
        lastId = doc.id;
        await sleep(args.delayMs);
        continue;
      }

      const result = await embedText(text, apiKey);
      if (!result) {
        console.warn(`[backfill] embed skipped ${col}/${doc.id} (no vector)`);
        lastId = doc.id;
        await sleep(args.delayMs);
        continue;
      }

      batch.update(doc.ref, {
        embedding: result.embedding,
        embeddingModel: result.embeddingModel,
        updatedAt: Date.now(),
      });
      batchWrites += 1;
      written += 1;
      lastId = doc.id;
      await sleep(args.delayMs);
    }

    if (!args.dryRun && batch && batchWrites > 0) {
      await batch.commit();
    }

    await saveCursor(
      db,
      { lastCollection: col, lastId, processed, written, completed: false },
      args.dryRun,
    );
    console.log(`[${col}] processed=${processed} written=${written} cursor=${lastId}`);

    if (snap.size < args.batchSize) break;
  }

  if (args.verbose) {
    console.log(
      `[verbose] ${col}: scanned=${processed} would_embed=${written} already_ok=${skippedHasEmbed} no_text=${skippedNoText}`,
    );
  }

  return { processed, written, lastId };
}

let admin;

async function main() {
  loadEnv();
  const args = parseArgs(process.argv);
  const projectId = requireFirebaseProjectId("worker/scripts/backfill-embeddings.mjs");
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!args.dryRun && !apiKey) {
    console.error(geminiKeyHelp());
    process.exit(1);
  }

  admin = await loadAdmin(projectId);
  const db = admin.firestore();

  const cursor = await loadCursor(db);
  const collections =
    args.collection === "all"
      ? ["callSummaries", "accounts", "deals"]
      : [args.collection];

  const accountsSnap = await db.collection("accounts").get();
  /** @type {Map<string, object>} */
  const accounts = new Map(accountsSnap.docs.map((d) => [d.id, d.data()]));

  const contactsSnap = await db.collection("contacts").get();
  /** @type {Map<string, object[]>} */
  const contactsByAccount = new Map();
  for (const d of contactsSnap.docs) {
    const row = d.data();
    const accountId = row.accountId;
    if (!accountId) continue;
    const list = contactsByAccount.get(accountId) || [];
    list.push(row);
    contactsByAccount.set(accountId, list);
  }

  if (args.verbose) {
    console.log(`[verbose] project=${projectId}`);
    console.log(
      `[verbose] cursor _migrations/embeddingsBackfill:`,
      cursor.lastCollection
        ? {
            lastCollection: cursor.lastCollection,
            lastId: cursor.lastId || "",
            completed: !!cursor.completed,
          }
        : "(missing — full scan)",
    );
    console.log(
      `[verbose] preload: accounts=${accounts.size} contacts=${contactsSnap.size}`,
    );
  }

  let processed = 0;
  let written = 0;
  let lastId = "";

  for (const col of collections) {
    const result = await backfillCollection(
      db,
      col,
      args,
      apiKey,
      accounts,
      contactsByAccount,
      cursor,
    );
    processed += result.processed;
    written += result.written;
    lastId = result.lastId;
  }

  await saveCursor(
    db,
    { lastCollection: collections[collections.length - 1], lastId, processed, written, completed: true },
    args.dryRun,
  );

  console.log(
    args.dryRun
      ? `Dry run complete. ${written} doc(s) would be embedded (${processed} scanned).`
      : `Backfill complete. ${written} embedding(s) written (${processed} scanned).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
