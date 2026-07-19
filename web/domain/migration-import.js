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

  return data.summary || {};
}
