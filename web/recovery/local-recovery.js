/**
 * Local browser data sync — scans localStorage and uploads to server.
 * User-facing copy uses "Update"; this module is internal ops naming.
 */

import { WORKER_BASE_URL } from "../firebase-config.js";
import {
  STORAGE_PREFIX,
  fetchHistoryFromWorker,
  mergeHistoryLists,
  pushRemoteEntries,
  storageKey,
  normalizeUserEmail,
} from "../history.js";
import { TASKS_STORAGE_PREFIX } from "../tasks.js";
import { linkPostCallToLifecycle } from "../domain/dual-write.js";
import { getStore } from "../domain/store.js";
import { sessionUserId } from "../domain/session.js";
import { callIdentityKey } from "../call-identity.js";
import { syncSessionWithDomainStore } from "../auth.js";

export const SYNC_VERSION = "1";
const LEGACY_PREFIX = "se-sp-postcalls:";
const STATUS_PREFIX = "lionpath_sync_status:";
const BRIEFS_KEY = "lionpath_briefs";
const FEEDBACK_KEY = "lionpath_feedback";
const PREP_DISPUTES_KEY = "se-prep-disputes";
const SCORE_DISPUTES_KEY = "se-score-disputes";
const SCORE_OVERRIDES_KEY = "se-score-overrides";
const BATCH_SIZE = 10;
const UPLOAD_DELAY_MS = 500;

/** @type {(() => Promise<string | null>) | null} */
let getAuthToken = null;

/** @param {() => Promise<string | null>} fn */
export function setLocalSyncAuthGetter(fn) {
  getAuthToken = fn;
}

function statusKey(email) {
  return `${STATUS_PREFIX}${normalizeUserEmail(email)}`;
}

function readJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function readPostCallList(email) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) return [];
  const primary = readJson(storageKey(normalized), []);
  const legacy = readJson(`${LEGACY_PREFIX}${normalized}`, []);
  return mergeHistoryLists(
    Array.isArray(primary) ? primary : [],
    Array.isArray(legacy) ? legacy : [],
  );
}

/**
 * @param {string} email
 * @returns {{
 *   postCalls: object[],
 *   prepBriefs: object[],
 *   tasks: object[],
 *   feedback: object[],
 *   disputes: { prep: object[], score: object[], scoreOverrides: object[] },
 *   scannedKeys: string[],
 * }}
 */
export function scanLocalData(email) {
  const normalized = normalizeUserEmail(email);
  const scannedKeys = [];
  const postCalls = readPostCallList(normalized);
  if (postCalls.length) {
    scannedKeys.push(storageKey(normalized));
    if (localStorage.getItem(`${LEGACY_PREFIX}${normalized}`)) {
      scannedKeys.push(`${LEGACY_PREFIX}${normalized}`);
    }
  }

  const prepBriefsRaw = readJson(BRIEFS_KEY, []);
  const prepBriefs = Array.isArray(prepBriefsRaw) ? prepBriefsRaw : [];
  if (prepBriefs.length) scannedKeys.push(BRIEFS_KEY);

  const tasksKey = `${TASKS_STORAGE_PREFIX}${normalized}`;
  const tasksRaw = readJson(tasksKey, []);
  const tasks = Array.isArray(tasksRaw) ? tasksRaw : [];
  if (tasks.length) scannedKeys.push(tasksKey);

  const feedbackRaw = readJson(FEEDBACK_KEY, []);
  const feedback = Array.isArray(feedbackRaw) ? feedbackRaw : [];
  if (feedback.length) scannedKeys.push(FEEDBACK_KEY);

  const prepDisputes = readJson(PREP_DISPUTES_KEY, []);
  const scoreDisputes = readJson(SCORE_DISPUTES_KEY, []);
  const scoreOverrides = readJson(SCORE_OVERRIDES_KEY, []);
  const disputes = {
    prep: Array.isArray(prepDisputes) ? prepDisputes : [],
    score: Array.isArray(scoreDisputes) ? scoreDisputes : [],
    scoreOverrides: Array.isArray(scoreOverrides) ? scoreOverrides : [],
  };
  if (disputes.prep.length) scannedKeys.push(PREP_DISPUTES_KEY);
  if (disputes.score.length) scannedKeys.push(SCORE_DISPUTES_KEY);
  if (disputes.scoreOverrides.length) scannedKeys.push(SCORE_OVERRIDES_KEY);

  return { postCalls, prepBriefs, tasks, feedback, disputes, scannedKeys };
}

/**
 * @param {object[]} local
 * @param {object[]} remote
 */
export function diffAgainstRemote(local, remote) {
  const remoteIds = new Set((remote || []).map((r) => r.id));
  return (local || []).filter((r) => r?.id && !remoteIds.has(r.id));
}

function readSyncStatus(email) {
  return readJson(statusKey(email), null);
}

function writeSyncStatus(email, status) {
  try {
    localStorage.setItem(statusKey(email), JSON.stringify(status));
  } catch {
    /* quota */
  }
}

