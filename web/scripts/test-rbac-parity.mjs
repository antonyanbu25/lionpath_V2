#!/usr/bin/env node
/** RBAC parity — shared persona fixture vs web/domain/types.js#can(). */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
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
assert.equal(
  can(personas.mgrSameTeam, "update", { ownerId: "u1", teamId: TEAM_A, seTeamUserIds: ["u1"] }),
  false,
  "manager proxy update rejected",
);

// Firestore rules parity: per-owner resources (lifecycles, prepBriefs, postCalls,
// deals, etc.) require ownerId == auth uid via canWriteOwnResource/canCreateTeamResource.
const rulesPath = join(dirname(fileURLToPath(import.meta.url)), "../../firestore.rules");
const rules = await readFile(rulesPath, "utf8");
assert.match(rules, /function canWriteOwnResource\(ownerId\)/, "rules define canWriteOwnResource");
assert.match(
  rules,
  /allow create: if canCreateTeamResource\(request\.resource\.data\.ownerId,/,
  "rules reject proxy create on team-scoped resources (ownerId must match auth)",
);

// Accounts are a deliberate exception (introduced with org hierarchy in 2.1.29,
// commit 68383ec): they're shared/collaborative entities per docs/DOMAIN_MODEL.md
// ("one account can have multiple lifecycles (different SE owners)"), not
// single-owner resources — any org-scoped admin/manager/SE may create one.
// This assertion used to check accounts required ownerId == auth like the
// per-owner collections above; that stopped being true intentionally, not by
// regression, so this documents the current contract instead of the old one.
assert.match(rules, /function canCreateAccount\(\)/, "rules define canCreateAccount");
assert.doesNotMatch(
  rules,
  /match \/accounts\/\{accountId\} \{\s*allow read:[^}]*allow create: if canWriteOwnResource/,
  "accounts create is intentionally not ownerId-gated — if this ever changes, update the comment above too",
);

console.log("test-rbac-parity.mjs: ok");
