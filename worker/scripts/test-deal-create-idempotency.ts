#!/usr/bin/env tsx
/**
 * UAT-003 regression gate (2026-09-11 staging UAT report): "duplicate deal
 * creation" — a tester watched the deal count go 4 -> 8 on retry/reload.
 *
 * ROOT CAUSE: handleDealsCreate (worker/src/routes.ts) always did
 *
 *     const ref = await db.collection("deals").add({ ...fields });
 *
 * Firestore's `.add()` mints a random auto-id on every call with NO
 * deduplication. A client retry (network timeout, a double-click past
 * debounce, a proxy retry) for what the user experiences as ONE "create
 * deal" click creates a second, third, Nth Firestore document.
 *
 * THE FIX: the write path is now `createDealIdempotent` (exported from
 * routes.ts for this test). It derives a deterministic id from the deal's
 * CONTENT via `deterministicAppendId` (the same helper this file's
 * addContactEvent/upsertArrOverride callers already use — see
 * worker/src/data/persistence/idempotency.ts for the full "why a window, not
 * a pure hash" reasoning, which applies here unchanged), then calls
 * `docRef.create(data)` instead of `.collection("deals").add(data)`.
 * `.create()` is Firestore's ON-CONFLICT equivalent: it throws ALREADY_EXISTS
 * (gRPC code 6) if a document already exists at that id, instead of minting
 * a new one (`.add()`) or silently overwriting (`.set()`). On ALREADY_EXISTS
 * the existing document is read back and returned as a successful response
 * with the SAME id, so a retry looks like success to the client rather than
 * a new failure mode.
 *
 * WHY THIS IS FULLY MOCKED ("unit", not "emulator"): this repo cannot run a
 * live Firestore emulator (no JDK — see
 * docs/janus-forensic-reaudit-20260911/08-security-privacy.md). Driving
 * handleDealsCreate itself end-to-end would additionally need a verified
 * Firebase ID token (real RSA signature verification against a live Google
 * JWKS fetch — see requireUser/verifyFirebaseToken in worker/src/auth.ts) and
 * a Postgres or Firestore-backed account/authorization lookup, none of which
 * is the thing this bug is about. test-route-authorization.ts documents the
 * same split for other Firestore-backed handlers: the DECISION logic is
 * tested directly, in-process, against a minimal fake satisfying only the
 * two Firestore Admin SDK calls createDealIdempotent needs
 * (`collection().doc().create()` / `.get()`) — no network, no real Firestore
 * client, no emulator.
 *
 * Asserts:
 *   1. Three rapid duplicate calls with IDENTICAL content -> exactly ONE
 *      document is ever created; all three calls return the SAME dealId,
 *      and the 2nd/3rd read back the SAME data the 1st wrote (not a second
 *      write).
 *   2. A genuinely later call with the same content but OUTSIDE the 5-minute
 *      dedupe window -> a second, DIFFERENT document is created (a real
 *      later duplicate-content deal must still go through — this is the
 *      exact hazard idempotency.ts's docstring calls out for a pure hash).
 *   3. A call for a different account (different content) -> also creates a
 *      new, different document.
 *   4. A self-contained simulation of the OLD `.add()` shape (a fresh random
 *      id minted per call, no create-or-fetch) against the same kind of
 *      fake store, run three times with identical content, produces THREE
 *      distinct documents — the exact bug this gate exists to catch. This
 *      is what `npm test` caught before the fix: with the old code,
 *      `createDealIdempotent` did not exist at all, so this file failed to
 *      even import; reintroducing the `.add()` body reproduces this
 *      contrast at runtime instead.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { IDEMPOTENCY_WINDOW_MS } from "../src/data/persistence/idempotency.ts";
import { createDealIdempotent, type DealCreateInput } from "../src/routes.ts";

let failures = 0;
function check(label: string, fn: () => void | Promise<void>): void | Promise<void> {
  const report = (err?: unknown) => {
    if (err === undefined) {
      console.log(`  PASS  ${label}`);
    } else {
      failures += 1;
      console.log(`  FAIL  ${label}\n          ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(
        () => report(undefined),
        (err) => report(err),
      );
    }
    report(undefined);
  } catch (err) {
    report(err);
  }
}

/**
 * Minimal fake satisfying exactly the two Firestore Admin SDK calls
 * createDealIdempotent uses: `collection(name).doc(id).create(data)` and
 * `.get()`. `.create()` reproduces the real behaviour that makes the fix
 * work: it throws an ALREADY_EXISTS-shaped error (gRPC code 6, matching
 * google-gax's GoogleError.code) when a document already exists at that id,
 * instead of silently overwriting.
 */
function createFakeDb() {
  const store = new Map<string, Record<string, unknown>>();
  let createCalls = 0;
  const db = {
    collection(name: string) {
      assert.equal(name, "deals", "createDealIdempotent must write to the deals collection");
      return {
        doc(id: string) {
          return {
            async create(data: Record<string, unknown>) {
              createCalls += 1;
              if (store.has(id)) {
                const err = new Error(`ALREADY_EXISTS: document ${id} already exists`);
                (err as { code?: number }).code = 6;
                throw err;
              }
              store.set(id, data);
              return {};
            },
            async get() {
              const data = store.get(id);
              return {
                exists: data !== undefined,
                data: () => data,
              };
            },
          };
        },
      };
    },
  };
  return { db, store, createCallCount: () => createCalls };
}

