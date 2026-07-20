/**
 * Account and Contact upsert from prep form data.
 */

import { getStore } from "./store.js";
import { normalizeAccountSlug, domainFromEmail, newId, now } from "./types.js";
import { listLifecyclesForUser, getLifecycleDetail } from "./lifecycle-service.js";
import { sessionUserId } from "./session.js";
import {
  mergeAccountMeddpicc,
  meddpiccSignalsFromPrep,
  loadContactEventsForAccount,
  recordContactEvent,
} from "./contact-service.js";

export const RESEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Upsert Account + Contacts from prep form / generated prep.
 * @param {{ companyName: string, companyDomain?: string, prospectEmails?: string[], prospectEmail?: string, domain?: string, prep?: object, researchBundle?: object, contactDrafts?: object[], lifecycleId?: string, actorId?: string, prepBriefId?: string }} input
 * @returns {Promise<{ accountId: string, contactIds: string[], primaryContactId: string|null, account: object }>}
 */
export async function upsertAccountFromPrep(input) {
  const store = getStore();
  const ts = now();
  const companyName = String(input.companyName || "").trim();
  const companyDomain = normalizeDomain(input.companyDomain || input.domain);
  const emails = collectEmails(input);
  const emailDomain = domainFromEmail(emails[0]) || null;
  const primaryDomain = companyDomain || emailDomain;
  const slug = normalizeAccountSlug(companyName, primaryDomain);

  let account = await store.findAccountBySlug(slug);
  let metadataPatch = input.researchBundle
    ? mergeAccountResearch(account?.metadata, input.researchBundle, input.prep)
    : account?.metadata ? { ...account.metadata } : undefined;
  if (input.prep) {
    metadataPatch = mergeAccountMeddpicc(metadataPatch, meddpiccSignalsFromPrep(input.prep), "prep");
  }
  if (metadataPatch && !Object.keys(metadataPatch).length) metadataPatch = undefined;

  if (!account) {
    account = await store.createAccount({
      id: newId("account"),
      name: companyName || slug,
      domain: primaryDomain,
      slug,
      metadata: metadataPatch,
      createdAt: ts,
      updatedAt: ts,
    });
  } else {
    const patch = { updatedAt: ts };
    if (companyName && account.name !== companyName) patch.name = companyName;
    if (primaryDomain && account.domain !== primaryDomain) patch.domain = primaryDomain;
    if (metadataPatch) patch.metadata = metadataPatch;
    if (Object.keys(patch).length > 1) {
      account = await store.updateAccount(account.id, patch);
    }
  }

  const contactIds = [];
  let primaryContactId = null;
  const prospects = input.prep?.prospects || [];
  const contactDrafts = input.contactDrafts || [];

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const prospectMeta = prospects[i] || prospects.find((p) => p?.email === email);
    const draft = contactDrafts.find((d) => String(d?.email || "").toLowerCase() === email);
    let contact = await store.findContactByAccountEmail(account.id, email);
    const contactPatch = {
      name: prospectMeta?.name || draft?.name || contact?.name,
      title: prospectMeta?.title || draft?.role || contact?.title,
      role: prospectMeta?.role || draft?.role || contact?.role,
    };

    const researchMeta = draft?.metadata?.research || buildContactResearch(prospectMeta, ts);

    if (!contact) {
      contact = await store.createContact({
        id: newId("contact"),
        accountId: account.id,
        email,
        ...contactPatch,
        metadata: researchMeta ? { research: researchMeta } : undefined,
        createdAt: ts,
        updatedAt: ts,
      });
      if (input.actorId) {
        await recordContactEvent(contact.id, "contact_created", input.actorId, {
          source: "prep",
          lifecycleId: input.lifecycleId,
        });
      }
    } else {
      const patch = { updatedAt: ts, ...contactPatch };
      if (researchMeta) {
        patch.metadata = {
          ...(contact.metadata || {}),
          research: { ...(contact.metadata?.research || {}), ...researchMeta },
        };
      }
      if (patch.name || patch.title || patch.role || patch.metadata) {
        contact = await store.updateContact(contact.id, patch);
      }
    }

    contactIds.push(contact.id);
    if (i === 0) primaryContactId = contact.id;
  }

  return { accountId: account.id, contactIds, primaryContactId, account };
}