/**
 * @param {string} email
 * @param {{ force?: boolean }} [opts]
 */
export async function needsSyncUpdate(email, opts = {}) {
  const normalized = normalizeUserEmail(email);
  if (!normalized) return false;

  const bundle = scanLocalData(normalized);
  const hasLocal =
    bundle.postCalls.length ||
    bundle.prepBriefs.length ||
    bundle.tasks.length ||
    bundle.feedback.length ||
    bundle.disputes.prep.length ||
    bundle.disputes.score.length ||
    bundle.disputes.scoreOverrides.length;
  if (!hasLocal) return false;

  if (opts.force) return true;

  const status = readSyncStatus(normalized);
  if (status?.completed && status?.version === SYNC_VERSION) {
    const allIds = bundle.postCalls.map((r) => r.id);
    const uploaded = new Set(status.uploadedIds || []);
    if (allIds.every((id) => uploaded.has(id))) return false;
  }

  try {
    const remote = await fetchHistoryFromWorker(normalized);
    const localOnly = diffAgainstRemote(bundle.postCalls, remote);
    if (localOnly.length) return true;
  } catch {
    return bundle.postCalls.length > 0;
  }

  return (
    bundle.prepBriefs.length > 0 ||
    bundle.tasks.length > 0 ||
    bundle.feedback.length > 0 ||
    bundle.disputes.prep.length > 0 ||
    bundle.disputes.score.length > 0 ||
    bundle.disputes.scoreOverrides.length > 0
  );
}

