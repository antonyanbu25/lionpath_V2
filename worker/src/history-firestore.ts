/**
 * Firestore-based history backend for Cloud Run / stateless container deployments.
 * Stores small history blobs inline and oversized blobs in chunk documents.
 *
 *   Collection: "se_history"
 *   Document ID:  "history:{email_normalized}"
 *   Small fields:  value (string — the JSON blob), updatedAt
 *   Large fields:  storage="chunks", chunkGeneration, chunkCount, byteLength, updatedAt
 *   Chunks:        se_history/{docId}/chunks/{generation}_{000000...} with value (string)
 *
 * Implements the same HistoryBackend interface as history-file.ts so
 * the rest of history.ts / tasks.ts is unchanged.
 */

import type { HistoryBackend } from "./history";
import { getDb } from "./data/firestore-admin";

const COLLECTION = "se_history";
const CHUNKS_COLLECTION = "chunks";
const INLINE_LIMIT_BYTES = 900 * 1024;
const CHUNK_LIMIT_BYTES = 900 * 1024;
const textEncoder = new TextEncoder();

function docId(key: string): string {
  // key is already "history:{email}" from history.ts — use it as the Firestore doc id.
  return key;
}

function byteLength(value: string): number {
  return textEncoder.encode(value).length;
}

function splitUtf8Chunks(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const char of value) {
    const charBytes = byteLength(char);
    if (current && currentBytes + charBytes > maxBytes) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }

  if (current || value === "") chunks.push(current);
  return chunks;
}

function chunkDocId(generation: string, index: number): string {
  return `${generation}_${String(index).padStart(6, "0")}`;
}

async function deleteChunks(
  chunksRef: import("firebase-admin/firestore").CollectionReference,
  exceptGeneration?: string,
): Promise<void> {
  const snap = await chunksRef.get();
  let batch = chunksRef.firestore.batch();
  let ops = 0;

  for (const doc of snap.docs) {
    if (exceptGeneration && doc.id.startsWith(`${exceptGeneration}_`)) continue;
    batch.delete(doc.ref);
    ops += 1;
    if (ops === 500) {
      await batch.commit();
      batch = chunksRef.firestore.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();
}

export function createFirestoreHistoryBackend(): HistoryBackend {
  const backend = {
    name: "FirestoreHistoryBackend",
    async get(key: string): Promise<string | null> {
      const db = await getDb();
      const docRef = db.collection(COLLECTION).doc(docId(key));
      const snap = await docRef.get();
      if (!snap.exists) return null;
      const data = snap.data();
      if (typeof data?.value === "string") return data.value;
      if (data?.storage !== "chunks") return null;

      const generation = typeof data.chunkGeneration === "string" ? data.chunkGeneration : null;
      const chunkCount = typeof data.chunkCount === "number" ? data.chunkCount : 0;
      if (generation && chunkCount > 0) {
        const refs = Array.from({ length: chunkCount }, (_, index) =>
          docRef.collection(CHUNKS_COLLECTION).doc(chunkDocId(generation, index)),
        );
        const chunks: string[] = [];
        for (let i = 0; i < refs.length; i += 500) {
          const snaps = await db.getAll(...refs.slice(i, i + 500));
          for (const chunkSnap of snaps) {
            if (!chunkSnap.exists) return null;
            chunks.push((chunkSnap.data()?.value as string) ?? "");
          }
        }
        return chunks.join("");
      }

      const chunksSnap = await docRef.collection(CHUNKS_COLLECTION).orderBy("index", "asc").get();
      if (chunksSnap.empty) return null;
      return chunksSnap.docs.map((doc) => ((doc.data().value as string) ?? "")).join("");
    },

    async put(key: string, value: string): Promise<void> {
      const db = await getDb();
      const adminMod = await import("firebase-admin/firestore");
      const docRef = db.collection(COLLECTION).doc(docId(key));
      const chunksRef = docRef.collection(CHUNKS_COLLECTION);
      const updatedAt = Date.now();

      if (byteLength(value) <= INLINE_LIMIT_BYTES) {
        await docRef.set(
          {
            value,
            storage: adminMod.FieldValue.delete(),
            chunkGeneration: adminMod.FieldValue.delete(),
            chunkCount: adminMod.FieldValue.delete(),
            byteLength: adminMod.FieldValue.delete(),
            updatedAt,
          },
          { merge: true },
        );
        await deleteChunks(chunksRef).catch(() => undefined);
        return;
      }

      const chunks = splitUtf8Chunks(value, CHUNK_LIMIT_BYTES);
      const generation = `${updatedAt}-${Math.random().toString(36).slice(2, 10)}`;

      let batch = db.batch();
      let ops = 0;
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        batch.set(chunksRef.doc(chunkDocId(generation, index)), {
          generation,
          index,
          value: chunk,
          updatedAt,
        });
        ops += 1;

        if (ops === 500) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
        }
      }

      batch.set(
        docRef,
        {
          value: adminMod.FieldValue.delete(),
          storage: "chunks",
          chunkGeneration: generation,
          chunkCount: chunks.length,
          byteLength: byteLength(value),
          updatedAt,
        },
        { merge: true },
      );
      await batch.commit();
      await deleteChunks(chunksRef, generation).catch(() => undefined);
    },
  };
  return backend;
}
