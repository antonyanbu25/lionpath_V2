#!/usr/bin/env node
/**
 * Domain smoke: the dealContacts join primitive (local store).
 *
 * Mirrors Salesforce OpportunityContactRole. A dealContacts row is
 *   { id: `${dealId}_${contactId}`, dealId, contactId, accountId, role, isPrimary, createdAt, updatedAt }
 * and is the ONLY correct answer to "which contacts are on this deal". An account
 * may have many deals, so listContactsByAccount(accountId) is not a substitute.
 *
 * Run: node web/scripts/test-deal-contacts-store.mjs
 */

import assert from "node:assert/strict";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};
globalThis.sessionStorage = {
  getItem: (k) => mem.get(`ss:${k}`) ?? null,
  setItem: (k, v) => mem.set(`ss:${k}`, v),
  removeItem: (k) => mem.delete(`ss:${k}`),
};

const { initDomainStore, getStore } = await import("../domain/store.js");

/** Contract per the OpportunityContactRole model. */
const VALID_ROLES = [
  "economic_buyer",
  "champion",
  "evaluator",
  "influencer",
  "technical_buyer",
  "end_user",
  "unknown",
];

const results = [];

async function check(name, fn) {
  try {
    await fn();
    console.log("ok:", name);
    results.push(true);
  } catch (err) {
    console.error("FAIL:", name, "—", err?.message || err);
    results.push(false);
  }
}

const ACC_1 = "acc_dc_one";
const ACC_2 = "acc_dc_two";
const DEAL_A = "deal_dc_a"; // ACC_1
const DEAL_B = "deal_dc_b"; // ACC_1, second deal on the SAME account
const DEAL_C = "deal_dc_c"; // ACC_2
const CON_1 = "con_dc_one"; // ACC_1
const CON_2 = "con_dc_two"; // ACC_1
const CON_3 = "con_dc_three"; // ACC_2

initDomainStore(null);
const store = getStore();
store.clearAll();

const ts = 1_700_000_000_000; // fixed. no Date.now()-dependent assertions below

for (const [id, name, domain] of [
  [ACC_1, "Join Co", "join.co"],
  [ACC_2, "Other Co", "other.co"],
]) {
  await store.createAccount({ id, name, slug: domain, domain, createdAt: ts, updatedAt: ts });
}

for (const [id, accountId, email] of [
  [CON_1, ACC_1, "one@join.co"],
  [CON_2, ACC_1, "two@join.co"],
  [CON_3, ACC_2, "three@other.co"],
]) {
  await store.createContact({ id, accountId, email, name: email, createdAt: ts, updatedAt: ts });
}

for (const [id, accountId, title] of [
  [DEAL_A, ACC_1, "Join Co - Deal 1"],
  [DEAL_B, ACC_1, "Join Co - Deal 2"],
  [DEAL_C, ACC_2, "Other Co - Deal 1"],
]) {
  await store.createDeal({
    id,
    accountId,
    type: "new_business",
    stage: "research",
    status: "active",
    ownerId: "usr_dc_se",
    teamId: "team_dc",
    orgId: null,
    primaryContactId: null,
    title,
    prepCount: 0,
    postCallCount: 0,
    openTaskCount: 0,
    latestQualityScore: null,
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
  });
}

/**
 * (Re)seed the canonical join fixture. createDealContact is an upsert, so this is
 * idempotent and safe to call before every mutating check.
 *   DEAL_A -> CON_1 (champion, primary), CON_2 (evaluator)
 *   DEAL_B -> CON_2 (economic_buyer, primary)
 *   DEAL_C -> CON_3 (influencer, primary)
 */
async function seedJoins() {
  await store.createDealContact({ dealId: DEAL_A, contactId: CON_1, accountId: ACC_1, role: "champion", isPrimary: true });
  await store.createDealContact({ dealId: DEAL_A, contactId: CON_2, accountId: ACC_1, role: "evaluator", isPrimary: false });
  await store.createDealContact({ dealId: DEAL_B, contactId: CON_2, accountId: ACC_1, role: "economic_buyer", isPrimary: true });
  await store.createDealContact({ dealId: DEAL_C, contactId: CON_3, accountId: ACC_2, role: "influencer", isPrimary: true });
}

