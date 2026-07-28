/**
 * Import migration-output.json into the local domain store (dummy mode / dev).
 * @param {object} data output from worker/scripts/migrate-to-lifecycle.mjs
 */
export async function importMigrationData(data) {
  const { getStore } = await import("./store.js");
  const store = getStore();

  for (const account of data.accounts || []) {
    const existing = await store.findAccountBySlug(account.slug);
    if (!existing) await store.createAccount(account);
  }

  for (const lifecycle of data.lifecycles || []) {
    const existing = await store.findActiveLifecycle(lifecycle.ownerId, lifecycle.accountId);
    if (!existing) await store.createLifecycle(lifecycle);
  }

  for (const prep of data.prepBriefs || []) {
    const existing = (await store.listPrepBriefsByLifecycle(prep.lifecycleId))
      .find((p) => p.id === prep.id);
    if (!existing) await store.createPrepBrief(prep);
  }

  for (const postCall of data.postCalls || []) {
    const existing = await store.findPostCallByIdentity(postCall.ownerId, postCall.callIdentityKey);
    if (!existing) await store.upsertPostCall(postCall);
  }

  for (const event of data.events || []) {
    await store.addLifecycleEvent(event);
  }

  const { migrateMeddpiccAccountToDeals } = await import("./migrate-meddpicc-to-deals.js");
  await migrateMeddpiccAccountToDeals(store);

  return data.summary || {};
}

/** After deal import, copy legacy account MEDDPICC onto NB deals (ADR 005). */
export async function importDealsMigrationData(data) {
  const summary = await importDealsMigrationDataInner(data);
  const { migrateMeddpiccAccountToDeals } = await import("./migrate-meddpicc-to-deals.js");
  const { getStore } = await import("./store.js");
  await migrateMeddpiccAccountToDeals(getStore());
  return summary;
}

async function importDealsMigrationDataInner(data) {
  const { getStore } = await import("./store.js");
  const store = getStore();

  for (const deal of data.deals || []) {
    if (!store.createDeal) continue;
    const existing = await store.getDeal(deal.id);
    if (!existing) await store.createDeal(deal);
  }

  for (const lc of data.lifecycles || []) {
    if (store.updateLifecycle) {
      await store.updateLifecycle(lc.id, { dealId: lc.dealId });
    }
  }

  for (const prep of data.prepBriefs || []) {
    if (prep.dealId) await store.createPrepBrief(prep);
  }

  for (const postCall of data.postCalls || []) {
    if (postCall.dealId) await store.upsertPostCall(postCall);
  }

  for (const task of data.tasks || []) {
    if (task.dealId && store.createTask) await store.createTask(task);
  }

  return data.summary || {};
}
