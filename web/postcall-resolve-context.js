/**
 * Build Pass 0 matching context from the domain store for /api/postcall/resolve.
 */

import { getStore } from "./domain/store.js";
import { loadLocalBriefs } from "./precall.js";
import { domainFromEmail } from "./domain/types.js";

function prospectEmailsFromBrief(brief) {
  const emails = [];
  const add = (e) => {
    const v = String(e || "").trim().toLowerCase();
    if (v && !emails.includes(v)) emails.push(v);
  };
  for (const e of brief.input?.prospectEmails || []) add(e);
  add(brief.input?.prospectEmail);
  for (const e of brief.meta?.prospectEmails || []) add(e);
  return emails;
}

function briefSnapshotFromDoc(brief) {
  if (!brief?.accountId) return null;
  return {
    id: brief.id,
    accountId: brief.accountId,
    dealId: brief.dealId || null,
    ownerId: brief.ownerId,
    createdAt: brief.createdAt || Date.now(),
    companyName: brief.meta?.company || brief.input?.companyName || "",
    domain: brief.meta?.domain || brief.meta?.companyDomain || brief.input?.companyDomain || null,
    prospectEmails: prospectEmailsFromBrief(brief),
  };
}

function briefSnapshotFromLocal(record) {
  const input = record.input || {};
  const meta = record.meta || {};
  return {
    id: record.id,
    accountId: meta.accountId || record.accountId || null,
    dealId: meta.dealId || record.dealId || null,
    ownerId: meta.ownerId || record.ownerId || null,
    createdAt: record.createdAt || Date.now(),
    companyName: record.company || meta.company || input.companyName || "",
    domain: meta.domain || meta.companyDomain || input.companyDomain || domainFromEmail(input.prospectEmail),
    prospectEmails: prospectEmailsFromBrief({ input, meta }),
  };
}

function isFirestorePermissionError(err) {
  const code = String(err?.code || "");
  const msg = String(err?.message || err || "");
  return code === "permission-denied" || /missing or insufficient permissions/i.test(msg);
}

/**
 * @param {string} ownerId
 * @returns {Promise<{ ownerId: string, briefs: object[], accounts: object[], deals: object[] }>}
 */
export async function buildPostCallResolveContext(ownerId) {
  const empty = { ownerId, briefs: [], accounts: [], deals: [] };
  if (!ownerId) return empty;

  try {
    const store = getStore();
    const briefs = [];
    const accountIds = new Set();
    const accountsById = new Map();

    if (store.listLifecyclesByOwner) {
      const lifecycles = await store.listLifecyclesByOwner(ownerId, 300);
      for (const lc of lifecycles) {
        if (lc.accountId) accountIds.add(lc.accountId);
        if (!store.listPrepBriefsByLifecycle) continue;
        const preps = await store.listPrepBriefsByLifecycle(lc.id, ownerId);
        for (const prep of preps) {
          const snap = briefSnapshotFromDoc(prep);
          if (snap) briefs.push(snap);
        }
      }
    }

    for (const local of loadLocalBriefs()) {
      const snap = briefSnapshotFromLocal(local);
      if (snap.accountId) {
        briefs.push(snap);
        accountIds.add(snap.accountId);
      }
    }

    for (const accountId of accountIds) {
      const account = store.getAccount ? await store.getAccount(accountId) : null;
      if (account) {
        accountsById.set(account.id, {
          id: account.id,
          name: account.name,
          domain: account.domain || null,
          slug: account.slug,
        });
      }
    }

    const deals = [];
    const accountIdSet = accountIds;
    if (store.listDealsByOwner) {
      const ownedDeals = await store.listDealsByOwner(ownerId, 500);
      for (const deal of ownedDeals) {
        if (!accountIdSet.has(deal.accountId)) continue;
        deals.push({
          id: deal.id,
          accountId: deal.accountId,
          title: deal.title,
          type: deal.type,
          stage: deal.stage,
          status: deal.status,
          ownerId: deal.ownerId,
        });
      }
    }

    return {
      ownerId,
      briefs,
      accounts: [...accountsById.values()],
      deals,
    };
  } catch (err) {
    if (isFirestorePermissionError(err)) {
      console.warn(
        "[postcall] Firestore resolve context denied — continuing without domain match:",
        err?.message || err,
      );
      return empty;
    }
    throw err;
  }
}