const ids = (rows) => (rows || []).map((r) => r.contactId).sort();
const dealIds = (rows) => (rows || []).map((r) => r.dealId).sort();

await check("store exposes the six dealContact methods", () => {
  for (const m of [
    "createDealContact",
    "findDealContact",
    "listContactsByDeal",
    "listDealsByContact",
    "setPrimaryDealContact",
    "removeDealContact",
  ]) {
    assert.equal(typeof store[m], "function", `local store is missing store.${m}() — the dealContacts join is not implemented`);
  }
});

await check("dealContact doc id is `${dealId}_${contactId}`", async () => {
  await seedJoins();
  const row = await store.findDealContact(DEAL_A, CON_1);
  assert.ok(row, `findDealContact(${DEAL_A}, ${CON_1}) returned nothing after createDealContact`);
  assert.equal(row.id, `${DEAL_A}_${CON_1}`, `join doc id must be "${DEAL_A}_${CON_1}" so the pair is naturally unique, got "${row.id}"`);
});

await check("createDealContact is an upsert — same pair twice yields one row", async () => {
  await seedJoins();
  await store.createDealContact({ dealId: DEAL_A, contactId: CON_1, accountId: ACC_1, role: "champion", isPrimary: true });
  await store.createDealContact({ dealId: DEAL_A, contactId: CON_1, accountId: ACC_1, role: "champion", isPrimary: true });
  const rows = await store.listContactsByDeal(DEAL_A);
  const forCon1 = rows.filter((r) => r.contactId === CON_1);
  assert.equal(forCon1.length, 1, `createDealContact duplicated the (${DEAL_A}, ${CON_1}) pair — got ${forCon1.length} rows, expected exactly 1 (upsert)`);
});

await check("createDealContact upsert updates the role in place", async () => {
  await seedJoins();
  await store.createDealContact({ dealId: DEAL_A, contactId: CON_2, accountId: ACC_1, role: "technical_buyer", isPrimary: false });
  const row = await store.findDealContact(DEAL_A, CON_2);
  assert.equal(row?.role, "technical_buyer", `re-upserting the pair must update role to "technical_buyer", got "${row?.role}"`);
  const rows = await store.listContactsByDeal(DEAL_A);
  assert.equal(rows.filter((r) => r.contactId === CON_2).length, 1, "role update must not create a second join row for the pair");
});

await check("join row carries dealId, contactId, accountId and timestamps", async () => {
  await seedJoins();
  const row = await store.findDealContact(DEAL_C, CON_3);
  assert.ok(row, `findDealContact(${DEAL_C}, ${CON_3}) returned nothing`);
  assert.equal(row.dealId, DEAL_C, `join row dealId must be ${DEAL_C}, got ${row.dealId}`);
  assert.equal(row.contactId, CON_3, `join row contactId must be ${CON_3}, got ${row.contactId}`);
  assert.equal(row.accountId, ACC_2, `join row must denormalise accountId ${ACC_2} (for account-scoped rules), got ${row.accountId}`);
  assert.equal(typeof row.createdAt, "number", "join row needs a numeric createdAt");
  assert.equal(typeof row.updatedAt, "number", "join row needs a numeric updatedAt");
});

await check("findDealContact returns null for a pair that was never linked", async () => {
  await seedJoins();
  const row = await store.findDealContact(DEAL_C, CON_1);
  assert.ok(!row, `contact ${CON_1} is not on deal ${DEAL_C}, findDealContact must return null/undefined, got ${JSON.stringify(row)}`);
});

await check('role defaults to "unknown" when omitted', async () => {
  await store.createDealContact({ dealId: DEAL_B, contactId: CON_1, accountId: ACC_1 });
  const row = await store.findDealContact(DEAL_B, CON_1);
  assert.ok(row, "createDealContact without a role must still create the join row");
  assert.equal(row.role, "unknown", `role must default to "unknown" when omitted, got ${JSON.stringify(row.role)}`);
  await store.removeDealContact(DEAL_B, CON_1);
});

