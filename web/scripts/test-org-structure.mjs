/** Smoke tests for org structure editor — load scope, edit permissions, save validation. */

import { initDomainStore, getStore } from "../domain/store.js";
import { seedDevDomainIfNeeded, enrichSessionFromStore } from "../domain/seed-dev.js";
import { stableUserIdForEmail } from "../domain/id.js";
import {
  loadOrgStructure,
  saveOrgStructureReassignments,
  canEditOrgStructure,
} from "../domain/org-structure-service.js";
import { DEMO_ORG_ID, TEAM_AJAY_ID, TEAM_NIKIL_ID, TEAM_AKSHITA_ID } from "../domain/constants.js";

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
await seedDevDomainIfNeeded();

const vipinSession = await enrichSessionFromStore({
  email: "vipin.thomas@freshworks.com",
  role: "manager",
  userId: stableUserIdForEmail("vipin.thomas@freshworks.com"),
});

const antonySession = await enrichSessionFromStore({
  email: "antony.sagayaraj@freshworks.com",
  role: "manager",
  userId: stableUserIdForEmail("antony.sagayaraj@freshworks.com"),
});

const preethiSession = await enrichSessionFromStore({
  email: "preethi.sri@freshworks.com",
  role: "manager",
  userId: stableUserIdForEmail("preethi.sri@freshworks.com"),
});

const teamMgrSession = await enrichSessionFromStore({
  email: "ajay.raghavan@freshworks.com",
  role: "manager",
  userId: stableUserIdForEmail("ajay.raghavan@freshworks.com"),
});

const preethiTree = await loadOrgStructure(preethiSession);
const preethiDigitalTeam = preethiTree.segments?.[0]?.teams?.find((t) => t.id === TEAM_AKSHITA_ID);

const vipinTree = await loadOrgStructure(vipinSession);
const antonyTree = await loadOrgStructure(antonySession);

const seAjayId = stableUserIdForEmail("saketh.poruri@freshworks.com");
const ajayMgrId = stableUserIdForEmail("ajay.raghavan@freshworks.com");
const nikilMgrId = stableUserIdForEmail("nikil.ravi@freshworks.com");
const digitalSeId = stableUserIdForEmail("avinash.kumar@freshworks.com");

const checks = [
  ["vipin can edit structure", canEditOrgStructure(vipinSession)],
  ["antony can edit structure", canEditOrgStructure(antonySession)],
  ["team mgr cannot edit structure", !canEditOrgStructure(teamMgrSession)],
  ["vipin sees three segments", vipinTree.segments?.length === 3],
  ["vipin can cross segment", vipinTree.canCrossSegment === true],
  ["antony sees one segment", antonyTree.segments?.length === 1],
  ["antony segment is NB", antonyTree.segments?.[0]?.name === "New Business"],
  [
    "antony NB has two teams",
    antonyTree.segments?.[0]?.teams?.length === 2,
  ],
  [
    "vipin tree includes digital team",
    vipinTree.segments.some((s) => s.teams.some((t) => t.id === TEAM_AKSHITA_ID)),
  ],
  ["preethi sees digital segment only", preethiTree.segments?.length === 1],
  ["digital team has no team manager row", preethiDigitalTeam?.manager == null],
  ["digital team has ICs", (preethiDigitalTeam?.ics?.length || 0) === 8],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    console.error("FAIL:", name);
    failed++;
  } else {
    console.log("ok:", name);
  }
}

try {
  await saveOrgStructureReassignments(antonySession, [
    {
      userId: digitalSeId,
      managerId: ajayMgrId,
      teamId: TEAM_AJAY_ID,
      fromSegmentId: "seg_digital",
      toSegmentId: "seg_new_business",
    },
  ]);
  console.error("FAIL: antony cross-segment save should throw");
  failed++;
} catch (err) {
  if (err.message.includes("Cross-segment")) {
    console.log("ok: antony cross-segment blocked");
  } else {
    console.error("FAIL: antony cross-segment wrong error:", err.message);
    failed++;
  }
}

try {
  await saveOrgStructureReassignments(antonySession, [
    {
      userId: seAjayId,
      managerId: nikilMgrId,
      teamId: TEAM_NIKIL_ID,
    },
  ]);
  console.log("ok: antony in-segment reassignment saves");
  const store = getStore();
  const moved = await store.getUser(seAjayId);
  if (moved.teamId !== TEAM_NIKIL_ID) {
    console.error("FAIL: se teamId not updated after save");
    failed++;
  } else {
    console.log("ok: se teamId updated after save");
  }
  await saveOrgStructureReassignments(antonySession, [
    {
      userId: seAjayId,
      managerId: ajayMgrId,
      teamId: TEAM_AJAY_ID,
    },
  ]);
} catch (err) {
  console.error("FAIL: antony in-segment save:", err.message);
  failed++;
}

if (failed) process.exit(1);
console.log(`\n${checks.length + 3} org structure checks passed.`);
