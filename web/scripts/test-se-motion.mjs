/** defaultSeMotion from acting SE team / segment. */
import { defaultSeMotion, seMotionFromPostCallDoc } from "../domain/se-motion.js";
import {
  TEAM_AJAY_ID,
  TEAM_NIKIL_ID,
  TEAM_MARY_ID,
  TEAM_VARUN_ID,
  TEAM_AKSHITA_ID,
  SEG_NEW_BUSINESS_ID,
  SEG_NURTURE_ID,
  SEG_DIGITAL_ID,
} from "../domain/constants.js";
import {
  callTypesForMotion,
  remapCallTypeForMotion,
  profileFor,
} from "../rubric-profiles.js";
import { buildCallSummaryFromPostCall, callSummariesToAnalyses } from "../domain/call-summary.js";
import { postCallRecordsToAnalyses } from "../domain/postcall-hydrate.js";
import { CALL_SUMMARY_LIST_FIELDS } from "../domain/field-masks.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(defaultSeMotion({ teamId: TEAM_AJAY_ID }) === "new_business", "Ajay team → NB");
assert(defaultSeMotion({ teamId: TEAM_NIKIL_ID }) === "new_business", "Nikil team → NB");
assert(defaultSeMotion({ teamId: TEAM_MARY_ID }) === "expansion", "Mary team → expansion");
assert(defaultSeMotion({ teamId: TEAM_VARUN_ID }) === "expansion", "Varun team → expansion");
assert(defaultSeMotion({ teamId: TEAM_AKSHITA_ID }) === "expansion", "Digital team → expansion");

assert(defaultSeMotion({ segmentId: SEG_NEW_BUSINESS_ID }) === "new_business", "Antony / NB segment → NB");
assert(defaultSeMotion({ segmentId: SEG_NURTURE_ID }) === "expansion", "Preethi Sriram / Nurture → expansion");
assert(defaultSeMotion({ segmentId: SEG_DIGITAL_ID }) === "expansion", "Preethi Sri / Digital → expansion");
assert(defaultSeMotion({}) === "new_business", "director / admin with no team → NB default");

assert(
  defaultSeMotion({ teamId: TEAM_AJAY_ID, segmentId: SEG_NURTURE_ID }) === "new_business",
  "team wins over segment",
);

assert(callTypesForMotion("new_business").length === 8, "NB has 8 call types");
assert(callTypesForMotion("expansion").length === 11, "expansion has 11 call types");
assert(!callTypesForMotion("new_business").includes("demo_plan_upgrade"), "NB excludes expansion-only keys");
assert(callTypesForMotion("expansion").includes("demo_plan_upgrade"), "expansion includes plan-upgrade");
assert(callTypesForMotion("expansion").includes("churn_mitigation"), "expansion includes churn");
assert(!callTypesForMotion("expansion").includes("demo"), "expansion catalog has no generic demo");

assert(remapCallTypeForMotion("demo", "expansion") === "demo_plan_upgrade", "demo remaps to plan-upgrade");
assert(remapCallTypeForMotion("demo_plan_upgrade", "new_business") === "demo", "plan-upgrade remaps to demo");
assert(remapCallTypeForMotion("churn_mitigation", "new_business") === "troubleshooting", "churn remaps to troubleshooting");
assert(remapCallTypeForMotion("discovery", "expansion") === "discovery", "shared key stays");

assert(profileFor("discovery", "new_business").totalCredits === 32, "NB discovery credits");
assert(profileFor("discovery", "expansion").totalCredits === 27, "expansion discovery credits");

assert(seMotionFromPostCallDoc({ seMotion: "expansion" }) === "expansion", "top-level seMotion");
assert(
  seMotionFromPostCallDoc({ analysisMeta: { seMotion: "expansion" } }) === "expansion",
  "analysisMeta.seMotion",
);
assert(
  seMotionFromPostCallDoc({ detail: { confirmed: { seMotion: "expansion" } } }) === "expansion",
  "detail.confirmed.seMotion",
);
assert(
  seMotionFromPostCallDoc({ analysis: { seMotion: "expansion" } }) === "new_business",
  "analysis JSONB seMotion is ignored",
);
assert(seMotionFromPostCallDoc({}) === "new_business", "missing defaults to NB");
assert(CALL_SUMMARY_LIST_FIELDS.includes("seMotion"), "list mask includes seMotion");

const summary = buildCallSummaryFromPostCall({
  id: "pc_1",
  ownerId: "u1",
  teamId: "team_mary",
  accountId: "acc_1",
  callType: "discovery",
  seMotion: "expansion",
  analysis: {},
  createdAt: 1,
});
assert(summary.seMotion === "expansion", "call summary stamps seMotion");
const listed = callSummariesToAnalyses([summary]);
assert(listed[0].analysisMeta.seMotion === "expansion", "list hydrate keeps expansion");
assert(listed[0].scorecard === null || listed[0].scorecard.seMotion === "expansion", "list scorecard motion");

const hydrated = postCallRecordsToAnalyses([
  { id: "pc_1", callType: "discovery", seMotion: "expansion", analysis: {}, scorecard: { overall: 7 } },
]);
assert(hydrated[0].analysisMeta.seMotion === "expansion", "postcall hydrate stamps analysisMeta");
assert(hydrated[0].scorecard.seMotion === "expansion", "postcall hydrate stamps scorecard");

console.log("test-se-motion: OK");
