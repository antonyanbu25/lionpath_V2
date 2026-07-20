/**
 * Account and Contact upsert from prep form data.
 */

import { getStore } from "./store.js";
import { normalizeAccountSlug, domainFromEmail, newId, now, can, MAX_SE_TEAM_SIZE } from "./types.js";
import {
  listLifecyclesForSession,
  listActiveLifecyclesForAccount,
  getOrCreateLifecycle,
  getLifecycleDetail,
  archiveLifecycle,
  logSeTeamEvent,
} from "./lifecycle-service.js";
import { sessionUserId } from "./session.js";
import {
  mergeAccountMeddpicc,
  meddpiccSignalsFromPrep,
  loadContactEventsForAccount,
  recordContactEvent,
} from "./contact-service.js";
import {
  backfillAccountSeTeam,
  ensureSeTeamForPrepActor,
  resolveSeTeamDisplay,
  seTeamUserIds,
  userDisplayFields,
} from "./account-se-team.js";
import { getOrg, getVisibleScope, resolveOrgForUser, userWithDirectorFlag } from "./org-service.js";

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

export { ensureSeTeamForPrepActor, backfillAccountSeTeam } from "./account-se-team.js";

async function sessionUser(session) {
  const store = getStore();
  const userId = sessionUserId(session);
  if (!userId) return null;
  const user = await store.getUser(userId);
  if (!user) return { id: userId, role: "se", teamId: session.teamId || null, orgId: session.orgId || null };
  const org = user.orgId ? await getOrg(user.orgId) : null;
  return userWithDirectorFlag(user, org);
}

function pickRowLifecycle(account, lifecyclesForAccount) {
  if (!lifecyclesForAccount.length) return null;
  const primaryId = account.primarySeUserId;
  if (primaryId) {
    const primaryLc = lifecyclesForAccount.find((l) => l.ownerId === primaryId);
    if (primaryLc) return primaryLc;
  }
  return [...lifecyclesForAccount].sort(
    (a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0)
  )[0];
}

function maxLastActivity(lifecyclesForAccount) {
  return lifecyclesForAccount.reduce((max, l) => Math.max(max, l.lastActivityAt || 0), 0);
}

/** Accounts visible to session (scoped list, deduped by accountId). */
export async function listAccountsForSession(session) {
  const store = getStore();
  const lifecycles = await listLifecyclesForSession(session);
  const byAccount = new Map();

  for (const lifecycle of lifecycles) {
    const list = byAccount.get(lifecycle.accountId) || [];
    list.push(lifecycle);
    byAccount.set(lifecycle.accountId, list);
  }

  const rows = await Promise.all(
    [...byAccount.entries()].map(async ([accountId, lcs]) => {
      let account = await store.getAccount(accountId);
      if (!account) return null;
      account = await backfillAccountSeTeam(accountId);
      const lifecycle = pickRowLifecycle(account, lcs);
      if (!lifecycle) return null;
      const seTeamDisplay = await resolveSeTeamDisplay(account);
      const secondaryCount = (account.seTeam || []).filter((m) => m.role === "secondary").length;
      return {
        account,
        lifecycle,
        seTeamDisplay,
        secondaryCount,
        lastActivityAt: maxLastActivity(lcs),
      };
    })
  );

  return rows
    .filter(Boolean)
    .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
}

/** @deprecated use listAccountsForSession */
export async function listAccountsForUser(session) {
  return listAccountsForSession(session);
}

/** Org/team-visible SE users not already on the deal team (empty when roster is full). */
async function listAssignableSeOptions(user, currentMemberIds) {
  if (!user || currentMemberIds.length >= MAX_SE_TEAM_SIZE) return [];

  const store = getStore();
  const scope = await getVisibleScope(user);
  const onTeam = new Set(currentMemberIds);
  const seen = new Set();
  /** @type {import("./types.js").User[]} */
  const visible = [];

  async function consider(member) {
    if (!member?.id || seen.has(member.id) || onTeam.has(member.id)) return;
    if (member.role !== "se") return;
    if (member.status && member.status !== "active") return;
    seen.add(member.id);
    visible.push(member);
  }

  const teamIds =
    scope.teamIds?.length > 0 ? scope.teamIds : user.teamId ? [user.teamId] : [];

  for (const teamId of teamIds) {
    const team = await store.getTeam(teamId);
    for (const memberId of team?.memberIds || []) {
      await consider(await store.getUser(memberId));
    }
  }

  if (scope.orgId && store.listUsersByOrg) {
    const orgUsers = await store.listUsersByOrg(scope.orgId);
    for (const member of orgUsers) {
      if (member.role !== "se") continue;
      if (scope.type === "team" && member.teamId !== user.teamId) continue;
      if (
        scope.type === "org" &&
        teamIds.length &&
        member.teamId &&
        !teamIds.includes(member.teamId)
      ) {
        continue;
      }
      await consider(member);
    }
  }

  if (!visible.length && user.role === "manager" && store.listUsersByManagerId) {
    for (const member of await store.listUsersByManagerId(user.id)) {
      await consider(member);
    }
  }

  visible.sort((a, b) =>
    (a.displayName || a.email || "").localeCompare(b.displayName || b.email || "")
  );

  return visible.map((member) => ({
    seUserId: member.id,
    user: userDisplayFields(member),
  }));
}

