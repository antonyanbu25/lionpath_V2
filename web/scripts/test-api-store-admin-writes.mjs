import assert from "node:assert/strict";
import { createApiStore } from "../domain/api-store.js";

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return {
    ok: true,
    async json() {
      return { result: { id: "post_1", ownerId: "u1" } };
    },
  };
};

const fail = () => {
  throw new Error("Firestore write delegate should not be used in api write mode");
};

const store = createApiStore({
  workerBaseUrl: "https://worker.test",
  getToken: async () => "token",
  fb: {
    db: {},
    collection: fail,
    doc: fail,
    getDoc: fail,
    getDocs: fail,
    setDoc: fail,
    updateDoc: fail,
    deleteDoc: fail,
    addDoc: fail,
    query: fail,
    where: fail,
    orderBy: fail,
    limit: fail,
    documentId: () => "__name__",
    writeBatch: null,
    select: null,
    onSnapshot: null,
  },
});

const saved = await store.upsertPostCall({ id: "post_1", ownerId: "u1" });
assert.equal(saved.id, "post_1");
assert.equal(calls.length, 1);
assert.equal(calls[0].url, "https://worker.test/api/domain-write");
assert.equal(calls[0].init.method, "POST");
assert.deepEqual(JSON.parse(calls[0].init.body), {
  method: "upsertPostCall",
  args: [{ id: "post_1", ownerId: "u1" }],
});
assert.equal(calls[0].init.headers.Authorization, "Bearer token");

console.log("api-store admin write transport passed");
