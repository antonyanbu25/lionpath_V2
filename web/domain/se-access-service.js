/**
 * SE profile access — RBAC at the data layer (spec §11.8, §12.5).
 * SE sees own profile; manager sees team; nobody sideways.
 */

import { getPostCallAnalysis, mergeHistoryLists, syncHistoryOnLogin, listPostCallAnalyses } from "../history.js";
import { dedupeAnalysesByCallIdentity } from "../call-identity.js";
import {
  postCallRecordsToAnalyses,
  fetchAndHydratePostCallAnalyses,
  loadTeamCallSummariesFromStore,
} from "./postcall-hydrate.js";
import { callSummariesToAnalyses } from "./call-summary.js";
import { listAccountsForSession } from "./account-service.js?v=2.1.14";
import { canSessionAction, sessionToUser } from "./rbac.js";
import { isManagerRole } from "./types.js";
import { getStore } from "./store.js";
import { normalizeUserEmail } from "../shared.js";
import { stableUserIdForEmail as dummyUidForEmail } from "./id.js";
import { resolveEffectiveOwnerId } from "./user-resolve.js";
import { themeAverage } from "../quality-score.js";

const COACHING_AGG_OPTS = { requireHighConfidence: true };

/** @param {string} email */
export function normalizeSeEmail(email) {
  return normalizeUserEmail(email);
}

/** @param {object|null} session @param {string} targetEmail */
export async function canViewSeProfile(session, targetEmail) {
  const target = normalizeSeEmail(targetEmail);
  if (!target || !session?.email) return false;

  const self = normalizeSeEmail(session.email);
  if (target === self) return true;

  const user = sessionToUser(session);
  if (!user || !isManagerRole(user.role)) return false;

  try {
    const teamEmails = await listTeamSeEmailsAsync(session);
    return teamEmails.map(normalizeSeEmail).includes(target);
  } catch {
    return false;
  }
}

/** @param {object|null} session @param {string} targetEmail */
export async function assertSeProfileAccess(session, targetEmail) {
  const ok = await canViewSeProfile(session, targetEmail);
  if (!ok) throw new Error("You do not have access to this SE profile.");
  return true;
}

/** @param {string} email */
async function resolveUidForEmail(email) {
  const normalized = normalizeSeEmail(email);
  const store = getStore();
  const user = await store.getUserByEmail(normalized);
  return user?.id || dummyUidForEmail(normalized);
}

/**
 * Load a post-call record with RBAC — managers read team SE history by owner email.
 * @param {object|null} session
 * @param {string} callId
 * @param {string} [ownerEmail]
 */
export async function getPostCallForSession(session, callId, ownerEmail) {
  if (!session?.email || !callId) return null;

  const self = normalizeSeEmail(session.email);
  const owner = ownerEmail ? normalizeSeEmail(ownerEmail) : self;

  if (owner !== self) {
    if (!(await canViewSeProfile(session, owner))) return null;
  }

  const local = getPostCallAnalysis(owner, callId);
  if (local) return local;

  const store = getStore();
  if (!store.getPostCall) return null;
  try {
    const postCall = await store.getPostCall(callId);
    if (!postCall) return null;
    const ownerUid = await resolveUidForEmail(owner);
    if (postCall.ownerId && postCall.ownerId !== ownerUid) return null;
    const [analysis] = await fetchAndHydratePostCallAnalyses(
      postCallRecordsToAnalyses([postCall]),
      store,
    );
    return analysis || null;
  } catch (err) {
    console.warn("[se-access] Firestore postCall fallback failed:", err?.message || err);
    return null;
  }
}

/**
 * Load post-call analyses for a session — merges Firestore callSummaries, worker history, and local cache.
 * @param {object|null} session
 * @param {{ teamScope?: boolean, resolveOwnerFb?: object, fetchRemoteHistory?: () => Promise<object[]>, syncRemoteHistory?: boolean, limit?: number }} [opts]
 */
