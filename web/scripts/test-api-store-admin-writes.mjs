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

const contacts = [
  {
    id: "contact_2",
    accountId: "acct_1",
    email: "buyer@example.com",
    name: "Buyer Two",
    updatedAt: 2,
  },
  {
    id: "contact_1",
    accountId: "acct_1",
    email: "alex@example.com",
    name: "Alex Existing",
    updatedAt: 1,
  },
  {
    id: "contact_3",
    accountId: "acct_2",
    email: "alex@example.com",
    name: "Alex Other Account",
    updatedAt: 3,
  },
];
const db = { contacts };

function collection(_db, name) {
  return { name };
}

function doc(_dbOrCollection, collectionName, id) {
  return { collectionName, id };
}

function where(field, op, value) {
  return { type: "where", field, op, value };
}

function limit(count) {
  return { type: "limit", count };
}

function query(collectionRef, ...constraints) {
  return { collectionRef, constraints };
}

async function getDocs(q) {
  let rows = [...(db[q.collectionRef.name] || [])];
  for (const constraint of q.constraints || []) {
    if (constraint.type === "where") {
      rows = rows.filter((row) => row[constraint.field] === constraint.value);
    }
    if (constraint.type === "limit") {
      rows = rows.slice(0, constraint.count);
    }
  }
  return {
    empty: rows.length === 0,
    docs: rows.map((row) => ({ id: row.id, data: () => ({ ...row }) })),
  };
}

async function getDoc(ref) {
  const row = (db[ref.collectionName] || []).find((item) => item.id === ref.id);
  return {
    id: ref.id,
    exists: () => !!row,
    data: () => ({ ...row }),
  };
}

const store = createApiStore({
  workerBaseUrl: "https://worker.test",
  getToken: async () => "token",
  fb: {
    db,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc: fail,
    updateDoc: fail,
    deleteDoc: fail,
    addDoc: fail,
    query,
    where,
    orderBy: fail,
    limit,
    documentId: () => "__name__",
    writeBatch: null,
    select: null,
    onSnapshot: null,
  },
});

const existing = await store.findContactByAccountEmail("acct_1", "Alex@Example.com");
assert.equal(existing?.id, "contact_1");
assert.equal(existing?.name, "Alex Existing");

const emailMatches = await store.findContactsByEmail("alex@example.com");
assert.deepEqual(emailMatches.map((contact) => contact.id), ["contact_1", "contact_3"]);

const accountContacts = await store.listContactsByAccount("acct_1");
assert.deepEqual(accountContacts.map((contact) => contact.id), ["contact_1", "contact_2"]);

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

console.log("api-store admin write transport and contact lookups passed");
