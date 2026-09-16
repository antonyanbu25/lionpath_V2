#!/usr/bin/env node
/**
 * Domain-reads authorization helpers (unit-level).
 */
import assert from "node:assert/strict";
import { filterAccountsForReader } from "../src/routes/domain-reads.ts";
import { canReadResource } from "../src/data/scope.ts";

let passed = 0;
function case_(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("Domain-reads auth checks\n");

const seCtx = {
  email: "se@freshworks.com",
  userId: "usr_se",
  role: "se",
  teamId: "team_a",
  orgId: "org_1",
  isOrgLeader: false,
};

const otherSeCtx = {
  ...seCtx,
  email: "other@freshworks.com",
  userId: "usr_other",
};

const adminCtx = {
  email: "admin@freshworks.com",
  userId: "usr_admin",
  role: "admin",
  teamId: "team_a",
  orgId: "org_1",
  isOrgLeader: false,
};

case_("SE sees only own account rows", () => {
  const rows = [
    { id: "a1", ownerId: "usr_se", teamId: "team_a", orgId: "org_1" },
    { id: "a2", ownerId: "usr_other", teamId: "team_a", orgId: "org_1" },
  ];
  const filtered = filterAccountsForReader(seCtx, rows);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "a1");
});

case_("admin sees all account rows", () => {
  const rows = [
    { id: "a1", ownerId: "usr_se", teamId: "team_a", orgId: "org_1" },
    { id: "a2", ownerId: "usr_other", teamId: "team_b", orgId: "org_2" },
  ];
  const filtered = filterAccountsForReader(adminCtx, rows);
  assert.equal(filtered.length, 2);
});

case_("canReadResource blocks cross-owner", () => {
  const resource = { ownerId: "usr_se", teamId: "team_a", orgId: "org_1" };
  assert.equal(canReadResource(seCtx, resource), true);
  assert.equal(canReadResource(otherSeCtx, resource), false);
});

console.log(`\n${passed} cases passed — test-domain-reads-auth: ok`);