export async function loadCallAnalysesForSession(session, opts = {}) {
  if (!session?.email) return [];

  const email = normalizeSeEmail(session.email);
  const dedupeByIdentity = opts.dedupeByCallIdentity !== false;
  let localRecords = listPostCallAnalyses(email);

  if (opts.syncRemoteHistory !== false) {
    try {
      if (typeof opts.fetchRemoteHistory === "function") {
        const synced = await opts.fetchRemoteHistory();
        if (Array.isArray(synced)) localRecords = synced;
      } else {
        localRecords = await syncHistoryOnLogin(email);
      }
    } catch (err) {
      console.warn("[se-access] history sync failed:", err?.message || err);
    }
  }

  const user = sessionToUser(session);
  const teamScope = opts.teamScope === true && user && isManagerRole(user.role);

  if (teamScope) {
    const teamRecords = await loadTeamCallSummariesFromStore(session);
    const merged = mergeHistoryLists(teamRecords, localRecords);
    return dedupeByIdentity ? dedupeAnalysesByCallIdentity(merged) : merged;
  }

  const store = getStore();
  const ownerId = await resolveEffectiveOwnerId(session, store, opts.resolveOwnerFb);
  let firestoreRecords = [];

  if (ownerId) {
    /** @type {object[]} */
    const mergedFirestore = [];
    if (store.listCallSummariesByOwner) {
      try {
        const summaries = await store.listCallSummariesByOwner(ownerId, opts.limit || 200);
        mergedFirestore.push(...callSummariesToAnalyses(summaries));
      } catch (err) {
        console.warn("[se-access] callSummaries load failed:", err?.message || err);
      }
    }
    // Many production calls exist only in postCalls — dual-write did not always write callSummaries.
    if (store.listPostCallsByOwner) {
      try {
        const postCalls = await store.listPostCallsByOwner(ownerId, opts.limit || 200);
        mergedFirestore.push(...postCallRecordsToAnalyses(postCalls));
      } catch (err) {
        console.warn("[se-access] postCalls load failed:", err?.message || err);
      }
    }
    try {
      firestoreRecords = await fetchAndHydratePostCallAnalyses(
        dedupeAnalysesByCallIdentity(mergedFirestore),
        store,
      );
    } catch (err) {
      console.warn("[se-access] call hydrate failed:", err?.message || err);
      firestoreRecords = dedupeAnalysesByCallIdentity(mergedFirestore);
    }
  }

  const merged = mergeHistoryLists(firestoreRecords, localRecords);
  return dedupeByIdentity ? dedupeAnalysesByCallIdentity(merged) : merged;
}

/**
 * All analyses visible for a session — own history or merged team history for managers.
 * @param {object|null} session
 * @param {{ teamScope?: boolean, resolveOwnerFb?: object, fetchRemoteHistory?: () => Promise<object[]>, syncRemoteHistory?: boolean }} [opts]
 */
export async function listAnalysesForSession(session, opts = {}) {
  return loadCallAnalysesForSession(session, opts);
}

/** @param {object|null} session @param {string} targetEmail */
export async function listAccountsForSeProfile(session, targetEmail) {
  if (!(await canViewSeProfile(session, targetEmail))) return [];

  const targetUid = await resolveUidForEmail(targetEmail);
  const rows = await listAccountsForSession(session);

  return rows.filter((row) => {
    const team = row.account?.seTeam || [];
    const onTeam = team.some((m) => m.seUserId === targetUid);
    const isPrimary = row.account?.primarySeUserId === targetUid;
    const ownsLc = row.lifecycle?.ownerId === targetUid;
    return onTeam || isPrimary || ownsLc;
  });
}

function callHasNoNextStep(rec) {
  const mom = rec.analysis?.momentum?.status || "";
  const steps = rec.analysis?.nextSteps;
  const emptySteps =
    steps == null ||
    (Array.isArray(steps) && steps.length === 0) ||
    (typeof steps === "object" && !Array.isArray(steps) && Object.keys(steps).length === 0);
  return /stalled|risk/i.test(mom) || emptySteps;
}

/** @param {object[]} records @param {string} [filter] */
export function filterCallRecordsForList(records, filter) {
  if (!filter || filter === "all") return records;
  if (filter === "no-next-step") return records.filter(callHasNoNextStep);
  if (filter === "scored") {
    return records.filter((r) => r.analysis?.qualityCoach || r.result?.scorecard?.lines?.length);
  }
  return records;
}

/** @param {object[]} dealRows @param {string} [filter] */
export function filterDealRowsForList(dealRows, filter) {
  if (!filter || filter === "all") return dealRows;
  if (filter === "cold") return dealRows.filter((r) => r.traction === "cold");
  return dealRows;
}

/** @param {object[]} dealRows @param {import("./store.js").Store} store */
export async function enrichDealRowsWithTraction(store, dealRows) {
  return Promise.all(
    dealRows.map(async (row) => {
      const signals = store.listDealSignalsByDeal
        ? await store.listDealSignalsByDeal(row.deal.id, 1)
        : [];
      return { ...row, traction: signals[0]?.traction || null };
    }),
  );
}

/**
 * Team-wide theme averages for comparison on SE detail.
 * @param {Map<string, object[]>} seScorecardsByEmail
 */
export function buildTeamThemeAverages(seScorecardsByEmail) {
  const all = [];
  for (const scorecards of seScorecardsByEmail.values()) {
    all.push(...scorecards);
  }
  const keys = [...new Set(all.flatMap((sc) => (sc.lines || []).map((l) => l.themeKey)))];
  const map = new Map();
  for (const key of keys) {
    map.set(key, themeAverage(all, key, null, COACHING_AGG_OPTS).score);
  }
  return map;
}

/** @param {object|null} session @param {string} accountId */
export async function canSessionReadAccount(session, accountId) {
  const store = getStore();
  const account = await store.getAccount(accountId);
  if (!account) return false;

  const user = sessionToUser(session);
  if (!user) return false;

  const seTeamUserIds = (account.seTeam || []).map((m) => m.seUserId);
  return canSessionAction(session, "read_account", {
    ownerId: account.primarySeUserId,
    seTeamUserIds,
    accountOrgId: account.orgId || user.orgId,
  });
}