// The model permits either rejecting or coercing an unrecognised role. This
// implementation COERCES: normalizeDealContactRole() in domain/types.js maps
// anything outside DEAL_CONTACT_ROLES to "unknown", on the reasoning that a bad
// role label must not cost us the link itself. Asserted as coercion below.
await check('invalid role is coerced to "unknown", never stored verbatim', async () => {
  await store.createDealContact({ dealId: DEAL_B, contactId: CON_3, accountId: ACC_1, role: "chief_vibes_officer" });
  const row = await store.findDealContact(DEAL_B, CON_3);
  assert.ok(row, "an invalid role must not cost us the link — the join row should still be created");
  assert.equal(
    row.role,
    "unknown",
    `invalid role "chief_vibes_officer" must be coerced to "unknown", got ${JSON.stringify(row.role)} (valid: ${VALID_ROLES.join("|")})`,
  );
  await store.removeDealContact(DEAL_B, CON_3);
});

await check("role casing and separators normalise onto the picklist", async () => {
  await store.createDealContact({ dealId: DEAL_B, contactId: CON_3, accountId: ACC_1, role: "Economic Buyer" });
  const row = await store.findDealContact(DEAL_B, CON_3);
  assert.equal(row?.role, "economic_buyer", `"Economic Buyer" must normalise to "economic_buyer", got ${JSON.stringify(row?.role)}`);
  await store.removeDealContact(DEAL_B, CON_3);
});

await check("listContactsByDeal returns only that deal's contacts", async () => {
  await seedJoins();
  assert.deepEqual(
    ids(await store.listContactsByDeal(DEAL_A)),
    [CON_1, CON_2].sort(),
    `listContactsByDeal(${DEAL_A}) must return exactly its own two contacts`,
  );
  assert.deepEqual(
    ids(await store.listContactsByDeal(DEAL_B)),
    [CON_2],
    `listContactsByDeal(${DEAL_B}) must return only ${CON_2} — a sibling deal on the same account must not leak its contacts`,
  );
  assert.deepEqual(
    ids(await store.listContactsByDeal(DEAL_C)),
    [CON_3],
    `listContactsByDeal(${DEAL_C}) must return only ${CON_3}`,
  );
});

await check("listDealsByContact returns only that contact's deals", async () => {
  await seedJoins();
  assert.deepEqual(
    dealIds(await store.listDealsByContact(CON_1)),
    [DEAL_A],
    `listDealsByContact(${CON_1}) must return only ${DEAL_A}`,
  );
  assert.deepEqual(
    dealIds(await store.listDealsByContact(CON_2)),
    [DEAL_A, DEAL_B].sort(),
    `listDealsByContact(${CON_2}) must return both deals it is on (${DEAL_A}, ${DEAL_B})`,
  );
  assert.deepEqual(
    dealIds(await store.listDealsByContact(CON_3)),
    [DEAL_C],
    `listDealsByContact(${CON_3}) must return only ${DEAL_C} — no cross-contact bleed`,
  );
});

await check("setPrimaryDealContact marks the target row primary", async () => {
  await seedJoins();
  await store.setPrimaryDealContact(DEAL_A, CON_2);
  const row = await store.findDealContact(DEAL_A, CON_2);
  assert.equal(row?.isPrimary, true, `setPrimaryDealContact(${DEAL_A}, ${CON_2}) must set isPrimary true on the target row, got ${JSON.stringify(row?.isPrimary)}`);
});

await check("setPrimaryDealContact clears isPrimary on every other contact of that deal", async () => {
  await seedJoins();
  await store.setPrimaryDealContact(DEAL_A, CON_2);
  const rows = await store.listContactsByDeal(DEAL_A);
  const primaries = rows.filter((r) => r.isPrimary === true).map((r) => r.contactId);
  assert.deepEqual(primaries, [CON_2], `deal ${DEAL_A} must have exactly one primary contact (${CON_2}), got [${primaries.join(", ")}]`);
});

