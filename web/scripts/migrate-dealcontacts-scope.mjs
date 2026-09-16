#!/usr/bin/env node
/**
 * Backfill ownerId/teamId/orgId on dealContacts from parent deals.
 * Usage: node web/scripts/migrate-dealcontacts-scope.mjs [--apply]
 * Default: dry-run.
 */

const APPLY = process.argv.includes("--apply");

async function main() {
  const { initDomainStore, getStore } = await import("../domain/store.js");
  initDomainStore(null);
  const store = getStore();
  if (!store.listAllDealContacts && !store.listContactsByDeal) {
    console.log("migrate-dealcontacts-scope: store has no list API — skip (local dev)");
    return;
  }

  /** @type {import("../domain/types.js").DealContact[]} */
  let links = [];
  if (store.listAllDealContacts) {
    links = await store.listAllDealContacts();
  } else {
    console.log("dry-run: enumerate deals manually in production via admin SDK");
    return;
  }

  let patched = 0;
  for (const link of links) {
    if (link.ownerId && link.teamId && link.orgId) continue;
    const deal = await store.getDeal(link.dealId);
    if (!deal) {
      console.warn("skip: deal missing for", link.id);
      continue;
    }
    const patch = {
      ownerId: deal.ownerId,
      teamId: deal.teamId,
      orgId: deal.orgId,
    };
    console.log(APPLY ? "apply" : "would patch", link.id, patch);
    if (APPLY && store.updateDealContact) {
      await store.updateDealContact(link.id, patch);
    }
    patched += 1;
  }
  console.log(`migrate-dealcontacts-scope: ${APPLY ? "patched" : "would patch"} ${patched} rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
