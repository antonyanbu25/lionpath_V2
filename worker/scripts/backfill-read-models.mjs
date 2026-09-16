#!/usr/bin/env node
/**
 * Backfill read-model collections (teamMetrics + managerView, orgMetrics + managerView, dealTraction, accountRollup with full ARR, seLaunchpad).
 *
 * Usage:
 *   npx tsx worker/scripts/backfill-read-models.mjs
 *   npx tsx worker/scripts/backfill-read-models.mjs --account=acct_xxx
 */

import { loadEnv, requireFirebaseProjectId } from "./lib/load-env.mjs";

await loadEnv();
requireFirebaseProjectId();

const accountFilter = process.argv.find((a) => a.startsWith("--account="))?.split("=")[1];
const ts = Date.now();

const { queryBy } = await import("../src/data/firestore-admin.ts");
const {
  rebuildAccountRollup,
  rebuildDealTraction,
  rebuildOrgMetrics,
  rebuildSeLaunchpad,
  rebuildTeamMetrics,
} = await import("../src/data/read-models/index.ts");

async function backfillAccounts() {
  const accounts = accountFilter
    ? [{ id: accountFilter }]
    : await queryBy("accounts", [], undefined, undefined);
  for (const account of accounts) {
    const accountId = String(account.id);
    console.log("[backfill] accountRollup", accountId);
    await rebuildAccountRollup(accountId, ts);
    const deals = await queryBy("deals", [{ field: "accountId", op: "==", value: accountId }]);
    for (const deal of deals) {
      await rebuildDealTraction(String(deal.id), ts);
    }
  }
}

async function backfillTeams() {
  const teams = await queryBy("teams", [], undefined, undefined);
  for (const team of teams) {
    console.log("[backfill] teamMetrics", team.id);
    await rebuildTeamMetrics(String(team.id), ts);
  }
}

async function backfillOrgs() {
  const orgs = await queryBy("orgs", [], undefined, undefined);
  for (const org of orgs) {
    console.log("[backfill] orgMetrics", org.id);
    await rebuildOrgMetrics(String(org.id), ts);
  }
}

async function backfillLaunchpads() {
  const users = await queryBy("users", [], undefined, undefined);
  for (const user of users) {
    await rebuildSeLaunchpad(String(user.id), ts);
  }
}

await backfillAccounts();
await backfillTeams();
await backfillOrgs();
await backfillLaunchpads();
console.log("Read-model backfill complete.");
