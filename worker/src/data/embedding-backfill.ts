/**
 * RAG embedding backfill — shared by nightly batch enqueue and CLI script.
 */

import type { FirestoreDoc, FirestoreEnv } from "./firestore-admin";
import { getDb, getDoc, queryBy, setDoc } from "./firestore-admin";
import { EMBEDDING_MODEL } from "../embeddings";

export const EMBEDDING_BACKFILL_CURSOR = "_migrations/embeddingsBackfill";
export const EMBEDDING_BACKFILL_CHUNK = 500;

export interface EmbeddingBackfillDoc {
  collection: string;
  docId: string;
  text: string;
}

export interface EmbeddingBackfillCursor {
  lastCollection: string;
  lastId: string;
  processed: number;
  written: number;
  completed: boolean;
}

export function needsEmbed(row: FirestoreDoc): boolean {
  const emb = row.embedding;
  const model = row.embeddingModel;
  if (!Array.isArray(emb) || emb.length !== 768) return true;
  return model !== EMBEDDING_MODEL;
}

export async function loadEmbeddingCursor(env?: FirestoreEnv): Promise<EmbeddingBackfillCursor> {
  const doc = await getDoc("_migrations", "embeddingsBackfill", env);
  if (!doc) {
    return { lastCollection: "", lastId: "", processed: 0, written: 0, completed: false };
  }
  return {
    lastCollection: String(doc.lastCollection || ""),
    lastId: String(doc.lastId || ""),
    processed: Number(doc.processed || 0),
    written: Number(doc.written || 0),
    completed: doc.completed === true,
  };
}

export async function saveEmbeddingCursor(
  patch: Partial<EmbeddingBackfillCursor>,
  env?: FirestoreEnv,
): Promise<void> {
  await setDoc("_migrations", "embeddingsBackfill", { ...patch, updatedAt: Date.now() }, env);
}

function resumeLastId(cursor: EmbeddingBackfillCursor, col: string): string {
  if (cursor.completed) return "";
  if (cursor.lastCollection !== col) return "";
  return cursor.lastId || "";
}

/** Build searchable text for a document (minimal inline — full text from rag-embed-text in script). */
export function buildMinimalSearchableText(col: string, row: FirestoreDoc): string {
  if (col === "callSummaries") {
    const parts = [row.aiShortForm, row.accountName, row.dealTitle, row.callType]
      .map((p) => String(p || "").trim())
      .filter(Boolean);
    return parts.join(" ").slice(0, 2048);
  }
  if (col === "accounts") {
    return String(row.name || row.domain || "").trim().slice(0, 2048);
  }
  if (col === "deals") {
    return String(row.title || row.type || "").trim().slice(0, 2048);
  }
  return "";
}

/** Query next chunk of docs needing embedding backfill. */
export async function queryEmbeddingBackfillChunk(
  collection: string,
  cursor: EmbeddingBackfillCursor,
  limit: number,
  env?: FirestoreEnv,
): Promise<EmbeddingBackfillDoc[]> {
  const db = await getDb(env);
  const lastId = resumeLastId(cursor, collection);
  let q = db.collection(collection).orderBy("__name__").limit(limit);
  if (lastId) q = q.startAfter(lastId);

  const snap = await q.get();
  const out: EmbeddingBackfillDoc[] = [];
  for (const doc of snap.docs) {
    const row: FirestoreDoc = { id: doc.id, ...(doc.data() as Record<string, unknown>) };
    if (!needsEmbed(row)) continue;
    const text = buildMinimalSearchableText(collection, row);
    if (!text.trim()) continue;
    out.push({ collection, docId: doc.id, text });
  }
  return out;
}

export async function persistEmbeddingResult(
  collection: string,
  docId: string,
  embedding: number[],
  env?: FirestoreEnv,
): Promise<void> {
  await setDoc(
    collection,
    docId,
    {
      embedding,
      embeddingModel: EMBEDDING_MODEL,
      updatedAt: Date.now(),
    },
    env,
  );
}

export function nextBackfillCollection(cursor: EmbeddingBackfillCursor): string {
  const order = ["callSummaries", "accounts", "deals"];
  if (cursor.completed) return order[0];
  if (!cursor.lastCollection) return order[0];
  const idx = order.indexOf(cursor.lastCollection);
  if (idx < 0) return order[0];
  if (cursor.lastId) return cursor.lastCollection;
  return order[Math.min(idx + 1, order.length - 1)] || order[0];
}

/** List accounts/deals preload not needed for minimal text path. */
export async function countPendingEmbeds(env?: FirestoreEnv): Promise<number> {
  let total = 0;
  for (const col of ["callSummaries", "accounts", "deals"]) {
    const rows = await queryBy(col, [], { field: "__name__", direction: "asc" }, 200, env);
    total += rows.filter(needsEmbed).length;
    if (total >= EMBEDDING_BACKFILL_CHUNK) break;
  }
  return total;
}