function normalizeDomain(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

function mergeAccountResearch(existing, researchBundle, prep) {
  const meta = { ...(existing || {}) };
  meta.research = {
    lastResearchedAt: researchBundle.lastResearchedAt || Date.now(),
    inputHash: researchBundle.inputHash,
    facts: researchBundle.facts || [],
    sources: researchBundle.sources || [],
    snippets: researchBundle.snippets || [],
    playbookVersion: researchBundle.playbookVersion || "1",
    enrichmentProvider: researchBundle.enrichmentProvider ?? null,
  };
  if (prep?.icpFit?.product) {
    meta.firmographics = {
      ...(meta.firmographics || {}),
      suggestedProduct: prep.icpFit.product,
    };
  }
  return meta;
}

function buildContactResearch(prospectMeta, ts) {
  if (!prospectMeta) return null;
  return {
    lastResearchedAt: ts,
    experienceSummary: prospectMeta.totalExperience,
    priorEmployers: prospectMeta.priorEmployers,
    competitorTouchpoints: prospectMeta.competitorTouchpoints,
  };
}

function collectEmails(input) {
  const set = new Set();
  const add = (e) => {
    const key = String(e || "").trim().toLowerCase();
    if (key && key.includes("@")) set.add(key);
  };
  add(input.prospectEmail);
  for (const e of input.prospectEmails || []) add(e);
  return [...set];
}

export { collectEmails as collectProspectEmails };

/** Accounts the current user has engaged with (via lifecycles). */
export async function listAccountsForUser(session) {
  const lifecycles = await listLifecyclesForUser(session);
  const store = getStore();
  const rows = await Promise.all(
    lifecycles.map(async (lifecycle) => {
      const account = await store.getAccount(lifecycle.accountId);
      return account ? { account, lifecycle } : null;
    }),
  );
  return rows
    .filter(Boolean)
    .sort((a, b) => (b.lifecycle.lastActivityAt || 0) - (a.lifecycle.lastActivityAt || 0));
}

/** Account detail for the current user: lifecycle spine + contacts. */
export async function getAccountEngagementDetail(session, accountId) {
  const ownerId = sessionUserId(session);
  if (!ownerId || !accountId) return null;

  const store = getStore();
  const lifecycle = await store.findActiveLifecycle(ownerId, accountId);
  if (!lifecycle) return null;

  const detail = await getLifecycleDetail(lifecycle.id);
  if (!detail) return null;

  const contacts = await store.listContactsByAccount(accountId);
  const contactEventsByContactId = await loadContactEventsForAccount(contacts, 10);
  return { ...detail, contacts, contactEventsByContactId };
}

/** Find account by company name + domain. */
export async function findAccountByCompanyName(companyName, domain) {
  const store = getStore();
  const slug = normalizeAccountSlug(companyName, normalizeDomain(domain));
  return store.findAccountBySlug(slug);
}

/** Load cached research bundle if still fresh for this input hash. */
export async function loadCachedResearch(companyName, companyDomain, inputHash) {
  const account = await findAccountByCompanyName(companyName, companyDomain);
  const research = account?.metadata?.research;
  if (!research?.lastResearchedAt || research.inputHash !== inputHash) return null;
  if (Date.now() - research.lastResearchedAt > RESEARCH_TTL_MS) return null;
  return research;
}

/** Simple input hash matching worker (must stay in sync). */
export function computePrepInputHash(companyName, companyDomain, emails) {
  const payload = {
    companyDomain: normalizeDomain(companyDomain),
    companyName: String(companyName || "").toLowerCase(),
    emails: [...emails].sort(),
    playbookVersion: "1",
  };
  let h = 0;
  const s = JSON.stringify(payload);
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `h${Math.abs(h).toString(36)}`;
}
