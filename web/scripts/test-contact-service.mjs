/** Smoke tests for contact merge, MEDDPICC, and activity events. */

import { initDomainStore, getStore } from "../domain/store.js";
import {
  mergeFieldSlot,
  mergeAccountMeddpicc,
  mergeContactFromPrep,
  mergeContactFromEnrichment,
  meddpiccSignalsFromProspectInfluence,
  mergeContactFromPostCall,
  computeMeddpiccScore,
  meddpiccSignalsFromPrep,
  meddpiccSignalsFromPostCall,
  recordContactEvent,
  applyPrepContactFrameworks,
  ensureCustomerContact,
} from "../domain/contact-service.js";
import { newId, now } from "../domain/types.js";

const ls = new Map();
globalThis.localStorage = {
  getItem: (k) => ls.get(k) ?? null,
  setItem: (k, v) => ls.set(k, v),
  removeItem: (k) => ls.delete(k),
  key: (i) => [...ls.keys()][i] ?? null,
  get length() {
    return ls.size;
  },
};

initDomainStore(null);
const store = getStore();
const ts = now();

const accountId = "acc_test";
const contactId = "con_test";

await store.createAccount({
  id: accountId,
  name: "Test Co",
  domain: "test.co",
  slug: "test-co",
  createdAt: ts,
  updatedAt: ts,
});

await store.createContact({
  id: contactId,
  accountId,
  email: "alex@test.co",
  name: "Alex Lee",
  title: "VP Support",
  createdAt: ts,
  updatedAt: ts,
});

await store.createDeal({
  id: "deal_test_nb",
  accountId,
  type: "new_business",
  stage: "research",
  status: "active",
  ownerId: "usr_test",
  teamId: "team_test",
  orgId: null,
  title: "NB",
  prepCount: 0,
  postCallCount: 0,
  openTaskCount: 0,
  latestQualityScore: null,
  createdAt: ts,
  updatedAt: ts,
  lastActivityAt: ts,
});

const confirmed = mergeFieldSlot(
  { value: "Existing pain", status: "confirmed", source: "prep", updatedAt: ts },
  { value: "New weaker pain", status: "partial", source: "postcall", updatedAt: ts + 1 }
);

const upgraded = mergeFieldSlot(
  { value: "Partial metrics", status: "partial", source: "prep", updatedAt: ts },
  { value: "Confirmed metrics", status: "confirmed", source: "postcall", updatedAt: ts + 1 }
);

const medMeta = mergeAccountMeddpicc(
  {},
  {
    identifyPain: { value: "Slow response times", status: "partial" },
    metrics: { value: "CSAT target 90%", status: "partial" },
  },
  "prep"
);

const prepMerge = mergeContactFromPrep(
  { id: contactId, metadata: {} },
  {
    attendee: { decisionPower: "decision_maker" },
    discHint: { primary: "D", confidence: "medium", evidence: ["Direct tone in prep notes"] },
    ts,
  }
);

const postMerge = mergeContactFromPostCall(
  { id: contactId, name: "Alex Lee", metadata: prepMerge.metadata },
  { name: "Alex Lee", role: "VP Support", influence: "high" }
);

await recordContactEvent(contactId, "linked_from_prep", "usr_test", { fields: ["disc"] });
const events = await store.listContactEvents(contactId, 5);

const enrichMerge = mergeContactFromEnrichment(
  { id: contactId, metadata: {} },
  {
    email: "alex@test.co",
    profile: {
      name: "Alex Lee",
      role: "VP Support",
      totalExperience: "15 years",
      priorEmployers: ["Globex"],
      summary: "Support executive.",
      skills: ["Ops"],
      languages: [],
      education: [],
      competitorTouchpoints: [],
    },
    disc: { primary: "C", confidence: "low", evidence: ["Detail-oriented bio"], inferred: true, source: "linkedin_pdf" },
    influence: { level: "high", decisionRole: "economic_buyer" },
  }
);

const influenceSignals = meddpiccSignalsFromProspectInfluence(
  { name: "Alex Lee", role: "VP", influence: { level: "high", decisionRole: "economic_buyer" } },
  contactId
);

const prep = {
  likelyPains: ["High ticket volume", "Agent burnout"],
  meddpiccHints: {
    champion: { value: "Alex Lee", status: "partial", contactId },
  },
  attendees: [{ name: "Alex Lee", role: "VP", decisionPower: "decision_maker" }],
  prospects: [{ name: "Alex Lee", role: "VP", discHint: { primary: "I", confidence: "low" } }],
};

await applyPrepContactFrameworks(accountId, prep, ["alex@test.co"], {
  actorId: "usr_test",
  dealId: "deal_test_nb",
});

const accountAfter = await store.getAccount(accountId);
const dealAfter = await store.getDeal("deal_test_nb");
const contactAfter = await store.findContactByAccountEmail(accountId, "alex@test.co");

const checks = [
  ["confirmed not downgraded", confirmed.value === "Existing pain" && confirmed.status === "confirmed"],
  ["partial upgraded to confirmed", upgraded.status === "confirmed" && upgraded.value === "Confirmed metrics"],
  ["meddpicc merge", !!medMeta.meddpicc?.identifyPain?.value],
  ["meddpicc score", computeMeddpiccScore(medMeta.meddpicc) > 0],
  ["prep influence merge", prepMerge.changes.includes("influence")],
  ["prep disc merge", prepMerge.changes.includes("disc")],
  ["enrich research merge", enrichMerge.changes.includes("research")],
  ["enrich disc merge", enrichMerge.changes.includes("disc")],
  ["influence meddpicc hint", !!influenceSignals.economicBuyer?.value],
  ["postcall influence merge", postMerge.changes.includes("influence")],
  ["contact event recorded", events.length >= 1],
  ["apply prep updates deal meddpicc", !!dealAfter.metadata?.meddpicc?.champion],
  ["apply prep leaves account meddpicc empty", !accountAfter.metadata?.meddpicc],
  ["signals from prep pains", !!meddpiccSignalsFromPrep({ likelyPains: ["Pain A"] }).identifyPain],
  ["signals from postcall", !!meddpiccSignalsFromPostCall({
    signals: { painsConfirmed: ["Pain"], competitors: ["Zendesk"] },
    momentum: { topAction: "Schedule demo", topActionDue: "Friday" },
  }).identifyPain],
];

const created = await ensureCustomerContact(accountId, {
  name: "New Customer",
  email: "new@test.co",
});
const duplicate = await ensureCustomerContact(accountId, {
  name: "New Customer",
  email: "new@test.co",
});
checks.push(["ensureCustomerContact creates", !!created?.id]);
checks.push(["ensureCustomerContact idempotent", duplicate?.id === created?.id]);

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    console.error("FAIL:", name);
    failed++;
  } else {
    console.log("ok:", name);
  }
}

if (failed) process.exit(1);
console.log(`\n${checks.length} contact service checks passed.`);
