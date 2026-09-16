/**
 * Admin SDK adapter — exposes Firebase v9 modular-shaped helpers for createFirestoreStore in Node tests.
 */

import { getDb, type FirestoreEnv } from "../../src/data/firestore-admin";

type WhereClause = { field: string; op: string; value: unknown };
type OrderClause = { field: string; direction?: "asc" | "desc" };
type LimitClause = { count: number };

export async function createFirestoreClientShim(env?: FirestoreEnv) {
  const db = await getDb(env);

  function collection(_db: unknown, name: string) {
    return { __col: name };
  }

  function doc(_db: unknown, col: string | { __col: string }, id?: string) {
    const colName = typeof col === "string" ? col : col.__col;
    if (typeof col === "object" && id === undefined) {
      const ref = db.collection(colName).doc();
      return { __col: colName, __id: ref.id };
    }
    if (id === undefined) {
      return db.collection(colName).doc();
    }
    return { __col: colName, __id: id };
  }

  async function getDoc(ref: { __col: string; __id: string }) {
    const snap = await db.collection(ref.__col).doc(ref.__id).get();
    return {
      exists: () => snap.exists,
      id: snap.id,
      data: () => snap.data(),
    };
  }

  function buildQuery(colRef: { __col: string }, clauses: unknown[]) {
    let q: FirebaseFirestore.Query = db.collection(colRef.__col);
    let order: OrderClause | null = null;
    let limitN: number | null = null;
    const filters: WhereClause[] = [];

    for (const clause of clauses) {
      if (clause && typeof clause === "object") {
        if ("__where" in clause) filters.push(clause as WhereClause);
        else if ("__order" in clause) order = clause as OrderClause;
        else if ("__limit" in clause) limitN = (clause as LimitClause).count;
      }
    }

    for (const f of filters) {
      q = q.where(f.field, f.op as FirebaseFirestore.WhereFilterOp, f.value);
    }
    if (order) q = q.orderBy(order.field, order.direction || "asc");
    if (limitN != null) q = q.limit(limitN);
    return q;
  }

  async function getDocs(q: FirebaseFirestore.Query | { __col: string; __clauses?: unknown[] }) {
    const queryRef =
      q && typeof q === "object" && "__col" in q
        ? buildQuery(q as { __col: string; __clauses?: unknown[] }, (q as { __clauses?: unknown[] }).__clauses || [])
        : (q as FirebaseFirestore.Query);
    const snap = await queryRef.get();
    return {
      empty: snap.empty,
      docs: snap.docs.map((d) => ({
        id: d.id,
        data: () => d.data(),
        ref: d.ref,
      })),
    };
  }

  function query(colRef: { __col: string }, ...clauses: unknown[]) {
    return { __col: colRef.__col, __clauses: clauses };
  }

  function where(field: string, op: string, value: unknown) {
    return { __where: true, field, op, value };
  }

  function orderBy(field: string, direction?: "asc" | "desc") {
    return { __order: true, field, direction };
  }

  function limit(count: number) {
    return { __limit: true, count };
  }

  async function setDoc(ref: { __col: string; __id?: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) {
    const id = ref.__id || db.collection(ref.__col).doc().id;
    await db.collection(ref.__col).doc(id).set(data, opts?.merge ? { merge: true } : undefined);
  }

  async function updateDoc(ref: { __col: string; __id: string }, patch: Record<string, unknown>) {
    await db.collection(ref.__col).doc(ref.__id).update(patch);
  }

  async function deleteDoc(ref: { __col: string; __id: string }) {
    await db.collection(ref.__col).doc(ref.__id).delete();
  }

  function addDoc(colRef: { __col: string }, data: Record<string, unknown>) {
    return db.collection(colRef.__col).add(data);
  }

  return {
    db,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    addDoc,
    query,
    where,
    orderBy,
    limit,
  };
}
