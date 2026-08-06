/**
 * Build Pass 0 matching context from the domain store for /api/postcall/resolve.
 */

import { getStore } from "./domain/store.js";
import { loadLocalBriefs } from "./precall.js?v=2.1.14";
import { domainFromEmail } from "./domain/types.js";
import { listDealsForAccount } from "./domain/deal-service.js";
import { safeStoreOp } from "./domain/safe-store.js";

const CONTEXT_TTL_MS = 60_000;
const contextCache = new Map(); // ownerId -> { at: number, value: object }

/** Clear when a new account/deal may have been created mid-session. */
export function invalidatePostCallResolveContext(ownerId) {
  if (ownerId) contextCache.delete(ownerId);
  else contextCache.clear();
}

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

function dealSnapshot(deal) {
  return {
    id: deal.id,
    accountId: deal.accountId,
    title: deal.title,
    type: deal.type,
    stage: deal.stage,
    status: deal.status,
    ownerId: deal.ownerId,
  };
}

function isFirestorePermissionError(err) {
  const code = String(err?.code || "");
  const msg = String(err?.message || err || "");
  return code === "permission-denied" || /missing or insufficient permissions/i.test(msg);
}

/** Account membership — supports seTeamUserIds (Firestore) and seTeam[].seUserId (local). */
function accountOnSeTeam(account, ownerId) {
  if (!account || !ownerId) return false;
  if (Array.isArray(account.seTeamUserIds) && account.seTeamUserIds.includes(ownerId)) return true;
  return (account.seTeam || []).some((m) => m.seUserId === ownerId);
}

/**
 * @param {string} ownerId
 * @returns {Promise<{ ownerId: string, briefs: object[], accounts: object[], deals: object[] }>}
 */
export async function buildPostCallResolveContext(ownerId, opts = {}) {
  const empty = { ownerId, briefs: [], accounts: [], deals: [] };
  if (!ownerId) return empty;
  const dealOpts = opts.teamId ? { teamId: opts.teamId } : {};

  const cached = contextCache.get(ownerId);
  if (cached && Date.now() - cached.at < CONTEXT_TTL_MS) {
    return cached.value;
  }

  try {
    const store = getStore();
    const briefs = [];
    const accountIds = new Set();
    const accountsById = new Map();

    if (store.listLifecyclesByOwner) {
      const lifecycles = await safeStoreOp(
        "listLifecyclesByOwner",
        () => store.listLifecyclesByOwner(ownerId, 300),
        [],
      );
      for (const lc of lifecycles) {
        if (lc.accountId) accountIds.add(lc.accountId);
      }
      if (store.listPrepBriefsByLifecycle) {
        const prepArrays = await Promise.all(
          lifecycles.map((lc) =>
            safeStoreOp(
              "listPrepBriefsByLifecycle",
              () => store.listPrepBriefsByLifecycle(lc.id, ownerId),
              [],
            ),
          ),
        );
        for (const preps of prepArrays) {
          for (const prep of preps) {
            const snap = briefSnapshotFromDoc(prep);
            if (snap) briefs.push(snap);
          }
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

    // Accounts where this SE is on the deal team — cross-SE visibility on shared accounts.
    if (store.listAccounts) {
      const allAccounts = await safeStoreOp("listAccounts", () => store.listAccounts(), []);
      for (const account of allAccounts) {
        if (accountOnSeTeam(account, ownerId)) {
          accountIds.add(account.id);
        }
      }
    }

    const accountResults = await Promise.all(
      [...accountIds].map(async (accountId) => {
        const account = store.getAccount
          ? await safeStoreOp("getAccount", () => store.getAccount(accountId), null)
          : null;
        if (!account) return null;
        return {
          id: account.id,
          name: account.name,
          domain: account.domain || null,
          slug: account.slug,
        };
      }),
    );
    for (const account of accountResults) {
      if (account) accountsById.set(account.id, account);
    }

    // Global deals per account — every SE's opportunity on the account, not just ownerId's.
    const deals = [];
    const seenDealIds = new Set();
    for (const accountId of accountIds) {
      const accountDeals = await safeStoreOp(
        "listDealsForAccount",
        () => listDealsForAccount(accountId, dealOpts),
        [],
      );
      for (const deal of accountDeals) {
        if (seenDealIds.has(deal.id)) continue;
        seenDealIds.add(deal.id);
        deals.push(dealSnapshot(deal));
      }
    }

    const result = {
      ownerId,
      briefs,
      accounts: [...accountsById.values()],
      deals,
    };
    contextCache.set(ownerId, { at: Date.now(), value: result });
    return result;
  } catch (err) {
    contextCache.delete(ownerId);
    if (isFirestorePermissionError(err)) {
      console.warn(
        "[postcall] Firestore resolve context denied. continuing without domain match:",
        err?.message || err,
      );
    } else {
      console.warn("[postcall] resolve context build failed; continuing without CRM context:", err?.message || err);
    }
    return empty;
  }
}

/**
 * Merge all account-scoped deals into a resolve result (Pass 0 worker output).
 * Ensures confirm-gate deal picker shows Saketh's deal when Nivedha runs the call.
 * @param {object|null|undefined} resolve
 * @param {string|null|undefined} accountId
 */
export async function enrichResolveDealsForAccount(resolve, accountId, opts = {}) {
  if (!resolve || !accountId) return resolve;
  // Team-scoped only — confirm gate needs every deal on the account, not just ownerId's.
  const dealOpts = opts.teamId ? { teamId: opts.teamId } : {};
  const globalDeals = await safeStoreOp(
    "listDealsForAccount",
    () => listDealsForAccount(accountId, dealOpts),
    [],
  );
  if (!globalDeals.length) return resolve;

  const byId = new Map();
  for (const d of resolve.deals || []) {
    const id = d.dealId || d.id;
    if (id) byId.set(id, d);
  }
  for (const deal of globalDeals) {
    if (byId.has(deal.id)) continue;
    byId.set(deal.id, {
      dealId: deal.id,
      accountId: deal.accountId,
      title: deal.title,
      type: deal.type,
      stage: deal.stage,
      score: 1,
      reasons: [
        {
          rank: 2,
          signal: "same_account",
          detail: "Opportunity on this account (shared deal list)",
        },
      ],
      preselected: false,
    });
  }

  const merged = [...byId.values()].sort(
    (a, b) => (b.score || 0) - (a.score || 0) || String(a.title).localeCompare(String(b.title)),
  );
  const priorPre = (resolve.deals || []).find((d) => d.preselected);
  if (priorPre?.dealId && byId.has(priorPre.dealId)) {
    for (const d of merged) d.preselected = d.dealId === priorPre.dealId;
  } else if (merged.length && !merged.some((d) => d.preselected)) {
    merged[0].preselected = true;
  }

  return { ...resolve, deals: merged };
}
