#!/usr/bin/env node
/** Unit tests for Pass 8 deal traction rollup (no browser). */

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const {
  computeDealTraction,
  momentumPoints,
  timeDecayWeight,
  scoreToTraction,
  countUndatedNextSteps,
  videoGapReasons,
  aggregateMomentum,
} = await import("../domain/deal-traction.js");

assert(momentumPoints("Advancing") === 2, "Advancing momentum");
assert(momentumPoints("Stalled") === -2, "Stalled momentum");
assert(scoreToTraction(4) === "hot", "hot threshold");
assert(scoreToTraction(-3) === "cold", "cold threshold");
assert(scoreToTraction(0) === "warm", "warm default");

assert(countUndatedNextSteps([{ action: "Send recap", due: "" }]) === 1, "undated next step");
assert(countUndatedNextSteps([{ action: "Send recap", due: "Friday" }]) === 0, "dated next step");

assert(videoGapReasons(null).length === 3, "three video gaps without facts");
assert(videoGapReasons({ cameraOnPct: 80 }).length === 0, "no gaps when video present");

const now = Date.now();
const hot = computeDealTraction({
  deal: {
    stage: "demo",
    lastActivityAt: now - 86400000,
    updatedAt: now - 86400000 * 5,
    metadata: {
      meddpicc: { champion: { value: "Pat", status: "confirmed" } },
    },
  },
  analysis: {
    momentum: { status: "Advancing", reason: "Customer owned next step", topAction: "Send security pack" },
    nextSteps: [{ owner: "customer", action: "Review security doc", due: "Next week", why: "Gate" }],
  },
  followUps: [],
  objections: [],
  videoFacts: null,
  technicalCommit: { status: "yes", justification: "Pilot agreed" },
  priorCalls: [],
  daysInStage: 5,
  stageMedianDays: 14,
  nowMs: now,
});
assert(hot.traction === "hot", `expected hot got ${hot.traction}`);
assert(hot.recommendedAction, "recommended action required");
assert(hot.reasonsJson.length >= 2, "visible reasons");
assert(!/^\d+\/100/.test(hot.traction), "traction is label not number");
assert(hot.reasonsJson.some((r) => r.includes("without video")), "video gaps listed");

const cold = computeDealTraction({
  deal: {
    stage: "evaluation",
    lastActivityAt: now - 86400000 * 20,
    updatedAt: now - 86400000 * 40,
    metadata: { meddpicc: {} },
  },
  analysis: {
    momentum: { status: "Stalled", reason: "No owner on next step" },
    nextSteps: [
      { owner: "se", action: "Follow up", due: "", why: "Risk" },
      { owner: "customer", action: "Intro EB", due: "TBD", why: "Risk" },
    ],
    signals: { objectionsOpen: ["Pricing too high"] },
  },
  followUps: [],
  objections: [{ objectionText: "Pricing", landed: false }],
  priorCalls: [{ callId: "old", createdAt: now - 86400000 * 10, momentum: { status: "Stalled" } }],
  daysInStage: 45,
  stageMedianDays: 21,
  nowMs: now,
});
assert(cold.traction === "cold", `expected cold got ${cold.traction}`);
assert(cold.daysSilent >= 20, "daysSilent computed");

const decay = aggregateMomentum(
  [
    { momentum: { status: "Advancing" }, createdAt: now },
    { momentum: { status: "Stalled" }, createdAt: now - 86400000 * 60 },
  ],
  now,
);
assert(decay.avg > 0, "recent advancing outweighs old stalled");

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};
globalThis.sessionStorage = globalThis.localStorage;

const { initDomainStore } = await import("../domain/store.js");
initDomainStore(null);
const { newId, now: tsNow } = await import("../domain/types.js");
const { getStore } = await import("../domain/store.js");
const { rollupDealTractionAfterPostCall } = await import("../domain/deal-service.js");

const store = getStore();
const accountId = newId("account");
const dealId = newId("deal");
const callId = newId("postCall");
const ownerId = newId("user");
const t0 = tsNow();

await store.createDeal({
  id: dealId,
  accountId,
  type: "new_business",
  stage: "discovery",
  status: "active",
  ownerId,
  teamId: "team_test",
  orgId: "org_test",
  primaryContactId: null,
  title: "Traction test",
  prepCount: 0,
  postCallCount: 1,
  openTaskCount: 0,
  metadata: {
    meddpicc: { champion: { value: "Sam", status: "partial" } },
  },
  createdAt: t0,
  updatedAt: t0,
  lastActivityAt: t0,
});

await rollupDealTractionAfterPostCall(dealId, {
  callId,
  accountId,
  ownerId,
  teamId: "team_test",
  orgId: "org_test",
  analysis: {
    momentum: { status: "At risk", reason: "Champion quiet", topAction: "Reconfirm champion" },
    nextSteps: [{ owner: "se", action: "Email champion", due: "", why: "No date" }],
  },
  callCreatedAt: t0,
});

const rows = await store.listDealSignalsByCall(callId);
assert(rows.length === 1, "one deal_signal per call");
assert(["hot", "warm", "cold"].includes(rows[0].traction), "traction label");
assert(rows[0].recommendedAction, "persisted recommended action");
assert(Array.isArray(rows[0].reasonsJson) && rows[0].reasonsJson.length > 0, "persisted reasons");

console.log("test-deal-traction: ok");
