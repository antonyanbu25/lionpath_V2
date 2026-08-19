/**
 * Firestore-based history backend for Cloud Run / stateless container deployments.
 * Stores each user's history blob as a single Firestore document.
 *
 *   Collection: "se_history"
 *   Document ID:  "history:{email_normalized}"
 *   Fields:        value (string — the JSON blob), updatedAt (server timestamp)
 *
 * Implements the same HistoryBackend interface as history-file.ts so
 * the rest of history.ts / tasks.ts is unchanged.
 */

import type { HistoryBackend } from "./history";
import { getDb } from "./data/firestore-admin";

const COLLECTION = "se_history";

function docId(key: string): string {
  // key is already "history:{email}" from history.ts — use it as the Firestore doc id.
  return key;
}

export function createFirestoreHistoryBackend(): HistoryBackend {
  const backend = {
    name: "FirestoreHistoryBackend",
    async get(key: string): Promise<string | null> {
      const db = await getDb();
      const snap = await db.collection(COLLECTION).doc(docId(key)).get();
      if (!snap.exists) return null;
      const data = snap.data();
      return (data?.value as string) ?? null;
    },

    async put(key: string, value: string): Promise<void> {
      const db = await getDb();
      await db.collection(COLLECTION).doc(docId(key)).set(
        {
          value,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    },
  };
  return backend;
}
