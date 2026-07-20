/**
 * Deal team + multi-lifecycle assignment tests (no browser).
 */
import { initDomainStore, getStore } from "../domain/store.js";
import {
  listAccountsForSession,
  getAccountEngagementDetail,
  updateAccountSeTeam,
  backfillAccountSeTeam,
} from "../domain/account-service.js";
import { listActiveLifecyclesForAccount } from "../domain/lifecycle-service.js";
import { MAX_SE_TEAM_SIZE } from "../domain/types.js";
import { DUMMY_USERS } from "../dummy-users.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const storeData = new Map();
globalThis.localStorage = {
  getItem: (k) => storeData.get(k) ?? null,
  setItem: (k, v) => storeData.set(k, v),
  removeItem: (k) => storeData.delete(k),
};

initDomainStore(null);
const store = getStore();

const teamId = "team_test";
const orgId = "org_test";
const seA = "usr_se_a";
const seB = "usr_se_b";
const mgr = "usr_mgr";
const accountId = "account_multi";

const ts = Date.now();

async function seedUser(id, email, role, extra = {}) {
  await store.upsertUser({
    id,
    email,
    authUid: null,
    displayName: email.split("@")[0],
    role,
    teamId,
    orgId,
    managerId: role === "se" ? mgr : null,
    jobTitle: role === "se" ? "Solution Engineer" : "Manager",
    status: "active",
    createdAt: ts,
    updatedAt: ts,
    ...extra,
  });
}

await seedUser(seA, "se-a@freshworks.com", "se");
await seedUser(seB, "se-b@freshworks.com", "se");
await seedUser(mgr, "mgr@freshworks.com", "manager");

await store.createAccount({
  id: accountId,
  name: "Multi SE Corp",
  domain: "multi.example",
  slug: "multi-se-corp",
  createdAt: ts,
  updatedAt: ts,
});

await store.createLifecycle({
  id: "lc_a",
  accountId,
  ownerId: seA,
  teamId,
  orgId,
  stage: "discovery",
  status: "active",
  title: "Multi SE Corp",
  prepCount: 1,
  postCallCount: 0,
  openTaskCount: 0,
  lastActivityAt: ts,
  createdAt: ts,
  updatedAt: ts,
});

const sessionA = { uid: seA, teamId, orgId, email: "se-a@freshworks.com" };
const sessionB = { uid: seB, teamId, orgId, email: "se-b@freshworks.com" };
const sessionMgr = { uid: mgr, teamId, orgId, email: "mgr@freshworks.com" };

const backfilled = await backfillAccountSeTeam(accountId);
assert(backfilled.primarySeUserId === seA, "backfill sets primary from first lifecycle");
assert(backfilled.seTeam?.length === 1, "backfill one member");

const addResult = await updateAccountSeTeam(sessionMgr, accountId, "add_secondary", { seUserId: seB });
assert(addResult.success, "manager adds secondary SE");
assert(addResult.account.seTeam.length === 2, "two SEs on team");

const lcs = await listActiveLifecyclesForAccount(accountId);
assert(lcs.length === 2, "two active lifecycles same account");

const swap = await updateAccountSeTeam(sessionMgr, accountId, "set_primary", { seUserId: seB });
assert(swap.success && swap.account.primarySeUserId === seB, "primary swap to B");

const rowsMgr = await listAccountsForSession(sessionMgr);
assert(rowsMgr.some((r) => r.account.id === accountId), "manager sees report account");

const detail = await getAccountEngagementDetail(sessionA, accountId);
assert(detail?.events?.length >= 0, "detail loads for SE on team");
assert(detail?.seTeamDisplay?.length === 2, "detail shows deal team");

await seedUser("usr_se_c", "se-c@freshworks.com", "se", { managerId: mgr });
const detailMgr = await getAccountEngagementDetail(sessionMgr, accountId);
assert(detailMgr?.canManageTeam, "manager can manage deal team");
assert(Array.isArray(detailMgr.assignableSeOptions), "assignableSeOptions returned");
const assignableIds = detailMgr.assignableSeOptions.map((o) => o.seUserId);
assert(!assignableIds.includes(seA) && !assignableIds.includes(seB), "assignable excludes current team");
assert(assignableIds.includes("usr_se_c"), "assignable includes org/team SE not on roster");

for (let i = 0; i < MAX_SE_TEAM_SIZE - 2; i++) {
  const id = `usr_extra_${i}`;
  await seedUser(id, `extra${i}@freshworks.com`, "se");
  const r = await updateAccountSeTeam(sessionMgr, accountId, "add_secondary", { seUserId: id });
  assert(r.success, `add extra SE ${i}`);
}

await seedUser("usr_overflow", "overflow@freshworks.com", "se");
const capFail = await updateAccountSeTeam(sessionMgr, accountId, "add_secondary", { seUserId: "usr_overflow" });
assert(!capFail.success, "cap at 4 SEs");

const detailFull = await getAccountEngagementDetail(sessionMgr, accountId);
assert(detailFull.assignableSeOptions.length === 0, "no assignable when team at cap");

const sowrav = DUMMY_USERS["sowrav.sunil@freshworks.com"];
assert(sowrav?.role === "admin", "sowrav.sunil@freshworks.com is admin in dummy-users");

console.log("test-account-assignment: ok");
