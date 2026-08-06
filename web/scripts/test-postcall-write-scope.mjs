#!/usr/bin/env node
/**
 * Post-call dual-write scope — account/contact create stamps orgId + seTeam for Firestore rules.
 * Run: node web/scripts/test-postcall-write-scope.mjs
 */

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
};

import { initDomainStore, getStore } from "../domain/store.js";
import { upsertAccountFromPrep } from "../domain/account-service.js";
import { linkPostCallToLifecycle } from "../domain/dual-write.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  initDomainStore(null);
  const store = getStore();
  if (store.clearAll) store.clearAll();

  const ownerId = "usr_scope_se";
  const teamId = "team_scope";
  const orgId = "org_scope";
  const session = { userId: ownerId, teamId, orgId, email: "scope.se@freshworks.com" };

  const upserted = await upsertAccountFromPrep({
    companyName: "Vivid Pix",
    companyDomain: "vividpix.com",
    createNewAccount: true,
    prospectEmails: ["buyer@vividpix.com"],
    actorId: ownerId,
    orgId,
    teamId,
  });

  assert(upserted.account?.orgId === orgId, "account create stamps orgId");
  assert(
    upserted.account?.seTeamUserIds?.includes(ownerId),
    "account create stamps seTeamUserIds with actor",
  );

  const record = { id: "postcall_scope_test", title: "Vivid Pix - Discovery" };
  const linked = await linkPostCallToLifecycle(
    session,
    {
      companyName: "Vivid Pix",
      createNewAccount: true,
      createNewDeal: true,
      newDealTitle: "Vivid Pix New Biz",
      newDealType: "new_business",
      prospectEmails: ["buyer@vividpix.com"],
    },
    { analysis: { callHeader: { company: "Vivid Pix" } } },
    record,
  );

  assert(linked?.accountId, "linkPostCallToLifecycle created spine");
  const deal = linked?.lifecycle?.dealId ? await store.getDeal(linked.lifecycle.dealId) : null;
  assert(deal?.ownerId === ownerId, "deal ownerId from resolveWriteScope");
  assert(deal?.teamId === teamId, "deal teamId from session");
  assert(deal?.orgId === orgId, "deal orgId from session");

  console.log("test-postcall-write-scope: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