async function canReadAccountEngagement(user, account, lifecycles) {
  if (!user || !account) return false;
  const ids = seTeamUserIds(account);
  const orgId = lifecycles[0]?.orgId || user.orgId || null;
  return can(user, "read_account", {
    ownerId: account.primarySeUserId || lifecycles[0]?.ownerId,
    seTeamUserIds: ids,
    accountOrgId: orgId,
    teamId: user.teamId || undefined,
    orgId: user.orgId || undefined,
  });
}

/**
 * Account detail: merged activity, deal team, lens lifecycle for pipeline/artifacts.
 * @param {object} session
 * @param {string} accountId
 * @param {{ lifecycleOwnerId?: string }} [options]
 */
export async function getAccountEngagementDetail(session, accountId, options = {}) {
  const user = await sessionUser(session);
  if (!user || !accountId) return null;

  const store = getStore();
  let account = await store.getAccount(accountId);
  if (!account) return null;
  account = await backfillAccountSeTeam(accountId);

  const teamLifecycles = await listActiveLifecyclesForAccount(accountId);
  if (!(await canReadAccountEngagement(user, account, teamLifecycles))) {
    const ownLc = await store.findActiveLifecycle(user.id, accountId);
    if (!ownLc) return null;
  }

  const seTeamDisplay = await resolveSeTeamDisplay(account);
  const memberIds = seTeamUserIds(account);
  let lensOwnerId = options.lifecycleOwnerId || null;
  if (!lensOwnerId) {
    if (memberIds.includes(user.id)) lensOwnerId = user.id;
    else lensOwnerId = account.primarySeUserId || teamLifecycles[0]?.ownerId || user.id;
  }

  let lensLifecycle =
    teamLifecycles.find((l) => l.ownerId === lensOwnerId) ||
    (await store.findActiveLifecycle(lensOwnerId, accountId));
  if (!lensLifecycle && teamLifecycles.length) {
    lensLifecycle = teamLifecycles[0];
    lensOwnerId = lensLifecycle.ownerId;
  }
  if (!lensLifecycle) return null;

  const lensDetail = await getLifecycleDetail(lensLifecycle.id);
  if (!lensDetail) return null;

  const userNameById = new Map(seTeamDisplay.map((m) => [m.seUserId, m.user.displayName]));

  const mergedEvents = [];
  for (const lc of teamLifecycles) {
    const evs = await store.listLifecycleEvents(lc.id);
    const ownerName = userNameById.get(lc.ownerId) || lc.ownerId;
    for (const ev of evs) {
      mergedEvents.push({
        ...ev,
        lifecycleOwnerId: lc.ownerId,
        lifecycleOwnerName: ownerName,
      });
    }
  }
  mergedEvents.sort((a, b) => b.timestamp - a.timestamp);

  const contacts = await store.listContactsByAccount(accountId);
  const contactEventsByContactId = await loadContactEventsForAccount(contacts, 10);

  const canManageTeam = can(user, "manage_account_team", {
    seTeamUserIds: memberIds,
    accountOrgId: lensLifecycle.orgId || user.orgId,
    teamId: user.teamId || undefined,
  });

  let assignableSeOptions = [];
  if (canManageTeam && memberIds.length < MAX_SE_TEAM_SIZE) {
    assignableSeOptions = await listAssignableSeOptions(user, memberIds);
  }

  return {
    ...lensDetail,
    account,
    events: mergedEvents,
    contacts,
    contactEventsByContactId,
    seTeamDisplay,
    lifecycleOwnerId: lensOwnerId,
    teamLifecycles,
    canManageTeam,
    assignableSeOptions,
  };
}

/**
 * Update deal team roster.
 * @param {object} session
 * @param {string} accountId
 * @param {"add_secondary"|"remove"|"set_primary"|"transfer_primary"} action
 * @param {{ seUserId?: string, targetSeUserId?: string }} payload
 */
