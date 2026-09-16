/**
 * Firestore-based history backend for Cloud Run / stateless container deployments.
 * Stores small history blobs inline, and oversized blobs as ordered chunk
 * subdocuments to stay below Firestore's per-field and per-document limits.
 *
 *   Collection: "se_history"
 *   Document ID:  "history:{email_normalized}"
 *   Fields:        value (string — the JSON blob) OR chunk metadata, updatedAt
 *
 * Implements the same HistoryBackend interface as history-file.ts so
 * the rest of history.ts / tasks.ts is unchanged.
 */

import type { HistoryBackend } from "./history";
import { getDb } from "./data/firestore-admin";

const COLLECTION = "se_history";
const CHUNKS_COLLECTION = "chunks";
const INLINE_MAX_BYTES = 900 * 1024;
const CHUNK_MAX_BYTES = 900 * 1024;
const CHUNK_BATCH_SIZE = 450;
const encoder = new TextEncoder();

type FirestoreDb = Awaited<ReturnType<typeof getDb>>;
type FirestoreCollection = ReturnType<FirestoreDb["collection"]>;
type FirestoreDocumentReference = ReturnType<FirestoreCollection["doc"]>;

function docId(key: string): string {
  // key is already "history:{email}" from history.ts — use it as the Firestore doc id.
  return key;
}

function utf8ByteLength(value: string): number {
  return encoder.encode(value).length;
}

function chunkId(index: number): string {
  return String(index).padStart(6, "0");
}

function splitUtf8String(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const char of value) {
    const charBytes = utf8ByteLength(char);
    if (current && currentBytes + charBytes > maxBytes) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }

  chunks.push(current);
  return chunks;
}

async function deleteStaleChunks(
  db: FirestoreDb,
  chunkRefs: FirestoreDocumentReference[],
): Promise<void> {
  for (let i = 0; i < chunkRefs.length; i += CHUNK_BATCH_SIZE) {
    const batch = db.batch();
    for (const ref of chunkRefs.slice(i, i + CHUNK_BATCH_SIZE)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

async function writeChunkedValue(
  db: FirestoreDb,
  key: string,
  value: string,
): Promise<void> {
  const docRef = db.collection(COLLECTION).doc(docId(key));
  const chunksCol = docRef.collection(CHUNKS_COLLECTION);
  const chunks = splitUtf8String(value, CHUNK_MAX_BYTES);
  const nextIds = new Set(chunks.map((_, index) => chunkId(index)));
  const existingChunkRefs = await chunksCol.listDocuments();
  const staleChunkRefs = existingChunkRefs.filter((ref) => !nextIds.has(ref.id));

  for (let i = 0; i < chunks.length; i += CHUNK_BATCH_SIZE) {
    const batch = db.batch();
    if (i === 0) {
      batch.set(
        docRef,
        {
          value: null,
          storage: "chunks",
          chunkCount: chunks.length,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    }
    chunks.slice(i, i + CHUNK_BATCH_SIZE).forEach((chunk, offset) => {
      const index = i + offset;
      batch.set(chunksCol.doc(chunkId(index)), { value: chunk, index });
    });
    await batch.commit();
  }

  await deleteStaleChunks(db, staleChunkRefs);
}

async function writeInlineValue(
  db: FirestoreDb,
  key: string,
  value: string,
): Promise<void> {
  const docRef = db.collection(COLLECTION).doc(docId(key));
  const staleChunkRefs = await docRef.collection(CHUNKS_COLLECTION).listDocuments();

  await docRef.set(
    {
      value,
      storage: "inline",
      chunkCount: 0,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
  await deleteStaleChunks(db, staleChunkRefs);
}

async function readChunkedValue(
  db: FirestoreDb,
  key: string,
  chunkCount: number,
): Promise<string | null> {
  if (!Number.isInteger(chunkCount) || chunkCount <= 0) return null;

  const docRef = db.collection(COLLECTION).doc(docId(key));
  const refs = Array.from({ length: chunkCount }, (_, index) =>
    docRef.collection(CHUNKS_COLLECTION).doc(chunkId(index)),
  );
  const snaps = await db.getAll(...refs);
  const chunks: string[] = [];

  for (const snap of snaps) {
    const chunk = snap.data()?.value;
    if (typeof chunk !== "string") return null;
    chunks.push(chunk);
  }

  return chunks.join("");
}

export function createFirestoreHistoryBackend(): HistoryBackend {
  const backend = {
    name: "FirestoreHistoryBackend",
    async get(key: string): Promise<string | null> {
      const db = await getDb();
      const snap = await db.collection(COLLECTION).doc(docId(key)).get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (typeof data?.value === "string") return data.value;
      if (data?.storage === "chunks" && typeof data.chunkCount === "number") {
        return readChunkedValue(db, key, data.chunkCount);
      }
      return null;
    },

    async put(key: string, value: string): Promise<void> {
      const db = await getDb();
      if (utf8ByteLength(value) <= INLINE_MAX_BYTES) {
        await writeInlineValue(db, key, value);
        return;
      }
      await writeChunkedValue(db, key, value);
    },
  };
  return backend;
}
