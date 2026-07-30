/**
 * One-time: copy Account.metadata.meddpicc → active new_business deal (ADR 005).
 */

import { now } from "./types.js";

const MIGRATION_FLAG_KEY = "meddpicc_deal_migration_v1";

/**
 * @param {ReturnType<import("./local-store.js").createLocalStore>} store
 * @returns {Promise<{ migrated: number, skipped: number }>}
 */
export async function migrateMeddpiccAccountToDeals(store) {
  let migrated = 0;
  let skipped = 0;

  const accounts =
    typeof store.listAccounts === "function" ? await store.listAccounts() : [];

  for (const account of accounts) {
    const accountMed = account.metadata?.meddpicc;
    if (!accountMed || account.metadata?.meddpiccMigratedAt) {
      skipped += 1;
      continue;
    }
    if (!store.findActiveDeal) {
      skipped += 1;
      continue;
    }
    const nbDeal = await store.findActiveDeal(account.id, "new_business");
    if (!nbDeal) {
      skipped += 1;
      continue;
    }
    if (nbDeal.metadata?.meddpicc) {
      await store.updateAccount(account.id, {
        metadata: { ...account.metadata, meddpiccMigratedAt: now() },
      });
      skipped += 1;
      continue;
    }

    const metadata = {
      ...(nbDeal.metadata || {}),
      meddpicc: JSON.parse(JSON.stringify(accountMed)),
    };
    await store.updateDeal(nbDeal.id, { metadata });
    await store.updateAccount(account.id, {
      metadata: { ...account.metadata, meddpiccMigratedAt: now() },
    });
    migrated += 1;
  }

  return { migrated, skipped };
}

/** Run once per browser profile (local store). */
export async function runMeddpiccDealMigrationIfNeeded(store) {
  if (typeof localStorage === "undefined") return { ran: false };
  if (localStorage.getItem(MIGRATION_FLAG_KEY) === "done") {
    return { ran: false, reason: "already_done" };
  }
  const result = await migrateMeddpiccAccountToDeals(store);
  localStorage.setItem(MIGRATION_FLAG_KEY, "done");
  return { ran: true, ...result };
}
