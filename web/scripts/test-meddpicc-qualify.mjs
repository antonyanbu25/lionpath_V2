/** Tests for Pass 4 qualification merge + meddpiccDeltas write path. */

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

import { initDomainStore, getStore } from "../domain/store.js";
import {
  buildMeddpiccDeltaDrafts,
  meddpiccSignalsFromQualification,
  mergeFieldSlot,
} from "../domain/contact-service.js";
import { applyQualificationToDeal } from "../domain/meddpicc-qualify-service.js";
import { now } from "../domain/types.js";

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

await store.createAccount({
  id: "acc_qualify",
  name: "Qualify Co",
  domain: "qualify.co",
  slug: "qualify-co",
  createdAt: ts,
  updatedAt: ts,
});

await store.createDeal({
  id: "deal_qualify",
  accountId: "acc_qualify",
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
  metadata: {
    meddpicc: {
      champion: { value: "Alex Lee", status: "partial", source: "prep", updatedAt: ts },
    },
  },
  createdAt: ts,
  updatedAt: ts,
  lastActivityAt: ts,
});

const qualification = {
  metrics: { value: "20% faster handle time", evidence: "We need 20% faster handling", surfaced: true },
  economicBuyer: { value: "", evidence: "not surfaced", surfaced: false },
  decisionCriteria: { value: "", evidence: "not surfaced", surfaced: false },
  decisionProcess: { value: "", evidence: "not surfaced", surfaced: false },
  paperProcess: { value: "", evidence: "not surfaced", surfaced: false },
  identifyPain: { value: "Ticket backlog", evidence: "Backlog is crushing the team", surfaced: true },
  champion: {
    value: "Jordan Smith",
    evidence: "Jordan said she will push this internally with ops",
    surfaced: true,
  },
  competition: { value: "", evidence: "not surfaced", surfaced: false },
};

const signals = meddpiccSignalsFromQualification(qualification);
assert(Object.keys(signals).length === 3, "signals from surfaced slots only");
assert(signals.champion.value === "Jordan Smith", "champion signal");

const deltasBefore = buildMeddpiccDeltaDrafts(
  "deal_qualify",
  "call_test",
  { champion: { value: "Alex Lee", status: "partial" } },
  qualification,
);
assert(deltasBefore.some((d) => d.slot === "champion" && d.changeType === "changed"), "champion changed delta");
assert(deltasBefore.some((d) => d.slot === "metrics" && d.changeType === "new"), "metrics new delta");

const blocked = mergeFieldSlot(
  { value: "Signed CFO", status: "confirmed", updatedAt: ts },
  { value: "Maybe CFO", status: "partial", updatedAt: ts + 1 },
);
assert(blocked.status === "confirmed", "confirmed not downgraded");

const { deal, deltas } = await applyQualificationToDeal("deal_qualify", "acc_qualify", qualification, {
  callId: "call_test",
  ownerId: "usr_test",
  teamId: "team_test",
  orgId: "",
  accountId: "acc_qualify",
});

assert(deal?.metadata?.meddpicc?.champion?.value === "Jordan Smith", "deal champion updated");
assert(deal?.metadata?.meddpicc?.lastUpdatedAt, "lastUpdatedAt refreshed");
assert(typeof deal?.metadata?.meddpicc?.completionScore === "number", "completionScore recomputed");
assert(deltas.length >= 3, "deltas persisted");

const stored = await store.listMeddpiccDeltasByCall("call_test");
assert(stored.length === deltas.length, "store round-trip");

console.log("test-meddpicc-qualify: ok");