async function syncHeaders() {
  const headers = { "content-type": "application/json" };
  if (getAuthToken) {
    try {
      const token = await getAuthToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {
      /* demo mode */
    }
  }
  return headers;
}

function recordToPayload(record) {
  const analysis = record?.analysis || {};
  return {
    recordingUrl: record?.zoomLink || "",
    companyName:
      analysis?.callHeader?.company ||
      analysis?.callHeader?.account ||
      record?.title?.split("-")[0]?.trim() ||
      "",
    dealId: record?.dealId || null,
    accountId: record?.accountId || null,
    callType: record?.callType || null,
    createNewDeal: record?.createNewDeal,
    newDealTitle: record?.newDealTitle,
    newDealType: record?.newDealType,
    confirmedIdentities: record?.confirmedIdentities || null,
  };
}

function recordToData(record) {
  const result = record?.result || {};
  return {
    analysis: record?.analysis || result?.analysis || null,
    scorecard: record?.scorecard || result?.scorecard || null,
    transcriptMeta: record?.transcriptMeta || result?.transcriptMeta || null,
    pass6: record?.pass6 || result?.pass6 || null,
    arrCompute: result?.arrCompute || null,
    summarise: result?.summarise || null,
    confirmed: result?.confirmed || record?.confirmed || null,
    analysisMeta: record?.analysisMeta || result?.analysisMeta || null,
  };
}

/**
 * @param {object} session
 * @param {object} record
 */
async function backfillFirestoreForRecord(session, record) {
  if (!record?.analysis && !record?.result?.analysis) return { skipped: true };
  const payload = recordToPayload(record);
  const data = recordToData(record);
  let activeSession = session;
  try {
    activeSession = (await syncSessionWithDomainStore(session)) || session;
  } catch (err) {
    console.warn("[local-sync] session enrich before dual-write failed:", err?.message || err);
  }
  try {
    const linked = await linkPostCallToLifecycle(activeSession, payload, data, record);
    return { linked: !!linked, recordId: record.id };
  } catch (err) {
    console.warn("[local-sync] dual-write failed for", record.id, err?.message || err);
    return { linked: false, recordId: record.id, error: err?.message || String(err) };
  }
}

async function ensureDomainBackedRecord(session, record) {
  if (!record?.analysis && !record?.result?.analysis) return { skipped: true, recordId: record?.id };
  let activeSession = session;
  try {
    activeSession = (await syncSessionWithDomainStore(session)) || session;
  } catch (err) {
    console.warn("[local-sync] session enrich before domain check failed:", err?.message || err);
  }

  const ownerId = sessionUserId(activeSession);
  const identityKey = record.callIdentityKey || callIdentityKey(record);
  if (ownerId && identityKey) {
    try {
      const store = getStore();
      const existing = await store.findPostCallByIdentity?.(ownerId, identityKey);
      if (existing?.id) {
        return { linked: true, existing: true, recordId: record.id, postCallId: existing.id };
      }
    } catch (err) {
      console.warn("[local-sync] domain identity check failed for", record.id, err?.message || err);
    }
  }

  return backfillFirestoreForRecord(activeSession, record);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} session
 * @param {{
 *   force?: boolean,
 *   onProgress?: (msg: string) => void,
 * }} [opts]
 */
export async function runLocalSync(session, opts = {}) {
  const email = normalizeUserEmail(session?.email);
  if (!email) {
    return { ok: false, error: "No signed-in email." };
  }

  const onProgress = opts.onProgress || (() => {});
  const bundle = scanLocalData(email);
  const result = {
    ok: true,
    email,
    postCallsUploaded: 0,
    ancillaryUploaded: false,
    firestoreLinked: 0,
    firestoreFailed: 0,
    uploadedIds: [],
    failedIds: [],
  };

  onProgress("Checking your summaries…");

  let remote = [];
  try {
    remote = await fetchHistoryFromWorker(email);
  } catch (err) {
    console.warn("[local-sync] remote fetch failed:", err?.message || err);
  }

  const localOnly = diffAgainstRemote(bundle.postCalls, remote);
  const uploadCandidates = opts.force
    ? bundle.postCalls
    : localOnly.length
      ? localOnly
      : [];

  const domainResults = new Map();
  const toUpload = [];
  if (uploadCandidates.length) {
    onProgress(`Reconciling your summaries… (0/${uploadCandidates.length})`);
    for (const record of uploadCandidates) {
      const domain = await ensureDomainBackedRecord(session, record);
      domainResults.set(record.id, domain);
      if (domain.existing) {
        result.uploadedIds.push(record.id);
      } else if (domain.linked) {
        toUpload.push(record);
        result.firestoreLinked += 1;
      } else if (!domain.skipped) {
        result.ok = false;
        result.firestoreFailed += 1;
        result.failedIds.push(record.id);
      }
    }
  }

  if (toUpload.length) {
    onProgress(`Saving your summaries… (0/${toUpload.length})`);
    for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
      const batch = toUpload.slice(i, i + BATCH_SIZE);
      const merged = mergeHistoryLists(remote, batch);
      try {
        await pushRemoteEntries(email, merged);
        remote = merged;
        result.postCallsUploaded += batch.length;
        result.uploadedIds.push(...batch.map((r) => r.id));
        onProgress(`Saving your summaries… (${Math.min(i + batch.length, toUpload.length)}/${toUpload.length})`);
      } catch (err) {
        result.ok = false;
        result.failedIds.push(...batch.map((r) => r.id));
        console.warn("[local-sync] batch upload failed:", err?.message || err);
      }
      if (i + BATCH_SIZE < toUpload.length) await delay(UPLOAD_DELAY_MS);
    }
  }

  const hasAncillary =
    bundle.prepBriefs.length ||
    bundle.tasks.length ||
    bundle.feedback.length ||
    bundle.disputes.prep.length ||
    bundle.disputes.score.length ||
    bundle.disputes.scoreOverrides.length;

  if (hasAncillary) {
    onProgress("Updating your workspace…");
    try {
      const res = await fetch(`${WORKER_BASE_URL}/api/recovery/upload`, {
        method: "POST",
        headers: await syncHeaders(),
        body: JSON.stringify({
          email,
          prepBriefs: bundle.prepBriefs,
          tasks: bundle.tasks,
          feedback: bundle.feedback,
          disputes: bundle.disputes,
          clientMeta: {
            userAgent: navigator.userAgent,
            recoveryVersion: SYNC_VERSION,
            scannedKeys: bundle.scannedKeys,
          },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Update failed (${res.status})`);
      }
      result.ancillaryUploaded = true;
    } catch (err) {
      result.ok = false;
      console.warn("[local-sync] ancillary upload failed:", err?.message || err);
    }
  }

  const forFirestore = toUpload.filter(
    (r) => (r?.analysis || r?.result?.analysis) && !domainResults.get(r.id)?.linked && !domainResults.get(r.id)?.existing,
  );
  if (forFirestore.length) {
    onProgress("Finishing up…");
    for (const record of forFirestore) {
      const fb = await backfillFirestoreForRecord(session, record);
      if (fb.linked) result.firestoreLinked += 1;
      else if (!fb.skipped) result.firestoreFailed += 1;
      await delay(300);
    }
  }

  writeSyncStatus(email, {
    lastRun: Date.now(),
    completed: result.ok,
    version: SYNC_VERSION,
    uploadedIds: result.uploadedIds,
    failedIds: result.failedIds,
  });

  onProgress(result.ok ? "You're all set." : "Update didn't finish — try again.");
  return result;
}

/**
 * Silent background sync on login — no UI, no SE-facing prompts.
 * Runs automatically when local data exists that isn't on the server yet.
 * @param {object} session
 * @param {{ force?: boolean }} [opts]
 */
export async function autoSyncOnLogin(session, opts = {}) {
  if (!session?.email) return null;
  try {
    const needed = await needsSyncUpdate(session.email, { force: opts.force });
    if (!needed) return null;
    console.info(`[local-sync] background sync starting for ${session.email}`);
    const result = await runLocalSync(session, {
      force: opts.force,
      onProgress: () => {},
    });
    console.info("[local-sync] background sync finished", {
      email: result.email,
      postCallsUploaded: result.postCallsUploaded,
      firestoreLinked: result.firestoreLinked,
      ok: result.ok,
    });
    return result;
  } catch (err) {
    console.warn("[local-sync] background sync failed:", err?.message || err);
    return null;
  }
}

/** Alias for tests and app boot. */
export const runLocalRecovery = runLocalSync;
export const needsRecovery = needsSyncUpdate;