export async function updateAccountSeTeam(session, accountId, action, payload = {}) {
  const user = await sessionUser(session);
  if (!user || !accountId) return { success: false, error: "Unauthorized" };

  const store = getStore();
  let account = await backfillAccountSeTeam(accountId);
  if (!account) return { success: false, error: "Account not found" };

  const memberIds = seTeamUserIds(account);
  if (
    !can(user, "manage_account_team", {
      seTeamUserIds: memberIds,
      accountOrgId: user.orgId,
      teamId: user.teamId || undefined,
    })
  ) {
    if (action === "add_secondary" && payload.seUserId === user.id) {
      /* self-join allowed for SE */
    } else {
      return { success: false, error: "Not allowed" };
    }
  }

  const ts = now();
  let seTeam = [...(account.seTeam || [])];
  const actorId = user.id;
  const targetId = payload.seUserId || payload.targetSeUserId;

  if (action === "add_secondary" || action === "transfer_primary") {
    const addId = payload.seUserId || user.id;
    if (seTeam.some((m) => m.seUserId === addId)) {
      return { success: true, account };
    }
    if (seTeam.length >= MAX_SE_TEAM_SIZE) {
      return { success: false, error: "Deal team is full (max 4 SEs)" };
    }
    seTeam.push({ seUserId: addId, role: "secondary", addedAt: ts, addedBy: actorId });
    account = await store.updateAccount(accountId, { seTeam, updatedAt: ts });

    const targetUser = await store.getUser(addId);
    const lc = await getOrCreateLifecycle(addId, accountId, targetUser?.teamId || user.teamId || "", {
      title: account.name,
      actorId,
      orgId: targetUser?.orgId || user.orgId || null,
    });
    await logSeTeamEvent(lc.id, "se_added", actorId, {
      seUserId: addId,
      accountId,
      role: "secondary",
    });
    return { success: true, account };
  }

  if (action === "remove") {
    if (!targetId) return { success: false, error: "seUserId required" };
    const member = seTeam.find((m) => m.seUserId === targetId);
    if (!member) return { success: false, error: "Not on deal team" };
    if (member.role === "primary" && user.role === "se") {
      return { success: false, error: "Cannot remove primary SE" };
    }
    seTeam = seTeam.filter((m) => m.seUserId !== targetId);
    let primarySeUserId = account.primarySeUserId;
    if (targetId === primarySeUserId) {
      primarySeUserId = seTeam.find((m) => m.role === "primary")?.seUserId || null;
    }
    account = await store.updateAccount(accountId, { seTeam, primarySeUserId, updatedAt: ts });

    const lc = await store.findActiveLifecycle(targetId, accountId);
    if (lc) {
      await archiveLifecycle(lc.id, actorId, "se_removed");
      await logSeTeamEvent(lc.id, "se_removed", actorId, { seUserId: targetId, accountId });
    }
    return { success: true, account };
  }

  if (action === "set_primary" || action === "transfer_primary") {
    const newPrimaryId = payload.seUserId || payload.targetSeUserId;
    if (!newPrimaryId) return { success: false, error: "seUserId required" };
    if (!seTeam.some((m) => m.seUserId === newPrimaryId)) {
      return { success: false, error: "SE not on deal team" };
    }
    const oldPrimaryId = account.primarySeUserId;
    seTeam = seTeam.map((m) => {
      if (m.seUserId === newPrimaryId) return { ...m, role: "primary" };
      if (m.role === "primary") return { ...m, role: "secondary" };
      return m;
    });
    account = await store.updateAccount(accountId, {
      seTeam,
      primarySeUserId: newPrimaryId,
      updatedAt: ts,
    });

    const lc = await store.findActiveLifecycle(newPrimaryId, accountId);
    if (lc) {
      await logSeTeamEvent(lc.id, "primary_se_changed", actorId, {
        fromSeUserId: oldPrimaryId,
        toSeUserId: newPrimaryId,
        accountId,
      });
    }
    return { success: true, account };
  }

  return { success: false, error: "Unknown action" };
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
export function computePrepInputHash(companyName, companyDomain, emails, linkedinFingerprint = "") {
  const payload = {
    companyDomain: normalizeDomain(companyDomain),
    companyName: String(companyName || "").toLowerCase(),
    emails: [...emails].sort(),
    playbookVersion: "1",
    linkedin: linkedinFingerprint || "",
  };
  let h = 0;
  const s = JSON.stringify(payload);
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `h${Math.abs(h).toString(36)}`;
}
