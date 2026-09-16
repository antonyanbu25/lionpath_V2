import assert from "node:assert/strict";
import { createApiStore } from "../domain/api-store.js";

const calls = [];
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  // /api/contacts and /api/accounts/:id/contacts (added for the Postgres-
  // backed contact lookups) have no real worker behind them in this test --
  // 404 so the store's fallback-to-Firestore path is exercised, same as it
  // would be against a genuinely unavailable API.
  if (String(url).includes("/api/contacts") || /\/api\/accounts\/[^/]+\/contacts/.test(String(url))) {
    return { ok: false, status: 404, async json() { return { error: "Not found." }; } };
  }
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

const seededContacts = [
  { id: "contact_1", accountId: "account_1", email: "buyer@example.com", name: "Buyer" },
  { id: "contact_2", accountId: "account_1", email: "champion@example.com", name: "Champion" },
  { id: "contact_3", accountId: "account_2", email: "buyer@example.com", name: "Other Buyer" },
];

const makeDoc = (row) => ({
  id: row.id,
  data: () => ({ ...row }),
});

const fb = {
  db: {},
  collection: (_db, name) => ({ name }),
  doc: fail,
  getDoc: fail,
  getDocs: async (q) => {
    assert.equal(q.collection.name, "contacts");
    let rows = seededContacts;
    for (const clause of q.clauses) {
      if (clause.type !== "where") continue;
      assert.equal(clause.op, "==");
      rows = rows.filter((row) => row[clause.field] === clause.value);
    }
    if (q.limitCount != null) rows = rows.slice(0, q.limitCount);
    return {
      empty: rows.length === 0,
      docs: rows.map(makeDoc),
    };
  },
  setDoc: fail,
  updateDoc: fail,
  deleteDoc: fail,
  addDoc: fail,
  query: (collection, ...clauses) => ({
    collection,
    clauses,
    limitCount: clauses.find((clause) => clause.type === "limit")?.count,
  }),
  where: (field, op, value) => ({ type: "where", field, op, value }),
  orderBy: fail,
  limit: (count) => ({ type: "limit", count }),
  documentId: () => "__name__",
  writeBatch: null,
  select: null,
  onSnapshot: null,
};

const store = createApiStore({
  workerBaseUrl: "https://worker.test",
  getToken: async () => "token",
  fb,
});

const contact = await store.findContactByAccountEmail("account_1", "buyer@example.com");
assert.deepEqual(contact, seededContacts[0]);

const contactsByEmail = await store.findContactsByEmail("buyer@example.com");
assert.deepEqual(contactsByEmail, [seededContacts[0], seededContacts[2]]);

const accountContacts = await store.listContactsByAccount("account_1");
assert.deepEqual(accountContacts, [seededContacts[0], seededContacts[1]]);

const saved = await store.upsertPostCall({ id: "post_1", ownerId: "u1" });
assert.equal(saved.id, "post_1");
// The three contact lookups above now try /api/contacts and
// /api/accounts/:id/contacts first (falling back to the seeded Firestore
// mock on 404), so calls also holds those attempts -- assert on the
// domain-write call specifically rather than assuming it's the only one.
const domainWriteCalls = calls.filter((c) => c.url === "https://worker.test/api/domain-write");
assert.equal(domainWriteCalls.length, 1);
assert.equal(domainWriteCalls[0].init.method, "POST");
assert.deepEqual(JSON.parse(domainWriteCalls[0].init.body), {
  method: "upsertPostCall",
  args: [{ id: "post_1", ownerId: "u1" }],
});
assert.equal(domainWriteCalls[0].init.headers.Authorization, "Bearer token");

console.log("api-store admin write transport passed");
