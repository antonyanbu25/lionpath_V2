/**
 * Shared account / contact / deal resolution for prep and post-call dual-write.
 * Both flows must produce the same global CRM entities for the same inputs.
 */

import {
  upsertAccountFromPrep,
  findAccountByCompanyName,
  findAccountByContactEmails,
  ensureSeTeamForPrepActor,
} from "./account-service.js?v=2.1";
import { createDealWithExplicitTitle } from "./deal-service.js";
import { getAccountEngagementContext } from "./account-context.js";
import { resolveActingWriteContext, actingAuditFields } from "./acting-owner.js";
import { getStore } from "./store.js";

/**
 * Participant emails — confirmed customer identities first, then typed lists.
 * Order is load-bearing: `upsertAccountFromPrep` makes the first email the primary contact.
 *
 * @param {object} payload prep or post-call save payload
 * @returns {string[]} lower-cased, deduped
 */
export function collectParticipantEmails(payload) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  const add = (raw) => {
    const email = String(raw || "").trim().toLowerCase();
    if (!email.includes("@") || seen.has(email)) return;
    seen.add(email);
    out.push(email);
  };
  for (const label of payload?.confirmedIdentities?.customerIdentities || []) {
    const match = String(label || "").match(/[^\s<>,;"']+@[^\s<>,;"']+/);
    if (match) add(match[0]);
  }
  for (const email of payload?.prospectEmails || []) add(email);
  for (const email of payload?.participantEmails || []) add(email);
  if (payload?.prospectEmail) add(payload.prospectEmail);
  return out;
}

/**
 * Parse display names from post-call confirm identities (`Name <email>` labels).
 * @param {object} payload
 * @returns {{ email: string, name?: string|null }[]}
 */
export function collectContactDraftsFromPayload(payload) {
  /** @type {Map<string, { email: string, name?: string|null }>} */
  const byEmail = new Map();
  const add = (email, name) => {
    const e = String(email || "").trim().toLowerCase();
    if (!e.includes("@")) return;
    const n = String(name || "").trim();
    const prev = byEmail.get(e);
    if (!prev) {
      byEmail.set(e, { email: e, name: n || null });
      return;
    }
    if (n && !prev.name) prev.name = n;
  };
  for (const label of payload?.confirmedIdentities?.customerIdentities || []) {
    const s = String(label || "").trim();
    const named = s.match(/^(.+?)\s*<([^>@]+@[^>]+)>$/);
    if (named) add(named[2], named[1]);
    else {
      const em = s.match(/[^\s<>,;"']+@[^\s<>,;"']+/);
      if (em) add(em[0], null);
    }
  }
  return [...byEmail.values()];
}

/**
 * Resolve account, contacts, and deal routing for an engagement write.
 *
 * Account resolution order: explicit id → contact email (global) → slug/domain/name → create.
 * Contacts are upserted via `upsertAccountFromPrep` / `resolveContactOnAccount`.
 * Deal id comes from payload/meta/record, engagement session context, or "+ New deal".
 *
 * @param {object} session
 * @param {object} payload prep or post-call form payload
 * @param {object} [opts]
 * @param {object} [opts.meta] prep meta (`accountId`, `dealId`, `domain`)
 * @param {object} [opts.record] post-call history record (`dealId`)
 * @param {string} [opts.company] resolved company name (post-call may derive from analysis)
 * @param {object} [opts.prep] generated prep JSON (prep path only)
 * @param {object} [opts.researchBundle]
 * @param {object[]} [opts.contactDrafts]
 * @returns {Promise<object|null>}
 */
export async function resolveEngagementEntities(session, payload, opts = {}) {
  const { ownerId, teamId, orgId } = await resolveActingWriteContext(session, payload?.proxySeUserId);
  if (!ownerId || !teamId) return null;

  const meta = opts.meta || {};
  const company = String(payload?.companyName || opts.company || meta?.company || "").trim();
  const companyDomain =
    payload?.companyDomain || meta?.companyDomain || meta?.domain || null;
  const participantEmails = collectParticipantEmails(payload);
  const store = getStore();

  const payloadDrafts = collectContactDraftsFromPayload(payload);
  /** @type {Map<string, object>} */
  const draftByEmail = new Map();
  for (const d of [...(opts.contactDrafts || []), ...payloadDrafts]) {
    const e = String(d?.email || "").trim().toLowerCase();
    if (!e.includes("@")) continue;
    const prev = draftByEmail.get(e);
    if (!prev) draftByEmail.set(e, { ...d, email: e });
    else if (d?.name && !prev.name) prev.name = d.name;
  }
  const contactDrafts = [...draftByEmail.values()];

  /** @type {object|null} */
  let knownAccount = null;
  const explicitAccountId = payload?.createNewAccount
    ? null
    : payload?.accountId || meta?.accountId || null;

  if (!payload?.createNewAccount && explicitAccountId) {
    try {
      knownAccount = await store.getAccount(explicitAccountId);
    } catch (err) {
      console.warn(
        "[engagement-entities] getAccount skipped:",
        explicitAccountId,
        err?.message || err,
      );
      knownAccount = null;
    }
  }
  if (!knownAccount && !payload?.createNewAccount && participantEmails.length) {
    knownAccount = await findAccountByContactEmails(participantEmails, {
      actorId: ownerId,
      domain: companyDomain,
    });
  }
  if (!knownAccount && !payload?.createNewAccount && company) {
    knownAccount = await findAccountByCompanyName(company, companyDomain);
  }

  const upserted = await upsertAccountFromPrep({
    accountId: payload?.createNewAccount
      ? null
      : explicitAccountId || knownAccount?.id || null,
    createNewAccount: payload?.createNewAccount === true,
    companyName: knownAccount?.name || company || "Unknown account",
    companyDomain: companyDomain || knownAccount?.domain || null,
    prospectEmail: payload?.prospectEmail,
    prospectEmails: participantEmails,
    domain: meta?.domain || meta?.companyDomain,
    prep: opts.prep,
    researchBundle: opts.researchBundle,
    contactDrafts,
    actorId: ownerId,
    // Pass the resolved write scope through so a newly created account carries
    // orgId/team scope from birth — see the create branch in
    // account-service.js#upsertAccountFromPrep. Previously omitted, so
    // prep/post-call-created accounts had orgId: null forever (nothing else
    // backfills it — buildAccountScopeDenorm only propagates account.orgId).
    orgId,
    teamId,
  });

  const { accountId, contactIds, primaryContactId, account } = upserted;

  await ensureSeTeamForPrepActor(accountId, ownerId);

  const engagementCtx = getAccountEngagementContext();
  const ctxMatchesAccount = engagementCtx.accountId === accountId;
  const prepType = payload?.prepType || (ctxMatchesAccount ? engagementCtx.prepType : undefined);

  let dealId =
    payload?.dealId ||
    meta?.dealId ||
    opts.record?.dealId ||
    (ctxMatchesAccount && !payload?.createNewDeal ? engagementCtx.dealId : null) ||
    null;

  if (payload?.createNewDeal === true) {
    const newDeal = await createDealWithExplicitTitle(
      accountId,
      ownerId,
      teamId,
      orgId || account?.orgId || null,
      {
        title: payload.newDealTitle,
        type: payload.newDealType || prepType,
        accountName: account?.name || company,
        primaryContactId,
      },
    );
    dealId = newDeal.id;
  }

  return {
    ownerId,
    teamId,
    orgId: orgId || account?.orgId || null,
    audit: actingAuditFields(session, payload?.proxySeUserId),
    account,
    accountId,
    contactIds,
    primaryContactId,
    participantEmails,
    company,
    companyDomain,
    prepType,
    dealId,
    createNewDeal: payload?.createNewDeal === true,
  };
}
