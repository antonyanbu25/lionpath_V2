/**
 * Firestore collection CRUD helpers for simple top-level documents.
 */
import { stripUndefinedFields } from './safe-store.js';

/**
 * @param {string} colName Firestore collection name
 * @param {object} deps Firebase helpers and cache hooks from createFirestoreStore
 */
export function collectionCRUD(colName, deps) {
  const {
    db,
    collection,
    doc,
    getDocs,
    setDoc,
    updateDoc,
    query,
    where,
    getCachedById,
    invalidateReadCache,
    now,
  } = deps;

  return {
    async get(id) {
      return getCachedById(colName, id);
    },

    async upsert(docData) {
      await setDoc(doc(db, colName, docData.id), stripUndefinedFields(docData), { merge: true });
      invalidateReadCache(colName, docData.id);
      return docData;
    },

    async create(docData) {
      const ref = docData.id ? doc(db, colName, docData.id) : doc(collection(db, colName));
      const data = stripUndefinedFields({ ...docData, id: ref.id });
      await setDoc(ref, data);
      invalidateReadCache(colName, data.id);
      return data;
    },

    async update(id, patch) {
      await updateDoc(doc(db, colName, id), stripUndefinedFields({ ...patch, updatedAt: now() }));
      invalidateReadCache(colName, id);
      return getCachedById(colName, id);
    },

    async listBy(field, value, sortFn) {
      const q = query(collection(db, colName), where(field, "==", value));
      const snap = await getDocs(q);
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (sortFn) rows.sort(sortFn);
      return rows;
    },
  };
}