await check("setPrimaryDealContact leaves other deals' rows untouched", async () => {
  await seedJoins();
  await store.setPrimaryDealContact(DEAL_A, CON_2);
  const bRow = await store.findDealContact(DEAL_B, CON_2);
  assert.equal(bRow?.isPrimary, true, `${CON_2} was primary on ${DEAL_B}; making it primary on ${DEAL_A} must not touch ${DEAL_B}`);
  const cRow = await store.findDealContact(DEAL_C, CON_3);
  assert.equal(cRow?.isPrimary, true, `setPrimaryDealContact on ${DEAL_A} must not clear the primary on an unrelated deal (${DEAL_C})`);
});

await check("removeDealContact removes exactly one row", async () => {
  await seedJoins();
  await store.removeDealContact(DEAL_A, CON_2);
  assert.ok(!(await store.findDealContact(DEAL_A, CON_2)), `removeDealContact(${DEAL_A}, ${CON_2}) did not remove the row`);
  assert.deepEqual(
    ids(await store.listContactsByDeal(DEAL_A)),
    [CON_1],
    `removeDealContact must leave the deal's other contacts alone — ${CON_1} should still be on ${DEAL_A}`,
  );
  assert.ok(
    await store.findDealContact(DEAL_B, CON_2),
    `removeDealContact(${DEAL_A}, ${CON_2}) must not unlink ${CON_2} from ${DEAL_B}`,
  );
});

await check("hostile input does not throw", async () => {
  await seedJoins();
  const cases = [
    ["nullish ids to createDealContact", () => store.createDealContact({ dealId: null, contactId: null, accountId: null })],
    ["empty-string ids to createDealContact", () => store.createDealContact({ dealId: "", contactId: "", accountId: "" })],
    ["nullish ids to findDealContact", () => store.findDealContact(null, undefined)],
    ["empty-string ids to findDealContact", () => store.findDealContact("", "")],
    ["non-existent deal to listContactsByDeal", () => store.listContactsByDeal("deal_does_not_exist")],
    ["nullish id to listContactsByDeal", () => store.listContactsByDeal(null)],
    ["non-existent contact to listDealsByContact", () => store.listDealsByContact("con_does_not_exist")],
    ["nullish id to listDealsByContact", () => store.listDealsByContact(undefined)],
    ["non-existent pair to setPrimaryDealContact", () => store.setPrimaryDealContact("deal_does_not_exist", "con_does_not_exist")],
    ["nullish ids to setPrimaryDealContact", () => store.setPrimaryDealContact(null, null)],
    ["non-existent pair to removeDealContact", () => store.removeDealContact("deal_does_not_exist", CON_1)],
    ["nullish ids to removeDealContact", () => store.removeDealContact(null, "")],
  ];
  for (const [label, fn] of cases) {
    try {
      await fn();
    } catch (err) {
      throw new Error(`${label} threw: ${err?.message || err} — hostile input must be a no-op, not a crash`);
    }
  }
  // A garbage write must not have polluted a real deal's contact list.
  assert.deepEqual(
    ids(await store.listContactsByDeal(DEAL_A)),
    [CON_1, CON_2].sort(),
    `hostile createDealContact calls leaked rows into ${DEAL_A}`,
  );
  assert.deepEqual(await store.listContactsByDeal(null), [], "listContactsByDeal(null) must return an empty list, not every row");
  assert.deepEqual(await store.listDealsByContact(""), [], 'listDealsByContact("") must return an empty list, not every row');
});

await check("createDealContact tolerates a missing argument object", async () => {
  // Separate from the case list above so the fix is a one-liner: the join writer is
  // called from best-effort cascade paths where the link payload can be absent.
  await store.createDealContact(undefined);
});

await check("clearAll() drops dealContacts rows", async () => {
  await seedJoins();
  store.clearAll();
  const rows = await store.listContactsByDeal(DEAL_A);
  assert.deepEqual(
    rows,
    [],
    `clearAll() left ${rows.length} dealContacts row(s) behind — "dealContacts" is missing from the collection list in local-store.js clearAll(), so a dev reset resurrects links to deleted deals`,
  );
});

const passed = results.filter(Boolean).length;
if (passed !== results.length) {
  console.error(`\n${passed}/${results.length} deal-contact store checks passed.`);
  process.exit(1);
}
console.log(`\n${results.length} deal-contact store checks passed.`);
