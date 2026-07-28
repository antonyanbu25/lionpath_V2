/**
 * MEDDPICC on deal — domain tests (ADR 005).
 */
import { initDomainStore, getStore } from "../domain/store.js";
import {
  mergeFieldSlot,
  mergeDealMeddpicc,
  resolveDealMeddpicc,
  computeMeddpiccScore,
  meddpiccSignalsFromPrep,
  applyPrepContactFrameworks,
  MEDDPICC_ACCOUNT_FALLBACK,
} from "../domain/contact-service.js";
import { migrateMeddpiccAccountToDeals } from "../domain/migrate-meddpicc-to-deals.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};

initDomainStore(null);
const store = getStore();
if (store.clearAll) store.clearAll();

const confirmed = mergeFieldSlot(
  { value: "A", status: "confirmed", updatedAt: 1 },
  { value: "B", status: "partial", updatedAt: 2 },
);
assert(confirmed.value === "A" && confirmed.status === "confirmed", "confirmed slot not downgraded");

const deal = {
  id: "deal_test",
  accountId: "acc_test",
  type: "new_business",
  metadata: { meddpicc: { identifyPain: { value: "Pain on deal", status: "partial" } } },
};
const account = {
  id: "acc_test",
  metadata: { meddpicc: { identifyPain: { value: "Pain on account", status: "partial" } } },
};
assert(
  resolveDealMeddpicc(deal, account).identifyPain.value === "Pain on deal",
  "resolveDealMeddpicc prefers deal",
);

const patch = mergeDealMeddpicc(
  { id: "deal_m", accountId: "acc_m", metadata: {} },
  meddpiccSignalsFromPrep({ likelyPains: ["Scale hiring"] }),
  "prep",
);
assert(patch?.metadata?.meddpicc?.identifyPain?.value, "mergeDealMeddpicc sets identifyPain");
assert(computeMeddpiccScore(patch.metadata.meddpicc) > 0, "score after merge");

await store.createAccount({
  id: "acc_m",
  name: "Migrate Co",
  slug: "migrate-co",
  domain: "migrate.co",
  metadata: {
    meddpicc: {
      champion: { value: "Alex", status: "partial" },
      completionScore: 12,
      lastUpdatedAt: Date.now(),
    },
  },
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

await store.createDeal({
  id: "deal_nb_m",
  accountId: "acc_m",
  type: "new_business",
  stage: "research",
  status: "active",
  ownerId: "usr_m",
  teamId: "team_m",
  orgId: null,
  title: "NB",
  prepCount: 0,
  postCallCount: 0,
  openTaskCount: 0,
  latestQualityScore: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastActivityAt: Date.now(),
});

const mig = await migrateMeddpiccAccountToDeals(store);
assert(mig.migrated === 1, "migration copies to NB deal");
const migratedDeal = await store.getDeal("deal_nb_m");
assert(migratedDeal.metadata?.meddpicc?.champion?.value === "Alex", "deal has copied champion");
const accM = await store.getAccount("acc_m");
assert(accM.metadata?.meddpicc?.champion, "account meddpicc retained during fallback phase");

await store.createAccount({
  id: "acc_prep",
  name: "Prep Co",
  slug: "prep-co",
  domain: "prep.co",
  createdAt: Date.now(),
  updatedAt: Date.now(),
});
await store.createDeal({
  id: "deal_prep",
  accountId: "acc_prep",
  type: "new_business",
  stage: "research",
  status: "active",
  ownerId: "usr_p",
  teamId: "team_p",
  orgId: null,
  title: "NB",
  prepCount: 0,
  postCallCount: 0,
  openTaskCount: 0,
  latestQualityScore: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastActivityAt: Date.now(),
});

await applyPrepContactFrameworks(
  "acc_prep",
  { likelyPains: ["Workflow gaps"], meddpiccHints: { metrics: { value: "30% faster", status: "partial" } } },
  [],
  { dealId: "deal_prep", actorId: "usr_p" },
);
const afterPrep = await store.getDeal("deal_prep");
const accAfter = await store.getAccount("acc_prep");
assert(afterPrep.metadata?.meddpicc?.metrics?.value === "30% faster", "prep writes deal meddpicc");
assert(!accAfter.metadata?.meddpicc, "prep does not write account meddpicc");

assert(MEDDPICC_ACCOUNT_FALLBACK === true, "fallback flag on until cleanup");

console.log("test-deal-meddpicc: ok");
