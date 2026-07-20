/** Smoke tests for org hierarchy — scope resolution, org leaders, RBAC parity. */

import { initDomainStore, getStore } from "../domain/store.js";
import {
  getVisibleScope,
  isOrgDirector,
  isOrgLeader,
  listVisibleSeEmails,
  validateHierarchy,
  userWithDirectorFlag,
} from "../domain/org-service.js";
import { can } from "../domain/types.js";
import { seedDevDomainIfNeeded, enrichSessionFromStore } from "../domain/seed-dev.js";
import { stableUserIdForEmail } from "../domain/id.js";
import {
  DEMO_ORG_ID,
  SQUAD_TEAM_IDS,
  TEAM_AJAY_ID,
  TEAM_NIKIL_ID,
  TEAM_PREETHI_SRI_ID,
} from "../domain/constants.js";

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

await seedDevDomainIfNeeded();

const vipinId = stableUserIdForEmail("vipin.thomas@freshworks.com");
const antonyId = stableUserIdForEmail("antony.sagayaraj@freshworks.com");
const squadMgrId = stableUserIdForEmail("ajay.raghavan@freshworks.com");
const seAjayId = stableUserIdForEmail("saketh.poruri@freshworks.com");
const sePreethiId = stableUserIdForEmail("se.preethi.sri.1@freshworks.com");

const org = await store.getOrg(DEMO_ORG_ID);
const vipin = await store.getUser(vipinId);
const antony = await store.getUser(antonyId);
const squadMgr = await store.getUser(squadMgrId);
const seAjay = await store.getUser(seAjayId);
const sePreethi = await store.getUser(sePreethiId);

const vipinEnriched = userWithDirectorFlag(vipin, org);
const antonyEnriched = userWithDirectorFlag(antony, org);
const squadMgrEnriched = userWithDirectorFlag(squadMgr, org);

const vipinScope = await getVisibleScope(vipinEnriched);
const antonyScope = await getVisibleScope(antonyEnriched);
const squadMgrScope = await getVisibleScope(squadMgrEnriched);
const seScope = await getVisibleScope(seAjay);

const vipinSession = await enrichSessionFromStore({
  email: "vipin.thomas@freshworks.com",
  role: "manager",
  userId: vipinId,
});

const antonySession = await enrichSessionFromStore({
  email: "antony.sagayaraj@freshworks.com",
  role: "manager",
  userId: antonyId,
});

const visibleEmails = await listVisibleSeEmails(vipinSession);

const usersById = new Map([
  [seAjay.id, seAjay],
  [squadMgr.id, squadMgr],
  [antony.id, antony],
  [vipin.id, vipin],
]);

const checks = [
  ["org seeded", !!org && org.directorId === vipinId],
  [
    "seniorLeaderIds populated",
    org?.seniorLeaderIds?.length === 3 && org.seniorLeaderIds.includes(antonyId),
  ],
  ["org has four squads", SQUAD_TEAM_IDS.every((id) => org?.teamIds?.includes(id))],
  ["vipin is director", isOrgDirector(vipinId, org)],
  ["vipin is org leader", isOrgLeader(vipinId, org)],
  ["antony is org leader", isOrgLeader(antonyId, org)],
  ["antony not director", !isOrgDirector(antonyId, org)],
  ["squad mgr not org leader", !isOrgLeader(squadMgrId, org)],
  ["vipin scope type org", vipinScope.type === "org"],
  ["antony scope type org", antonyScope.type === "org"],
  [
    "vipin sees all squads",
    SQUAD_TEAM_IDS.every((id) => vipinScope.teamIds.includes(id)),
  ],
  [
    "squad mgr scope type team",
    squadMgrScope.type === "team" && squadMgrScope.teamIds[0] === TEAM_AJAY_ID,
  ],
  ["se scope own", seScope.type === "own"],
  ["vipin session isOrgDirector", vipinSession.isOrgDirector === true],
  ["antony session isOrgDirector", antonySession.isOrgDirector === true],
  ["vipin session orgId", vipinSession.orgId === DEMO_ORG_ID],
  ["vipin sees ajay squad se", visibleEmails.includes("saketh.poruri@freshworks.com")],
  ["vipin sees nikil squad se", visibleEmails.includes("vivehanandan.agoram@freshworks.com")],
  ["vipin sees preethi squad se", visibleEmails.includes("se.preethi.sri.1@freshworks.com")],
  [
    "squad mgr cannot read other team artifact",
    !can(squadMgrEnriched, "read", {
      ownerId: sePreethiId,
      teamId: TEAM_PREETHI_SRI_ID,
      orgId: DEMO_ORG_ID,
    }),
  ],
  [
    "antony can read other team artifact",
    can(antonyEnriched, "read", {
      ownerId: sePreethiId,
      teamId: TEAM_PREETHI_SRI_ID,
      orgId: DEMO_ORG_ID,
    }),
  ],
  [
    "se can read own",
    can(seAjay, "read", {
      ownerId: seAjayId,
      teamId: TEAM_AJAY_ID,
      orgId: DEMO_ORG_ID,
    }),
  ],
  [
    "squad mgr cannot read nikil team se",
    !can(squadMgrEnriched, "read", {
      ownerId: stableUserIdForEmail("vivehanandan.agoram@freshworks.com"),
      teamId: TEAM_NIKIL_ID,
      orgId: DEMO_ORG_ID,
    }),
  ],
  ["hierarchy no cycle", validateHierarchy(seAjay, usersById) && validateHierarchy(squadMgr, usersById)],
  ["se reports to squad mgr", seAjay.managerId === squadMgrId],
  ["squad mgr reports to antony", squadMgr.managerId === antonyId],
  ["antony reports to vipin", antony.managerId === vipinId],
  ["vipin has job title", vipin.jobTitle?.includes("Senior Director")],
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

if (failed) process.exit(1);
console.log(`\n${checks.length} org hierarchy checks passed.`);
