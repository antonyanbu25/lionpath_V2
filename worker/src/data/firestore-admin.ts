/**
 * Firestore Admin SDK singleton — Node runtime only (VPS / Cloud Run).
 */

import { isNodeRuntime } from "../video/capability";
import type { Env } from "../env";

export type FirestoreDoc = Record<string, unknown> & { id: string };

export type WhereFilterOp =
  | "<"
  | "<="
  | "=="
  | "!="
  | ">="
  | ">"
  | "array-contains"
  | "in"
  | "not-in"
  | "array-contains-any";

export interface QueryFilter {
  field: string;
  op: WhereFilterOp;
  value: unknown;
}

export interface QueryOrder {
  field: string;
  direction?: "asc" | "desc";
}

type FirestoreDb = import("firebase-admin/firestore").Firestore;

let dbInstance: FirestoreDb | null = null;
let initPromise: Promise<FirestoreDb> | null = null;

export type FirestoreEnv = Pick<Env, "FIREBASE_PROJECT_ID" | "FIREBASE_SERVICE_ACCOUNT_JSON">;

export function firestoreAdminReady(env?: FirestoreEnv): boolean {
  if (!isNodeRuntime()) return false;
  const projectId = (env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "").trim();
  return !!projectId;
}

export function assertFirestoreAvailable(env?: FirestoreEnv): void {
  if (!isNodeRuntime()) {
    throw Object.assign(new Error("Firestore read API requires Node runtime (VPS or Cloud Run)."), {
      status: 503,
    });
  }
  if (!firestoreAdminReady(env)) {
    throw Object.assign(
      new Error("Firestore not configured (set FIREBASE_PROJECT_ID and service account credentials)."),
      { status: 503 },
    );
  }
}

function projectIdFrom(env?: FirestoreEnv): string {
  return (env?.FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "").trim();
}

async function ensureDb(env?: FirestoreEnv): Promise<FirestoreDb> {
  assertFirestoreAvailable(env);
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const adminMod = await import("firebase-admin");
    const admin = adminMod.default ?? adminMod;
    const projectId = projectIdFrom(env);

    if (!admin.apps?.length) {
      const jsonRaw = (env?.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
      if (jsonRaw) {
        admin.initializeApp({
          credential: admin.credential.cert(JSON.parse(jsonRaw) as Record<string, string>),
          projectId,
        });
      } else {
        admin.initializeApp(projectId ? { projectId } : undefined);
      }
    }

    dbInstance = admin.firestore();
    return dbInstance;
  })();

  return initPromise;
}

export async function getDb(env?: FirestoreEnv): Promise<FirestoreDb> {
  return ensureDb(env);
}

function snapToDoc(snap: import("firebase-admin/firestore").DocumentSnapshot): FirestoreDoc | null {
  if (!snap.exists) return null;
  return { id: snap.id, ...(snap.data() as Record<string, unknown>) };
}

function snapsToDocs(snaps: import("firebase-admin/firestore").QuerySnapshot): FirestoreDoc[] {
  return snaps.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
}

export async function getDoc(col: string, id: string, env?: FirestoreEnv): Promise<FirestoreDoc | null> {
  const db = await getDb(env);
  const snap = await db.collection(col).doc(id).get();
  return snapToDoc(snap);
}

export async function getDocs(queryRef: import("firebase-admin/firestore").Query): Promise<FirestoreDoc[]> {
  const snap = await queryRef.get();
  return snapsToDocs(snap);
}

export async function getAll(col: string, ids: string[], env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const db = await getDb(env);
  const out: FirestoreDoc[] = [];
  const chunkSize = 500;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const refs = chunk.map((id) => db.collection(col).doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      const row = snapToDoc(snap);
      if (row) out.push(row);
    }
  }
  return out;
}

export async function queryBy(
  col: string,
  filters: QueryFilter[],
  order?: QueryOrder,
  limitCount?: number,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  const db = await getDb(env);
  let q: import("firebase-admin/firestore").Query = db.collection(col);
  for (const f of filters) {
    q = q.where(f.field, f.op, f.value);
  }
  if (order) {
    q = q.orderBy(order.field, order.direction || "asc");
  }
  if (typeof limitCount === "number") {
    q = q.limit(limitCount);
  }
  return getDocs(q);
}

export async function whereInChunked(
  col: string,
  field: string,
  values: string[],
  extraFilters: QueryFilter[] = [],
  order?: QueryOrder,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  const ids = [...new Set(values.filter(Boolean))];
  if (!ids.length) return [];
  const chunkSize = 30;
  const merged: FirestoreDoc[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const filters: QueryFilter[] = [...extraFilters, { field, op: "in", value: chunk }];
    const rows = await queryBy(col, filters, order, undefined, env);
    merged.push(...rows);
  }
  return merged;
}

export async function firestoreAdminBootStatus(env?: FirestoreEnv): Promise<string> {
  if (!isNodeRuntime()) return "Firestore admin: unavailable (not Node runtime)";
  if (!firestoreAdminReady(env)) return "Firestore admin: FIREBASE_PROJECT_ID not set";
  const jsonRaw = (env?.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  const creds = jsonRaw
    ? "FIREBASE_SERVICE_ACCOUNT_JSON"
    : process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? "GOOGLE_APPLICATION_CREDENTIALS"
      : "Application Default Credentials";
  try {
    await getDb(env);
    return `Firestore admin: ready (project=${projectIdFrom(env)}, creds=${creds})`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Firestore admin: init failed (${msg})`;
  }
}