const BASE_INPUT: DealCreateInput = {
  accountId: "acc_1",
  ownerId: "usr_owner",
  teamId: "team_1",
  orgId: "org_1",
  type: "new_business",
  title: "Acme Corp",
  primaryContactId: "con_1",
  actorId: "usr_actor",
};

// A `now` comfortably inside a dedupe bucket (bucket-aligned + 1s, so every
// timestamp used below for "rapid" retries has ~299s of headroom before the
// next bucket regardless of when this file happens to run).
const BUCKET_START = Math.floor(Date.now() / IDEMPOTENCY_WINDOW_MS) * IDEMPOTENCY_WINDOW_MS;
const NOW = BUCKET_START + 1000;

console.log("\n1. Three rapid duplicate calls, identical content -> one document");
await check("all three calls create at most one real Firestore document", async () => {
  const { db, store } = createFakeDb();
  const r1 = await createDealIdempotent(db, { ...BASE_INPUT, now: NOW });
  const r2 = await createDealIdempotent(db, { ...BASE_INPUT, now: NOW + 2_000 });
  const r3 = await createDealIdempotent(db, { ...BASE_INPUT, now: NOW + 10_000 });

  assert.equal(store.size, 1, `expected exactly 1 stored document, found ${store.size}`);
  assert.equal(r2.dealId, r1.dealId, "retry #1 must reuse the first call's dealId");
  assert.equal(r3.dealId, r1.dealId, "retry #2 must reuse the first call's dealId");
  assert.equal(r2.ownerId, r1.ownerId);
  assert.equal(r3.ownerId, r1.ownerId);
});

await check("the 2nd/3rd calls read back the FIRST call's document rather than writing a new one", async () => {
  const { db, store } = createFakeDb();
  const r1 = await createDealIdempotent(db, { ...BASE_INPUT, now: NOW });
  const before = { ...store.get(r1.dealId) };
  await createDealIdempotent(db, { ...BASE_INPUT, now: NOW + 2_000 });
  const after = store.get(r1.dealId);
  assert.deepEqual(after, before, "a retry must not mutate the document the first call wrote");
});

console.log("\n2. Same account, same content, but OUTSIDE the dedupe window -> new document");
await check("a later duplicate-content deal (next bucket) still creates a new document", async () => {
  const { db, store } = createFakeDb();
  const r1 = await createDealIdempotent(db, { ...BASE_INPUT, now: NOW });
  const laterBucketNow = NOW + IDEMPOTENCY_WINDOW_MS + 5_000; // safely into the next bucket
  const r2 = await createDealIdempotent(db, { ...BASE_INPUT, now: laterBucketNow });

  assert.equal(store.size, 2, `expected 2 stored documents, found ${store.size}`);
  assert.notEqual(r2.dealId, r1.dealId, "a genuinely later create must not collide with the earlier one");
});

console.log("\n3. Different account -> new document");
await check("a different account's deal gets a different id and a new document", async () => {
  const { db, store } = createFakeDb();
  const r1 = await createDealIdempotent(db, { ...BASE_INPUT, now: NOW });
  const r2 = await createDealIdempotent(db, { ...BASE_INPUT, accountId: "acc_2", now: NOW + 2_000 });

  assert.equal(store.size, 2, `expected 2 stored documents, found ${store.size}`);
  assert.notEqual(r2.dealId, r1.dealId);
});

console.log("\n4. Contrast: the OLD `.add()` shape, run against the same fake store");
await check(
  "three identical-content calls through the pre-fix `.add()` shape create THREE distinct documents",
  async () => {
    // Reproduces the observable contract of the old handleDealsCreate body
    // (`db.collection("deals").add({ ...fields })`): a fresh random id every
    // call, no existence check, so a retry of identical content always
    // succeeds as a NEW document. This is the exact defect UAT-003 reported
    // (4 -> 8 deals on retry). createDealIdempotent (the fix) is proven above
    // to collapse the same three calls into one document; this proves the
    // pre-fix shape would not have.
    const { db, store } = createFakeDb();
    const legacyAdd = async (data: Record<string, unknown>) => {
      const id = randomUUID();
      await db.collection("deals").doc(id).create(data);
      return id;
    };

    const payload = { accountId: BASE_INPUT.accountId, title: BASE_INPUT.title };
    const ids = new Set<string>();
    ids.add(await legacyAdd(payload));
    ids.add(await legacyAdd(payload));
    ids.add(await legacyAdd(payload));

    assert.equal(store.size, 3, `expected the legacy .add() shape to create 3 documents, found ${store.size}`);
    assert.equal(ids.size, 3, "each legacy .add() call must mint a distinct id");
  },
);

console.log("");
if (failures > 0) {
  console.error(`FAIL — ${failures} deal-creation idempotency check(s) failed.`);
  process.exit(1);
}
console.log("OK — UAT-003 deal-creation idempotency gate passed.");
