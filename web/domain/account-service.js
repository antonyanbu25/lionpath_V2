/**
 * Account and Contact upsert from prep form data.
 */

import { getStore } from "./store.js";
import { safeStoreOp } from "./safe-store.js";
import { listPostCallAnalyses } from "../history.js";
import { normalizeUserEmail } from "../shared.js";
import { companyNameFromPrimaryEmail } from "../prep-domain.js";
import { normalizeAccountSlug, domainFromEmail, newId, now, can, MAX_SE_TEAM_SIZE } from "./types.js";
import { isFreeMailDomain } from "./constants.js";
import {
  listLifecyclesForSession,
  listActiveLifecyclesForAccount,
  getOrCreateLifecycle,
  getLifecycleDetail,
  archiveLifecycle,
  logSeTeamEvent,
} from "./lifecycle-service.js";
import { listDealsForAccount, DEAL_TYPE_LABELS, resolveDealForEngagement } from "./deal-service.js";
import { resolveEngagementMotion } from "./deal-motion.js";
import { sessionUserId, effectiveSessionUserId } from "./session.js";
import {
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
import { selectLatestArrLines } from "./arr-service.js";
import { buildAccountArrRollup, formatProductLabel } from "./account-arr-service.js";
import { resolveDealMeddpicc } from "./contact-service.js";
import {
  buildDealExtrasFromHistory,
  enrichDealFromHistoryRecords,
  dealSummaryFromHistoryRecords,
  mergeAccountListRows,
} from "./history-deal-enrichment.js";
import {
  computePrepInputHash as computePrepInputHashImpl,
  PREP_PLAYBOOK_VERSION,
} from "../prep-input-hash.js";
import {
  getCachedAccountListRows,
  setCachedAccountListRows,
  invalidateSessionListCache,
} from "./session-list-cache.js";

export { invalidateSessionListCache };

export const RESEARCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Upsert Account + Contacts from prep form / generated prep.
 * @param {{ companyName: string, companyDomain?: string, accountId?: string|null, createNewAccount?: boolean, prospectEmails?: string[], prospectEmail?: string, domain?: string, prep?: object, researchBundle?: object, contactDrafts?: object[], lifecycleId?: string, actorId?: string, prepBriefId?: string }} input
 * @returns {Promise<{ accountId: string, contactIds: string[], primaryContactId: string|null, account: object }>}
 */
export async function upsertAccountFromPrep(input) {
  const store = getStore();
  const ts = now();
  const companyName = String(input.companyName || "").trim();
  const companyDomain = normalizeDomain(input.companyDomain || input.domain);
  const emails = collectEmails(input);
  const emailDomain = domainFromEmail(emails[0]) || null;
  const resolvedDomain =
    companyDomain || (emailDomain && !isFreeMailDomain(emailDomain) ? emailDomain : null);
  const fromFreeMailProspect = !companyDomain && !!emailDomain && isFreeMailDomain(emailDomain);
  const slug = normalizeAccountSlug(companyName, resolvedDomain);

  /** @type {object|null} */
  let account = null;
  const explicitAccountId = String(input.accountId || "").trim();
  const forceNewAccount = input.createNewAccount === true;

  if (explicitAccountId && !forceNewAccount) {
    account = await store.getAccount(explicitAccountId);
  }

  if (!account && !forceNewAccount) {
    account = await store.findAccountBySlug(slug);
  }

  if (!account && !forceNewAccount && resolvedDomain && store.findAccountsByDomain) {
    try {
      const byDomain = await store.findAccountsByDomain(resolvedDomain);
      if (byDomain?.length === 1) {
        account = byDomain[0];
      } else if (byDomain?.length > 1 && input.actorId) {
        const onTeam = byDomain.find((a) =>
          (a.seTeam || []).some((m) => m.seUserId === input.actorId),
        );
        if (onTeam) account = onTeam;
      }
    } catch {
      /* best-effort domain lookup */
    }
  }
  let metadataPatch = input.researchBundle
    ? mergeAccountResearch(account?.metadata, input.researchBundle, input.prep)
    : account?.metadata ? { ...account.metadata } : undefined;
  if (metadataPatch && !Object.keys(metadataPatch).length) metadataPatch = undefined;

  if (!account) {
    const createMetadata = metadataPatch ? { ...metadataPatch } : {};
    if (fromFreeMailProspect) createMetadata.domainNeedsConfirmation = true;
    account = await store.createAccount({
      id: newId("account"),
      name: companyName || slug,
      domain: resolvedDomain,
      slug,
      metadata: Object.keys(createMetadata).length ? createMetadata : undefined,
      createdAt: ts,
      updatedAt: ts,
    });
  } else {
    const patch = { updatedAt: ts };
    const preserveName = explicitAccountId && account.id === explicitAccountId;
    if (companyName && account.name !== companyName && !preserveName) patch.name = companyName;
    if (resolvedDomain && account.domain !== resolvedDomain) patch.domain = resolvedDomain;
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

/** @param {import("./types.js").Deal[]} deals @param {import("./types.js").Lifecycle} lifecycle */
function selectedDealFromLifecycle(deals, lifecycle) {
  if (lifecycle.dealId) {
    const linked = deals.find((d) => d.id === lifecycle.dealId);
    if (linked) return linked;
  }
  return deals.find((d) => d.status === "active") || null;
}

function companyFromHistoryRecord(rec) {
  const a = rec?.analysis || rec?.result?.analysis || {};
  const fromTitle = (rec.title || a.callHeader?.title || "")
    .split(/[·|–—-]/)[0]
    ?.trim();
  return (
    a.company ||
    rec.result?.confirmed?.company ||
    rec.result?.resolve?.account?.name ||
    fromTitle ||
    ""
  ).trim();
}

function prospectEmailsFromHistoryRecord(rec) {
  return [
    ...(rec?.prospectEmails || []),
    ...(rec?.result?.prospectEmails || []),
    ...(rec?.result?.confirmed?.prospectEmails || []),
  ];
}

/** Company label for history fallback rows — matches contacts preview sources. */
function accountNameFromHistoryRecord(rec) {
  const direct = companyFromHistoryRecord(rec);
  if (direct) return direct;
  const fromEmail = companyNameFromPrimaryEmail(prospectEmailsFromHistoryRecord(rec).join(", "));
  if (fromEmail) return fromEmail;
  const fromTitle = (rec?.title || "").split(/[·|–—-]/)[0]?.trim();
  return fromTitle || "";
}

function resolveHistoryAccountId(rec, fallbackKey) {
  return (
    rec.result?.confirmed?.accountId ||
    rec.result?.resolve?.account?.accountId ||
    rec.accountId ||
    `hist_${fallbackKey}`
  );
}

function loadBriefsFromStorage() {
  try {
    const raw = localStorage.getItem("lionpath_briefs");
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function companyFromBriefRecord(brief) {
  const direct = String(
    brief?.company || brief?.meta?.company || brief?.input?.companyName || "",
  ).trim();
  if (direct) return direct;
  const emails = brief?.meta?.prospectEmails || brief?.input?.prospectEmails || [];
  return companyNameFromPrimaryEmail(emails.join(", ")) || "";
}

function upsertHistoryFallbackRow(byKey, session, name, ts, accountId) {
  const key = name.toLowerCase();
  let row = byKey.get(key);
  if (!row) {
    row = {
      account: { id: accountId, name, domain: "" },
      lifecycle: {
        id: `lc_hist_${accountId}`,
        accountId,
        ownerId: effectiveSessionUserId(session),
        title: name,
        stage: "demo",
        status: "active",
        lastActivityAt: ts,
      },
      seTeamDisplay: [],
      secondaryCount: 0,
      lastActivityAt: ts,
      dealType: "new_business",
      dealTypeLabel: DEAL_TYPE_LABELS.new_business,
      dealStage: "demo",
      deals: [],
      canonicalDealId: null,
      historyCallCount: 0,
      _historyFallback: true,
    };
    byKey.set(key, row);
  }
  if (ts > (row.lastActivityAt || 0)) {
    row.lastActivityAt = ts;
    row.lifecycle.lastActivityAt = ts;
  }
  return row;
}

/**
 * Minimal account rows from local post-call history when Firestore lists fail or are empty.
 * @param {object} session
 */
export function listAccountRowsFromHistory(session) {
  const email = normalizeUserEmail(session?.email);
  if (!email) return [];
  const byKey = new Map();

  for (const rec of listPostCallAnalyses(email)) {
    const name = accountNameFromHistoryRecord(rec);
    if (!name) continue;
    const key = name.toLowerCase();
    const ts = rec.timestamp || 0;
    const accountId = resolveHistoryAccountId(rec, key.replace(/[^a-z0-9]+/g, "-").slice(0, 40));
    const row = upsertHistoryFallbackRow(byKey, session, name, ts, accountId);
    row.historyCallCount = (row.historyCallCount || 0) + 1;
  }

  for (const brief of loadBriefsFromStorage()) {
    const name = companyFromBriefRecord(brief);
    if (!name) continue;
    const key = name.toLowerCase();
    if (byKey.has(key)) continue;
    const slug = key.replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    const ts = brief.savedAt || brief.createdAt || brief.when || 0;
    upsertHistoryFallbackRow(byKey, session, name, ts, `hist_${slug}`);
  }

  return [...byKey.values()].sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
}

/**
 * Prospect contacts from local briefs + post-call history (same sources as the contacts preview).
 * @param {object} session
 */
export function historyPreviewContactsForSession(session) {
  const email = normalizeUserEmail(session?.email);
  if (!email) return { contacts: [], accountNameById: {} };
  const seen = new Set();
  const contacts = [];
  const accountNameById = {};

  const addContact = (addr, company) => {
    const e = String(addr || "").trim().toLowerCase();
    if (!e || seen.has(e)) return;
    seen.add(e);
    const display = e.split("@")[0].replace(/[._-]+/g, " ");
    const accountKey = String(company || e.split("@")[1] || "Contact").trim();
    const accountId = `hist_${accountKey.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
    accountNameById[accountId] = accountKey;
    contacts.push({
      id: `hist_${e}`,
      email: e,
      name: display.charAt(0).toUpperCase() + display.slice(1),
      accountId,
      _preview: true,
    });
  };

  for (const brief of loadBriefsFromStorage()) {
    const company = companyFromBriefRecord(brief);
    for (const addr of brief.meta?.prospectEmails || brief.input?.prospectEmails || []) {
      addContact(addr, company);
    }
  }
  for (const rec of listPostCallAnalyses(email)) {
    const company = accountNameFromHistoryRecord(rec);
    for (const addr of prospectEmailsFromHistoryRecord(rec)) addContact(addr, company);
  }

  contacts.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { contacts, accountNameById };
}

/** @param {object} session @param {string} accountId */
function findHistoryAccountRow(session, accountId) {
  return listAccountRowsFromHistory(session).find((r) => r.account?.id === accountId) || null;
}

/** @param {object} session @param {string} accountId */
export function historyRecordsForAccount(session, accountId) {
  const email = normalizeUserEmail(session?.email);
  if (!email) return [];
  const out = [];
  for (const rec of listPostCallAnalyses(email)) {
    const name = accountNameFromHistoryRecord(rec);
    if (!name) continue;
    const key = name.toLowerCase();
    const id = resolveHistoryAccountId(rec, key.replace(/[^a-z0-9]+/g, "-").slice(0, 40));
    if (id === accountId) out.push(rec);
  }
  return out.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/**
 * Deal list rows from local post-call history when Firestore is empty or unavailable.
 * @param {object} session
 */
export function listDealsFromHistory(session) {
  const rows = listAccountRowsFromHistory(session);
  const ownerId = effectiveSessionUserId(session);
  const ts = Date.now();
  return rows.map((row) => {
    const account = row.account;
    const dealId = row.canonicalDealId || `deal_hist_${String(account.id).replace(/^hist_/, "")}`;
    const deal = {
      id: dealId,
      accountId: account.id,
      type: "new_business",
      stage: row.dealStage || "demo",
      status: "active",
      ownerId,
      teamId: session?.teamId || null,
      orgId: session?.orgId || null,
      title: account.name,
      postCallCount: row.historyCallCount || 0,
      prepCount: 0,
      openTaskCount: 0,
      latestQualityScore: null,
      createdAt: row.lastActivityAt || ts,
      updatedAt: row.lastActivityAt || ts,
      lastActivityAt: row.lastActivityAt || ts,
    };
    return {
      deal,
      account,
      seTeamDisplay: row.seTeamDisplay || [],
      primarySeName: session?.name || null,
      lastActivityAt: row.lastActivityAt || 0,
      _historyFallback: true,
    };
  });
}

/**
 * @param {object} session
 * @param {string} accountId
 * @param {ReturnType<typeof listAccountRowsFromHistory>[number]} histRow
 * @param {object} options
 */
async function buildAccountEngagementDetailFromHistory(session, accountId, histRow, options = {}) {
  const user = await sessionUser(session);
  if (!user) return null;

  const account = { ...histRow.account, metadata: histRow.account.metadata || {} };
  const lifecycle = { ...histRow.lifecycle };
  const historyRecs = historyRecordsForAccount(session, accountId);
  const ownerId = effectiveSessionUserId(session);
  const dealId = histRow.canonicalDealId || `deal_hist_${String(accountId).replace(/^hist_/, "")}`;
  const deals = [
    {
      id: dealId,
      accountId,
      type: "new_business",
      stage: histRow.dealStage || "demo",
      status: "active",
      ownerId,
      teamId: session?.teamId || null,
      orgId: session?.orgId || null,
      title: account.name,
      postCallCount: historyRecs.length,
      prepCount: 0,
      openTaskCount: 0,
      latestQualityScore: null,
      createdAt: histRow.lastActivityAt || Date.now(),
      updatedAt: histRow.lastActivityAt || Date.now(),
      lastActivityAt: histRow.lastActivityAt || Date.now(),
    },
  ];

  let selectedDealId = null;
  if (typeof options.dealId === "string" && options.dealId) {
    selectedDealId = options.dealId;
  } else if (options.dealId !== null) {
    selectedDealId = dealId;
  }
  let selectedDeal = selectedDealId ? deals.find((d) => d.id === selectedDealId) || null : null;
  selectedDeal = enrichDealFromHistoryRecords(selectedDeal, historyRecs);
  if (selectedDeal && selectedDealId) {
    const dealIdx = deals.findIndex((d) => d.id === selectedDealId);
    if (dealIdx >= 0) deals[dealIdx] = selectedDeal;
  }

  const historyExtras = buildDealExtrasFromHistory(selectedDeal, account, historyRecs);

  const postCalls = historyRecs.map((rec) => ({
    id: rec.id,
    accountId,
    dealId,
    lifecycleId: lifecycle.id,
    ownerId,
    teamId: session?.teamId || null,
    orgId: session?.orgId || null,
    title: rec.title || companyFromHistoryRecord(rec) || "Call",
    createdAt: rec.timestamp || Date.now(),
    updatedAt: rec.timestamp || Date.now(),
    analysis: rec.analysis || rec.result?.analysis || {},
    qualityScore:
      rec.qualityScore ??
      rec.analysis?.qualityCoach?.overallScore ??
      rec.result?.scorecard?.overallScore ??
      null,
    scorecard: rec.scorecard || rec.result?.scorecard || null,
  }));

  const events = postCalls.map((pc) => ({
    id: `ev_hist_${pc.id}`,
    lifecycleId: lifecycle.id,
    type: "postcall_analyzed",
    actorId: ownerId,
    timestamp: pc.createdAt,
    payload: { qualityScore: pc.qualityScore, title: pc.title },
  }));

  const accountCalls = postCalls.map((postCall) => {
    const med = resolveDealMeddpicc(selectedDeal, account);
    return {
      postCall,
      deal: selectedDeal || deals[0],
      dealLabel: account.name,
      meddpiccScore: med?.completionScore ?? null,
      scorecard: postCall.scorecard || null,
      ownerName: session?.name || user.displayName || "-",
      movement: historyExtras.callRows.find((r) => r.postCall.id === postCall.id)?.movement || "-",
    };
  });

  const accountRollup = {
    arrRollup: {
      estimateBand: null,
      linesByDealId: new Map(),
      discussedUnquantified: [],
      crossSellGaps: [],
    },
    dealRows: [],
    accountCalls,
    firmographics: {
      industry: "-",
      region: "-",
      subRegion: "-",
      hq: "-",
      supportAgents: "-",
      incumbent: "-",
      competitor: "Unknown",
    },
    reasonForEvaluation: null,
    whyAi: null,
    hasEconomicBuyer: false,
    health: deriveAccountHealth(null, null, histRow.lastActivityAt),
    callCount: postCalls.length,
    dealCount: deals.length,
  };

  return {
    lifecycle,
    account,
    events,
    preps: [],
    postCalls,
    tasks: [],
    contacts: [],
    contactEventsByContactId: {},
    seTeamDisplay: histRow.seTeamDisplay || [],
    lifecycleOwnerId: lifecycle.ownerId,
    teamLifecycles: [lifecycle],
    deals,
    selectedDealId,
    selectedDeal,
    selectedDealType: "new_business",
    engagementSelectionSource: "explicit",
    canManageTeam: false,
    assignableSeOptions: [],
    dealSummary: historyExtras.dealSummary || dealSummaryFromHistoryRecords(historyRecs),
    accountSummary: null,
    accountRollup,
    technicalCommit: historyExtras.technicalCommit,
    latestSignal: historyExtras.latestSignal,
    daysInStage: historyExtras.daysInStage,
    stageMedianDays: historyExtras.stageMedianDays,
    _historyFallback: true,
  };
}

/** Accounts visible to session (scoped list, deduped by accountId). */
export async function listAccountsForSession(session, opts = {}) {
  if (!opts.skipCache) {
    const cached = getCachedAccountListRows(session);
    if (cached) {
      return cached;
    }
  }
  try {
    const store = getStore();
    const { effectiveSessionUserId } = await import("./session.js");
    const ownerId = effectiveSessionUserId(session);

    let lifecycles = [];
    try {
      lifecycles = await listLifecyclesForSession(session);
    } catch (err) {
      console.warn("[account-service] listLifecyclesForSession failed:", err?.message || err);
    }

    const byAccount = new Map();
    for (const lifecycle of lifecycles) {
      const list = byAccount.get(lifecycle.accountId) || [];
      list.push(lifecycle);
      byAccount.set(lifecycle.accountId, list);
    }

    const rows = await Promise.all(
      [...byAccount.entries()].map(async ([accountId, lcs]) => {
        try {
          let account = await safeStoreOp("getAccount", () => store.getAccount(accountId), null);
          if (!account) return null;
          account = await safeStoreOp(
            "backfillAccountSeTeam",
            () => backfillAccountSeTeam(accountId),
            account,
          );
          const lifecycle = pickRowLifecycle(account, lcs);
          if (!lifecycle) return null;
          const seTeamDisplay = await safeStoreOp(
            "resolveSeTeamDisplay",
            () => resolveSeTeamDisplay(account),
            [],
          );
          const secondaryCount = (account.seTeam || []).filter((m) => m.role === "secondary").length;
          const deals = store.listDealsByAccount
            ? await safeStoreOp(
                "listDealsByAccount",
                () => store.listDealsByAccount(accountId),
                [],
              )
            : [];
          const activeNb = deals.find((d) => d.type === "new_business" && d.status === "active");
          const activeExp = deals.find((d) => d.type === "expansion" && d.status === "active");
          const canonicalDeal = activeNb || activeExp || selectedDealFromLifecycle(deals, lifecycle);
          const dealType = canonicalDeal?.type || "new_business";
          const dealStage = canonicalDeal?.stage || lifecycle.stage;
          return {
            account,
            lifecycle,
            seTeamDisplay,
            secondaryCount,
            lastActivityAt: maxLastActivity(lcs),
            dealType,
            dealTypeLabel: DEAL_TYPE_LABELS[dealType] || dealType,
            dealStage,
            deals,
            canonicalDealId: canonicalDeal?.id || lifecycle.dealId || null,
          };
        } catch (err) {
          console.warn("[account-service] account row skipped:", accountId, err?.message || err);
          return null;
        }
      }),
    );

    const sorted = rows.filter(Boolean).sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
    const historyRows = listAccountRowsFromHistory(session);
    const merged = sorted.length ? mergeAccountListRows(sorted, historyRows) : historyRows;
    if (merged.length) setCachedAccountListRows(session, merged);
    return merged;
  } catch (err) {
    console.warn("[account-service] listAccountsForSession failed:", err?.message || err);
    return listAccountRowsFromHistory(session);
  }
}

/**
 * All contacts across the accounts the session SE is on (seTeam / lifecycle).
 * Powers the "My contacts" surface. Contacts are the primary identifier.
 * @param {object|null} session
 * @returns {Promise<{ contacts: object[], accountNameById: Record<string,string> }>}
 */
export async function listContactsForSession(session) {
  const store = getStore();
  const accountNameById = {};
  let rows = [];
  try {
    rows = await listAccountsForSession(session);
  } catch (err) {
    console.warn("[account-service] listContactsForSession accounts failed:", err?.message || err);
    return { contacts: [], accountNameById };
  }

  const contacts = [];
  const seen = new Set();
  await Promise.all(
    rows.map(async (row) => {
      const accountId = row.account?.id;
      if (!accountId || !store.listContactsByAccount) return;
      accountNameById[accountId] = row.account.name || row.account.domain || "Account";
      const primaryContactId = row.lifecycle?.primaryContactId || null;
      const list = await safeStoreOp(
        "listContactsByAccount",
        () => store.listContactsByAccount(accountId),
        [],
      );
      for (const c of list) {
        const key = String(c.email || c.id || "").toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        contacts.push({ ...c, _isPrimary: !!primaryContactId && c.id === primaryContactId });
      }
    }),
  );

  const preview = historyPreviewContactsForSession(session);
  for (const c of preview.contacts) {
    const key = String(c.email || c.id || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    contacts.push(c);
  }
  for (const [accountId, name] of Object.entries(preview.accountNameById)) {
    if (!accountNameById[accountId]) accountNameById[accountId] = name;
  }

  contacts.sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)));
  return { contacts, accountNameById };
}

const TRACTION_RANK = { hot: 0, warm: 1, cold: 2 };

function tractionSortRank(traction) {
  return TRACTION_RANK[traction] ?? 2;
}

function daysSince(ts) {
  if (!ts) return null;
  return Math.max(0, Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000)));
}

/** @param {string|null|undefined} worstTraction @param {number|null} daysSilent @param {number|null} lastActivityAt */
export function deriveAccountHealth(worstTraction, daysSilent, lastActivityAt) {
  const silent = daysSilent ?? daysSince(lastActivityAt);
  if (worstTraction === "cold" || (silent != null && silent >= 30)) {
    return { label: "At risk", tone: "red" };
  }
  if (worstTraction === "hot" && (silent == null || silent < 14)) {
    return { label: "Healthy", tone: "green" };
  }
  return { label: "Watch", tone: "amber" };
}

/**
 * List row metrics — spec §11.5 columns.
 * @param {ReturnType<import("./store.js").getStore>} store
 * @param {object} row
 */
export async function enrichAccountListRow(store, row) {
  if (!row?.account?.id) return row;

  try {
    const { account, deals, lastActivityAt, historyCallCount } = row;
    const dealList = deals || [];
    const activeDeals = dealList.filter((d) => d.status === "active");
    const meta = account?.metadata || {};

    let totalArrLow = 0;
    let totalArrHigh = 0;
    let hasEstimates = false;
    const products = new Set();
    let callCount = historyCallCount || 0;
    let worstTraction = null;
    let maxDaysSilent = null;

    for (const deal of dealList) {
      callCount += deal.postCallCount || 0;
      if (deal.arrEstimatePoint != null) {
        hasEstimates = true;
        totalArrLow += deal.arrEstimateLow ?? deal.arrEstimatePoint ?? 0;
        totalArrHigh += deal.arrEstimateHigh ?? deal.arrEstimatePoint ?? 0;
      }
    }

    const dealMetrics = await Promise.all(
      dealList.map(async (deal) => {
        const [lines, signals] = await Promise.all([
          store.listArrLinesByDeal
            ? safeStoreOp("listArrLinesByDeal", () => store.listArrLinesByDeal(deal.id), [])
            : Promise.resolve([]),
          store.listDealSignalsByDeal
            ? safeStoreOp(
                "listDealSignalsByDeal",
                () => store.listDealSignalsByDeal(deal.id, 1),
                [],
              )
            : Promise.resolve([]),
        ]);

        return { lines, signal: signals[0] || null };
      }),
    );

    for (const { lines, signal } of dealMetrics) {
      const latestLines = selectLatestArrLines(lines);
      const base = latestLines.find((l) => l.kind === "base" && !l.excluded);
      if (base?.product) products.add(formatProductLabel(base.product));
      if (signal?.traction) {
        if (!worstTraction || tractionSortRank(signal.traction) > tractionSortRank(worstTraction)) {
          worstTraction = signal.traction;
        }
      }
      if (signal?.daysSilent != null) {
        maxDaysSilent = Math.max(maxDaysSilent ?? 0, signal.daysSilent);
      }
    }

    const region = meta.region || meta.sub_region || meta.subRegion || "-";
    const health = deriveAccountHealth(worstTraction, maxDaysSilent, lastActivityAt);
    const lastTouchDays = daysSince(lastActivityAt);

    return {
      ...row,
      region,
      dealCount: activeDeals.length || dealList.length,
      totalArrLow: hasEstimates ? totalArrLow : null,
      totalArrHigh: hasEstimates ? totalArrHigh : null,
      totalArrPoint: hasEstimates ? (totalArrLow + totalArrHigh) / 2 : null,
      productsInPlay: [...products].join(", ") || "-",
      callCount,
      health,
      lastTouchDays,
      worstTraction,
    };
  } catch (err) {
    console.warn("[account-service] enrichAccountListRow skipped:", row?.account?.id, err?.message || err);
    return row;
  }
}

/** @deprecated use listAccountsForSession */
export async function listAccountsForUser(session) {
  return listAccountsForSession(session);
}

/**
 * All deals on accounts visible to the session (Deals nav list).
 * @param {object} session
 * @returns {Promise<Array<{ deal: import("./types.js").Deal, account: import("./types.js").Account, seTeamDisplay: object[], primarySeName: string|null, lastActivityAt: number }>>}
 */
export async function listDealsForSession(session) {
  /** @type {Map<string, object>} */
  const byDealId = new Map();

  try {
    const accountRows = await listAccountsForSession(session);

    for (const row of accountRows) {
      const { account, seTeamDisplay, deals } = row;
      if (!account?.id) continue;
      const dealList = deals?.length
        ? deals
        : await safeStoreOp("listDealsForAccount", () => listDealsForAccount(account.id), []);
      const primary = (seTeamDisplay || []).find((m) => m.role === "primary") || seTeamDisplay?.[0];
      const primarySeName = primary?.user?.displayName || null;

      for (const deal of dealList) {
        if (!deal?.id || byDealId.has(deal.id)) continue;
        byDealId.set(deal.id, {
          deal,
          account,
          seTeamDisplay,
          primarySeName,
          lastActivityAt: deal.lastActivityAt || deal.updatedAt || 0,
        });
      }
    }
  } catch (err) {
    console.warn("[account-service] listDealsForSession failed:", err?.message || err);
  }

  const sorted = [...byDealId.values()].sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  if (sorted.length) return sorted;
  return listDealsFromHistory(session);
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
 * Pick existing deal for account detail (never creates deals).
 * @param {string} accountId
 * @param {string} actorId
 * @param {import("./types.js").Deal[]} deals
 * @param {string|null|undefined} explicitDealId
 * @returns {Promise<{ dealId: string | null, source: 'explicit' | 'override' | 'motion' | 'fallback', prepType?: import("./types.js").DealType }>}
 */
export async function resolveSelectedDealForAccountView(accountId, actorId, deals, explicitDealId) {
  const list = deals || [];
  if (explicitDealId) {
    const match = list.find((d) => d.id === explicitDealId && d.accountId === accountId);
    if (match) {
      return { dealId: explicitDealId, source: "explicit", prepType: match.type };
    }
  }

  const motion = await resolveEngagementMotion(accountId, actorId, { useSessionContext: true });
  if (motion.dealId) {
    const byId = list.find((d) => d.id === motion.dealId);
    if (byId) {
      const source = motion.source === "account" ? "override" : "motion";
      return { dealId: byId.id, source, prepType: byId.type };
    }
  }

  if (motion.prepType) {
    const byType = list.find((d) => d.status === "active" && d.type === motion.prepType);
    if (byType) {
      return { dealId: byType.id, source: "motion", prepType: byType.type };
    }
    return { dealId: null, source: "motion", prepType: motion.prepType };
  }

  const active = list.find((d) => d.status === "active");
  const fallbackId = active?.id || list[0]?.id || null;
  const fallbackDeal = fallbackId ? list.find((d) => d.id === fallbackId) : null;
  return {
    dealId: fallbackId,
    source: "fallback",
    prepType: fallbackDeal?.type || "new_business",
  };
}

/**
 * Account detail: merged activity, deal team, lens lifecycle for pipeline/artifacts.
 * @param {object} session
 * @param {string} accountId
 * @param {{ lifecycleOwnerId?: string, dealId?: string|null, engagementPrepType?: import("./types.js").DealType }} [options]
 */
export async function getAccountEngagementDetail(session, accountId, options = {}) {
  if (!accountId) return null;

  let user = null;
  try {
    user = await sessionUser(session);
  } catch (err) {
    console.warn("[account-service] sessionUser failed:", accountId, err?.message || err);
    return null;
  }
  if (!user) return null;

  const store = getStore();
  let account = await safeStoreOp("getAccount", () => store.getAccount(accountId), null);
  if (!account) {
    const histRow = findHistoryAccountRow(session, accountId);
    if (histRow) {
      try {
        return await buildAccountEngagementDetailFromHistory(session, accountId, histRow, options);
      } catch (err) {
        console.warn("[account-service] history detail failed:", accountId, err?.message || err);
        return null;
      }
    }
    return null;
  }
  account = await safeStoreOp("backfillAccountSeTeam", () => backfillAccountSeTeam(accountId), account);

  try {
    return await loadAccountEngagementDetailFromStore(session, user, account, accountId, options);
  } catch (err) {
    console.warn("[account-service] engagement detail failed, trying history:", accountId, err?.message || err);
    const histRow = findHistoryAccountRow(session, accountId);
    if (histRow) {
      try {
        return await buildAccountEngagementDetailFromHistory(session, accountId, histRow, options);
      } catch (histErr) {
        console.warn("[account-service] history detail failed:", accountId, histErr?.message || histErr);
        return null;
      }
    }
    return null;
  }
}

async function loadAccountEngagementDetailFromStore(session, user, account, accountId, options = {}) {
  const store = getStore();
  const deals = await safeStoreOp("listDealsForAccount", () => listDealsForAccount(accountId), []);
  let selectedDealId = null;
  /** @type {'explicit' | 'override' | 'motion' | 'fallback'} */
  let engagementSelectionSource = "fallback";
  /** @type {import("./types.js").DealType} */
  let selectedDealType = "new_business";

  if (typeof options.dealId === "string" && options.dealId) {
    selectedDealId = options.dealId;
    engagementSelectionSource = "explicit";
  } else if (options.dealId === null) {
    selectedDealId = null;
    engagementSelectionSource = "explicit";
    if (options.engagementPrepType === "expansion" || options.engagementPrepType === "new_business") {
      selectedDealType = options.engagementPrepType;
    }
  } else {
    const resolved = await resolveSelectedDealForAccountView(accountId, user.id, deals, null);
    selectedDealId = resolved.dealId;
    engagementSelectionSource = resolved.source;
    if (resolved.prepType) selectedDealType = resolved.prepType;
  }

  const selectedDeal = selectedDealId
    ? deals.find((d) => d.id === selectedDealId) || (await store.getDeal?.(selectedDealId))
    : null;
  if (selectedDeal?.type) selectedDealType = selectedDeal.type;
  else if (selectedDealId === null && !options.engagementPrepType) {
    const overrideType = account?.metadata?.engagementOverride?.dealType;
    if (overrideType === "expansion" || overrideType === "new_business") {
      selectedDealType = overrideType;
    }
  }

  const teamLifecycles = await safeStoreOp(
    "listActiveLifecyclesForAccount",
    () => listActiveLifecyclesForAccount(accountId),
    [],
  );
  if (!(await canReadAccountEngagement(user, account, teamLifecycles))) {
    const ownLc = await safeStoreOp(
      "findActiveLifecycle",
      () => store.findActiveLifecycle(user.id, accountId),
      null,
    );
    if (!ownLc) return null;
  }

  const seTeamDisplay = await safeStoreOp(
    "resolveSeTeamDisplay",
    () => resolveSeTeamDisplay(account),
    [],
  );
  const memberIds = seTeamUserIds(account);
  let lensOwnerId = options.lifecycleOwnerId || null;
  if (!lensOwnerId) {
    if (memberIds.includes(user.id)) lensOwnerId = user.id;
    else lensOwnerId = account.primarySeUserId || teamLifecycles[0]?.ownerId || user.id;
  }

  let lensLifecycle = null;
  if (selectedDealId && store.findLifecycleByDealAndOwner) {
    lensLifecycle = await safeStoreOp(
      "findLifecycleByDealAndOwner",
      () => store.findLifecycleByDealAndOwner(selectedDealId, lensOwnerId),
      null,
    );
  }
  if (!lensLifecycle) {
    lensLifecycle =
      teamLifecycles.find((l) => l.ownerId === lensOwnerId) ||
      (await safeStoreOp(
        "findActiveLifecycle",
        () => store.findActiveLifecycle(lensOwnerId, accountId),
        null,
      ));
  }
  if (!lensLifecycle && teamLifecycles.length) {
    lensLifecycle = teamLifecycles[0];
    lensOwnerId = lensLifecycle.ownerId;
  }
  if (!lensLifecycle) return null;

  const lensDetail = await safeStoreOp(
    "getLifecycleDetail",
    () => getLifecycleDetail(lensLifecycle.id),
    null,
  );
  if (!lensDetail) return null;

  const userNameById = new Map(seTeamDisplay.map((m) => [m.seUserId, m.user.displayName]));

  const mergedEvents = [];
  const lifecyclesForEvents = selectedDealId
    ? teamLifecycles.filter((lc) => lc.dealId === selectedDealId)
    : teamLifecycles;
  for (const lc of lifecyclesForEvents.length ? lifecyclesForEvents : teamLifecycles) {
    const evs = await safeStoreOp(
      "listLifecycleEvents",
      () => store.listLifecycleEvents(lc.id),
      [],
    );
    const ownerName = userNameById.get(lc.ownerId) || lc.ownerId;
    const dealLabel = deals.find((d) => d.id === lc.dealId);
    for (const ev of evs) {
      mergedEvents.push({
        ...ev,
        lifecycleOwnerId: lc.ownerId,
        lifecycleOwnerName: ownerName,
        dealId: lc.dealId || null,
        dealLabel: dealLabel ? `${DEAL_TYPE_LABELS[dealLabel.type] || dealLabel.type}` : null,
      });
    }
  }
  mergedEvents.sort((a, b) => b.timestamp - a.timestamp);

  const contacts = await safeStoreOp(
    "listContactsByAccount",
    () => store.listContactsByAccount(accountId),
    [],
  );
  const contactEventsByContactId = await safeStoreOp(
    "loadContactEventsForAccount",
    () => loadContactEventsForAccount(contacts, 10),
    {},
  );

  const canManageTeam = can(user, "manage_account_team", {
    seTeamUserIds: memberIds,
    accountOrgId: lensLifecycle.orgId || user.orgId,
    teamId: user.teamId || undefined,
  });

  let assignableSeOptions = [];
  if (canManageTeam && memberIds.length < MAX_SE_TEAM_SIZE) {
    assignableSeOptions = await listAssignableSeOptions(user, memberIds);
  }

  let dealSummary = null;
  let accountSummary = null;
  if (selectedDealId && store.getDealSummaryByDeal) {
    dealSummary = await safeStoreOp(
      "getDealSummaryByDeal",
      () => store.getDealSummaryByDeal(selectedDealId),
      null,
    );
  }
  if (store.getAccountSummaryByAccount) {
    accountSummary = await safeStoreOp(
      "getAccountSummaryByAccount",
      () => store.getAccountSummaryByAccount(accountId),
      null,
    );
  }

  const accountRollup = await safeStoreOp(
    "loadAccountOverviewRollup",
    () => loadAccountOverviewRollup(store, account, deals, seTeamDisplay, contacts),
    {
      arrRollup: {
        estimateBand: null,
        linesByDealId: new Map(),
        discussedUnquantified: [],
        crossSellGaps: [],
      },
      dealRows: [],
      accountCalls: [],
      firmographics: {},
      reasonForEvaluation: null,
      whyAi: null,
      hasEconomicBuyer: false,
      health: deriveAccountHealth(null, null, account.updatedAt),
      callCount: 0,
      dealCount: (deals || []).length,
    },
  );

  return {
    ...lensDetail,
    account,
    events: mergedEvents,
    contacts,
    contactEventsByContactId,
    seTeamDisplay,
    lifecycleOwnerId: lensOwnerId,
    teamLifecycles,
    deals,
    selectedDealId,
    selectedDeal,
    selectedDealType,
    engagementSelectionSource,
    canManageTeam,
    assignableSeOptions,
    dealSummary,
    accountSummary,
    accountRollup,
  };
}

/**
 * Account overview data: ARR roll-up, calls across deals, firmographics, deal rows.
 * @param {ReturnType<import("./store.js").getStore>} store
 * @param {import("./types.js").Account} account
 * @param {import("./types.js").Deal[]} deals
 * @param {object[]} seTeamDisplay
 * @param {import("./types.js").Contact[]} contacts
 */
async function loadAccountOverviewRollup(store, account, deals, seTeamDisplay, contacts) {
  const arrRollup = await buildAccountArrRollup(store, account.id, deals);

  /** @type {Map<string, string>} */
  const seNameByDealId = new Map();
  for (const deal of deals || []) {
    const primary = (seTeamDisplay || []).find((m) => m.role === "primary") || seTeamDisplay?.[0];
    seNameByDealId.set(deal.id, primary?.user?.displayName || "-");
  }

  const dealRows = await Promise.all(
    (deals || []).map(async (deal) => {
      const signals = store.listDealSignalsByDeal ? await store.listDealSignalsByDeal(deal.id, 1) : [];
      const signal = signals[0] || null;
      const lines = arrRollup.linesByDealId.get(deal.id) || [];
      const base = lines.find((l) => l.kind === "base" && !l.excluded);
      return {
        deal,
        arrPoint: deal.arrEstimatePoint ?? null,
        arrLow: deal.arrEstimateLow ?? deal.arrEstimatePoint ?? null,
        arrHigh: deal.arrEstimateHigh ?? deal.arrEstimatePoint ?? null,
        productLabel: formatProductLabel(base?.product || deal.product),
        traction: signal?.traction || null,
        primarySeName: seNameByDealId.get(deal.id) || "-",
      };
    }),
  );

  const postCalls = store.listPostCallsByAccount ? await store.listPostCallsByAccount(account.id, 100) : [];
  const accountCalls = await Promise.all(
    postCalls.map(async (postCall) => {
      const deal = deals.find((d) => d.id === postCall.dealId);
      const med = deal ? resolveDealMeddpicc(deal, account) : null;
      const scorecards = store.listScorecardsByCall ? await store.listScorecardsByCall(postCall.id) : [];
      const scorecard = scorecards[0] || null;
      const ownerName =
        seTeamDisplay.find((m) => m.seUserId === postCall.ownerId)?.user?.displayName ||
        seTeamDisplay[0]?.user?.displayName ||
        "-";
      return {
        postCall,
        deal,
        dealLabel: deal?.title || (deal ? DEAL_TYPE_LABELS[deal.type] : "-"),
        meddpiccScore: med?.completionScore ?? null,
        scorecard,
        ownerName,
      };
    }),
  );

  accountCalls.sort((a, b) => (b.postCall.createdAt || 0) - (a.postCall.createdAt || 0));

  const meta = account.metadata || {};
  const firmographics = {
    industry: account.industry || meta.industry || "-",
    region: meta.region || "-",
    subRegion: meta.sub_region || meta.subRegion || "-",
    hq: meta.hq || meta.headquarters || "-",
    supportAgents: meta.support_agent_count ?? meta.supportAgentCount ?? "-",
    incumbent: meta.incumbent || "-",
    competitor: meta.competitor || "Unknown",
  };

  let reasonForEvaluation = meta.reason_for_evaluation || meta.reasonForEvaluation || null;
  let whyAi = meta.why_ai || meta.whyAi || null;
  if ((!reasonForEvaluation || !whyAi) && store.getTechnicalCommitByDeal) {
    for (const deal of deals || []) {
      const tc = await store.getTechnicalCommitByDeal(deal.id);
      if (!reasonForEvaluation && tc?.reasonForEvaluation) {
        reasonForEvaluation = tc.reasonForEvaluation?.value ?? tc.reasonForEvaluation;
      }
      if (!whyAi && tc?.whyAi) {
        whyAi = tc.whyAi?.value ?? tc.whyAi;
      }
      if (reasonForEvaluation && whyAi) break;
    }
  }

  const hasEconomicBuyer = (contacts || []).some(
    (c) => c.metadata?.influence?.decisionRole === "economic_buyer",
  ) || (deals || []).some((deal) => {
    const med = resolveDealMeddpicc(deal, account);
    return med?.economicBuyer?.value && med.economicBuyer.status !== "unknown";
  });

  const activeDeals = (deals || []).filter((d) => d.status === "active");
  let worstTraction = null;
  let maxDaysSilent = null;
  for (const deal of activeDeals) {
    const signals = store.listDealSignalsByDeal ? await store.listDealSignalsByDeal(deal.id, 1) : [];
    const signal = signals[0];
    if (signal?.traction) {
      if (!worstTraction || tractionSortRank(signal.traction) > tractionSortRank(worstTraction)) {
        worstTraction = signal.traction;
      }
    }
    if (signal?.daysSilent != null) {
      maxDaysSilent = Math.max(maxDaysSilent ?? 0, signal.daysSilent);
    }
  }

  return {
    arrRollup,
    dealRows,
    accountCalls,
    firmographics,
    reasonForEvaluation,
    whyAi,
    hasEconomicBuyer,
    health: deriveAccountHealth(worstTraction, maxDaysSilent, account.updatedAt),
    callCount: accountCalls.length,
    dealCount: activeDeals.length || (deals || []).length,
  };
}

/**
 * Persist account-level engagement override (managers or deal team with manage_account_team).
 * @param {object} session
 * @param {string} accountId
 * @param {{ dealType?: 'new_business'|'expansion', dealId?: string|null, clear?: boolean }} payload
 */
export async function setAccountEngagementOverride(session, accountId, payload = {}) {
  const user = await sessionUser(session);
  if (!user || !accountId) return { success: false, error: "Unauthorized" };

  const store = getStore();
  let account = await backfillAccountSeTeam(accountId);
  if (!account) return { success: false, error: "Account not found" };

  const memberIds = seTeamUserIds(account);
  const canManage =
    memberIds.includes(user.id) ||
    can(user, "manage_account_team", {
      seTeamUserIds: memberIds,
      accountOrgId: user.orgId,
      teamId: user.teamId || undefined,
    }) ||
    user.role === "admin";

  if (!canManage) return { success: false, error: "Not allowed" };

  const ts = now();
  const metadata = { ...(account.metadata || {}) };

  if (payload.clear) {
    delete metadata.engagementOverride;
  } else {
    /** @type {{ dealType?: string, dealId?: string|null, updatedAt: number, updatedBy: string }} */
    const override = {
      ...(metadata.engagementOverride || {}),
      updatedAt: ts,
      updatedBy: user.id,
    };
    if (payload.dealType === "expansion" || payload.dealType === "new_business") {
      override.dealType = payload.dealType;
    }
    if (payload.dealId !== undefined) {
      override.dealId = payload.dealId;
    }
    metadata.engagementOverride = override;
  }

  account = await store.updateAccount(accountId, { metadata, updatedAt: ts });
  return { success: true, account };
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
  if (!research?.lastResearchedAt) return null;
  if ((research.playbookVersion || "1") !== PREP_PLAYBOOK_VERSION) return null;
  if (Date.now() - research.lastResearchedAt > RESEARCH_TTL_MS) return null;
  if (research.inputHash === inputHash) return research;
  // Domain-soft cache: reuse account research when AE context or PDFs changed.
  if ((research.facts?.length ?? 0) >= 8) return research;
  return null;
}

/** Simple input hash matching worker (must stay in sync). */
export function computePrepInputHash(
  companyName,
  companyDomain,
  emails,
  linkedinFingerprint = "",
  options = {},
) {
  return computePrepInputHashImpl(companyName, companyDomain, emails, linkedinFingerprint, options);
}
