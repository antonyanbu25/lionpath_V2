import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createApiStore } from "../domain/api-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiStoreSource = readFileSync(join(__dirname, "../domain/api-store.js"), "utf8");

const callDetailMethodsMatch = apiStoreSource.match(
  /const\s+CALL_DETAIL_WRITE_METHODS\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/,
);
assert.ok(callDetailMethodsMatch, "CALL_DETAIL_WRITE_METHODS set must be present");
assert.doesNotMatch(
  callDetailMethodsMatch[1],
  /["']upsertPostCallWithSummary["']/,
  "upsertPostCallWithSummary must not be routed through Firestore-only call detail writes",
);

const adminWriteMethodsMatch = apiStoreSource.match(
  /const\s+ADMIN_WRITE_METHODS\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/,
);
assert.ok(adminWriteMethodsMatch, "ADMIN_WRITE_METHODS set must be present");
assert.match(
  adminWriteMethodsMatch[1],
  /["']upsertPostCallWithSummary["']/,
  "upsertPostCallWithSummary must be available on the admin/domain-write path",
);

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return {
    ok: true,
    async json() {
      return { result: { id: "postcall_1", summaryId: "summary_1" } };
    },
  };
};

const fail = () => {
  throw new Error("Firestore delegate should not handle upsertPostCallWithSummary");
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

const postCall = { id: "postcall_1", ownerId: "u1" };
const summary = { id: "summary_1", callId: "postcall_1" };
const saved = await store.upsertPostCallWithSummary(postCall, summary);

assert.deepEqual(saved, { id: "postcall_1", summaryId: "summary_1" });
assert.equal(calls.length, 1);
assert.equal(calls[0].url, "https://worker.test/api/domain-write");
assert.equal(calls[0].init.method, "POST");
assert.deepEqual(JSON.parse(calls[0].init.body), {
  method: "upsertPostCallWithSummary",
  args: [postCall, summary],
});
assert.equal(calls[0].init.headers.Authorization, "Bearer token");

console.log("test-postcall-domain-routing.mjs: ok");
