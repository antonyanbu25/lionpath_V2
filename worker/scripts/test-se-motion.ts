#!/usr/bin/env -S npx tsx
/** defaultSeMotion from acting SE team / segment. */

import { defaultSeMotion, seMotionFromPostCallDoc } from "../src/domain-model/se-motion.ts";
import {
  callTypesForMotion,
  remapCallTypeForMotion,
  profileFor,
} from "../src/rubric-profiles.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(defaultSeMotion({ teamId: "team_ajay" }) === "new_business", "Ajay team → NB");
assert(defaultSeMotion({ teamId: "team_nikil" }) === "new_business", "Nikil team → NB");
assert(defaultSeMotion({ teamId: "team_mary" }) === "expansion", "Mary team → expansion");
assert(defaultSeMotion({ teamId: "team_varun" }) === "expansion", "Varun team → expansion");
assert(defaultSeMotion({ teamId: "team_akshita" }) === "expansion", "Digital team → expansion");

assert(defaultSeMotion({ segmentId: "seg_new_business" }) === "new_business", "Antony / NB segment → NB");
assert(defaultSeMotion({ segmentId: "seg_nurture" }) === "expansion", "Preethi Sriram / Nurture → expansion");
assert(defaultSeMotion({ segmentId: "seg_digital" }) === "expansion", "Preethi Sri / Digital → expansion");
assert(defaultSeMotion({}) === "new_business", "director / admin with no team → NB default");

assert(callTypesForMotion("new_business").length === 8, "NB has 8 call types");
assert(callTypesForMotion("expansion").length === 11, "expansion has 11 call types");
assert(!callTypesForMotion("new_business").includes("demo_plan_upgrade"), "NB excludes expansion-only keys");
assert(callTypesForMotion("expansion").includes("churn_mitigation"), "expansion includes churn");
assert(remapCallTypeForMotion("demo", "expansion") === "demo_plan_upgrade", "demo remaps");
assert(profileFor("discovery", "expansion").totalCredits === 27, "expansion discovery credits");
assert(profileFor("discovery", "new_business").totalCredits === 32, "NB discovery credits");

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
assert(seMotionFromPostCallDoc({ seMotion: "nope" }) === "new_business", "invalid canonicalizes to NB");

console.log("test-se-motion: OK");
