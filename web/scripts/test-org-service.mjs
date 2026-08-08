/** Smoke tests for org hierarchy — scope resolution, org leaders, RBAC parity. */

import { initDomainStore, getStore } from "../domain/store.js";
import {
  getVisibleScope,
  isOrgDirector,
  isOrgLeader,
  listVisibleSeEmails,
  validateHierarchy,
  userWithDirectorFlag,
  resolveManagerRecipientForOwner,
} from "../domain/org-service.js";
import { can } from "../domain/types.js";
import { seedDevDomainIfNeeded, enrichSessionFromStore } from "../domain/seed-dev.js";
import { stableUserIdForEmail } from "../domain/id.js";
import { listTeamSeOptions, canManagerActForSe } from "../domain/acting-owner.js";
import {
  DEMO_ORG_ID,
  ORG_TEAM_IDS,
  TEAM_AJAY_ID,
  TEAM_NIKIL_ID,
  TEAM_AKSHITA_ID,
  SEG_NEW_BUSINESS_ID,
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
const teamMgrId = stableUserIdForEmail("ajay.raghavan@freshworks.com");
const seAjayId = stableUserIdForEmail("saketh.poruri@freshworks.com");
const seDigitalId = stableUserIdForEmail("avinash.kumar@freshworks.com");

const org = await store.getOrg(DEMO_ORG_ID);
const vipin = await store.getUser(vipinId);
const antony = await store.getUser(antonyId);
const teamMgr = await store.getUser(teamMgrId);
const seAjay = await store.getUser(seAjayId);
const seDigital = await store.getUser(seDigitalId);

const vipinEnriched = userWithDirectorFlag(vipin, org);
const antonyEnriched = userWithDirectorFlag(antony, org);
const teamMgrEnriched = userWithDirectorFlag(teamMgr, org);

const vipinScope = await getVisibleScope(vipinEnriched);
const antonyScope = await getVisibleScope(antonyEnriched);
const teamMgrScope = await getVisibleScope(teamMgrEnriched);
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

const preethiSession = await enrichSessionFromStore({
  email: "preethi.sri@freshworks.com",
  role: "manager",
  userId: stableUserIdForEmail("preethi.sri@freshworks.com"),
});

const vipinVisibleEmails = await listVisibleSeEmails(vipinSession);
const antonyVisibleEmails = await listVisibleSeEmails(antonySession);
const preethiVisibleEmails = await listVisibleSeEmails(preethiSession);
const preethiSeOptions = await listTeamSeOptions(preethiSession);
const ajaySession = await enrichSessionFromStore({
  email: "ajay.raghavan@freshworks.com",
  role: "manager",
  userId: teamMgrId,
});
const preethiCanActDigital = await canManagerActForSe(preethiSession, seDigitalId);
const vipinCanActDigital = await canManagerActForSe(vipinSession, seDigitalId);
const ajayCanActOwnSe = await canManagerActForSe(ajaySession, seAjayId);
const preethiCannotActAjaySe = !(await canManagerActForSe(preethiSession, seAjayId));
const digitalTeam = await store.getTeam(TEAM_AKSHITA_ID);

const usersById = new Map([
  [seAjay.id, seAjay],
  [teamMgr.id, teamMgr],
  [antony.id, antony],
  [vipin.id, vipin],
]);

const teamAjay = await store.getTeam(TEAM_AJAY_ID);
const teamsById = new Map(teamAjay ? [[teamAjay.id, teamAjay]] : []);

// Synthetic owners for fallback chain (do not mutate seeded users).
const seLineMgr = resolveManagerRecipientForOwner(seAjayId, org, usersById, teamsById);
const seNoLineMgr = {
  ...seAjay,
  id: "user_test_no_line_mgr",
  managerId: null,
  teamId: TEAM_AJAY_ID,
  email: "se.noline@freshworks.com",
};
const usersTeamFallback = new Map([...usersById, [seNoLineMgr.id, seNoLineMgr]]);
const teamMgrRecipient = resolveManagerRecipientForOwner(
  seNoLineMgr.id,
  org,
  usersTeamFallback,
  teamsById,
);

const seNoTeamMgr = {
  ...seAjay,
  id: "user_test_no_team_mgr",
  managerId: null,
  teamId: TEAM_AJAY_ID,
  email: "se.noteam@freshworks.com",
};
const teamNoMgr = { ...teamAjay, managerId: "" };
const usersSegFallback = new Map([...usersById, [seNoTeamMgr.id, seNoTeamMgr]]);
const teamsSegFallback = new Map([[TEAM_AJAY_ID, teamNoMgr]]);
const segLeaderRecipient = resolveManagerRecipientForOwner(
  seNoTeamMgr.id,
  org,
  usersSegFallback,
  teamsSegFallback,
);

const seOrphan = {
  ...seAjay,
  id: "user_test_orphan",
  managerId: null,
  teamId: "team_unknown_xyz",
  email: "se.orphan@freshworks.com",
};
const usersDirFallback = new Map([...usersById, [seOrphan.id, seOrphan]]);
const directorRecipient = resolveManagerRecipientForOwner(seOrphan.id, org, usersDirFallback, new Map());

const nullRecipient = resolveManagerRecipientForOwner("missing_user", org, usersById, teamsById);

const checks = [
  ["org seeded", !!org && org.directorId === vipinId],
  [
    "seniorLeaderIds populated",
    org?.seniorLeaderIds?.length === 3 && org.seniorLeaderIds.includes(antonyId),
  ],
  ["org has five teams", ORG_TEAM_IDS.length === 5 && ORG_TEAM_IDS.every((id) => org?.teamIds?.includes(id))],
  ["org has three segments", org?.segments?.length === 3],
  ["vipin is director", isOrgDirector(vipinId, org)],
  ["vipin is org leader", isOrgLeader(vipinId, org)],
  ["antony is org leader", isOrgLeader(antonyId, org)],
  ["antony not director", !isOrgDirector(antonyId, org)],
  ["team mgr not org leader", !isOrgLeader(teamMgrId, org)],
  ["vipin scope type org", vipinScope.type === "org"],
  ["antony scope type segment", antonyScope.type === "segment"],
  ["antony segment id NB", antonyScope.segmentId === SEG_NEW_BUSINESS_ID],
  [
    "vipin sees all teams",
    ORG_TEAM_IDS.every((id) => vipinScope.teamIds.includes(id)),
  ],
  [
    "antony sees NB teams only",
    antonyScope.teamIds.length === 2 &&
      antonyScope.teamIds.includes(TEAM_AJAY_ID) &&
      antonyScope.teamIds.includes(TEAM_NIKIL_ID),
  ],
  [
    "team mgr scope type team",
    teamMgrScope.type === "team" && teamMgrScope.teamIds[0] === TEAM_AJAY_ID,
  ],
  ["se scope own", seScope.type === "own"],
  ["vipin session isOrgDirector", vipinSession.isOrgDirector === true],
  ["antony session isOrgDirector", antonySession.isOrgDirector === true],
  ["antony session isSegmentLeader", antonySession.isSegmentLeader === true],
  ["vipin session orgId", vipinSession.orgId === DEMO_ORG_ID],
  ["vipin sees ajay team se", vipinVisibleEmails.includes("saketh.poruri@freshworks.com")],
  ["vipin sees nikil team se", vipinVisibleEmails.includes("vivehanandan.agoram@freshworks.com")],
  ["vipin sees digital team se", vipinVisibleEmails.includes("avinash.kumar@freshworks.com")],
  [
    "antony sees NB team se",
    antonyVisibleEmails.includes("saketh.poruri@freshworks.com") &&
      antonyVisibleEmails.includes("vivehanandan.agoram@freshworks.com"),
  ],
  ["antony does not see digital se", !antonyVisibleEmails.includes("avinash.kumar@freshworks.com")],
  [
    "team mgr cannot read digital team artifact",
    !can(teamMgrEnriched, "read", {
      ownerId: seDigitalId,
      teamId: TEAM_AKSHITA_ID,
      orgId: DEMO_ORG_ID,
    }),
  ],
  [
    "antony can read digital team artifact",
    can(antonyEnriched, "read", {
      ownerId: seDigitalId,
      teamId: TEAM_AKSHITA_ID,
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
    "team mgr cannot read nikil team se",
    !can(teamMgrEnriched, "read", {
      ownerId: stableUserIdForEmail("vivehanandan.agoram@freshworks.com"),
      teamId: TEAM_NIKIL_ID,
      orgId: DEMO_ORG_ID,
    }),
  ],
  ["hierarchy no cycle", validateHierarchy(seAjay, usersById) && validateHierarchy(teamMgr, usersById)],
  ["digital ICs report to preethi", seDigital.managerId === stableUserIdForEmail("preethi.sri@freshworks.com")],
  ["se reports to team mgr", seAjay.managerId === teamMgrId],
  ["preethi sees digital team se", preethiVisibleEmails.includes("avinash.kumar@freshworks.com")],
  ["preethi proxy dropdown populated", preethiSeOptions.length === 8],
  ["preethi can act for digital se", preethiCanActDigital],
  ["vipin can act for digital se", vipinCanActDigital],
  ["team mgr can act for own team se", ajayCanActOwnSe],
  ["preethi cannot act for ajay team se", preethiCannotActAjaySe],
  [
    "digital team manager is segment leader",
    digitalTeam?.managerId === stableUserIdForEmail("preethi.sri@freshworks.com"),
  ],
  [
    "listVisibleSeEmails works with email only session",
    (await listVisibleSeEmails({ email: "preethi.sri@freshworks.com", role: "manager" })).length === 8,
  ],
  ["team mgr reports to antony", teamMgr.managerId === antonyId],
  ["antony reports to vipin", antony.managerId === vipinId],
  ["vipin has job title", vipin.jobTitle?.includes("Senior Director")],
  [
    "resolve line manager",
    seLineMgr?.via === "line_manager" && seLineMgr.email === teamMgr.email,
  ],
  [
    "resolve team manager fallback",
    teamMgrRecipient?.via === "team_manager" && teamMgrRecipient.email === teamMgr.email,
  ],
  [
    "resolve segment leader fallback",
    segLeaderRecipient?.via === "segment_leader" && segLeaderRecipient.email === antony.email,
  ],
  [
    "resolve director fallback",
    directorRecipient?.via === "director" && directorRecipient.email === vipin.email,
  ],
  ["resolve returns null when unresolved", nullRecipient === null],
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
