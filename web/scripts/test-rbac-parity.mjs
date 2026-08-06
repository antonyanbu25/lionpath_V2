#!/usr/bin/env node
/** RBAC parity — shared persona fixture vs web/domain/types.js#can(). */

import assert from "node:assert/strict";
import { can } from "../domain/types.js";

const ORG = "org_1";
const TEAM_A = "team_a";
const TEAM_B = "team_b";

const personas = {
  seOwner: { id: "u1", role: "se", teamId: TEAM_A, orgId: ORG },
  seSameTeam: { id: "u2", role: "se", teamId: TEAM_A, orgId: ORG },
  seOtherTeam: { id: "u3", role: "se", teamId: TEAM_B, orgId: ORG },
  mgrSameTeam: { id: "m1", role: "manager", teamId: TEAM_A, orgId: ORG, isOrgDirector: false },
  mgrOtherTeam: { id: "m2", role: "manager", teamId: TEAM_B, orgId: ORG, isOrgDirector: false },
  orgLeader: { id: "d1", role: "manager", teamId: TEAM_A, orgId: ORG, isOrgDirector: true },
  admin: { id: "a1", role: "admin", teamId: null, orgId: ORG },
};

const accountResource = {
  ownerId: "u1",
  teamId: TEAM_A,
  orgId: ORG,
  seTeamUserIds: ["u1", "u2"],
  seTeamTeamIds: [TEAM_A],
  accountOrgId: ORG,
};

/** Expected read_account parity with firestore.rules canReadAccount semantics. */
const expectedReadAccount = {
  seOwner: true,
  seSameTeam: true,
  seOtherTeam: false,
  mgrSameTeam: true,
  mgrOtherTeam: false,
  orgLeader: true,
  admin: true,
};

for (const [name, user] of Object.entries(personas)) {
  const got = can(user, "read_account", accountResource);
  const want = expectedReadAccount[name];
  assert.equal(got, want, `read_account ${name}: got ${got}, want ${want}`);
}

// Proxy descope (Stage 2 Option A): manager cannot create on behalf of another owner.
assert.equal(
  can(personas.mgrSameTeam, "create", { ownerId: "u1", teamId: TEAM_A, seTeamUserIds: ["u1"] }),
  false,
  "manager proxy create rejected",
);

console.log("test-rbac-parity.mjs: ok");
