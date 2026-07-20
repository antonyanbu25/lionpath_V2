/**
 * Lifecycle aggregate root — getOrCreate, attach artifacts, stage transitions.
 */

import { getStore } from "./store.js";
import { newId, now, stageAfterFirstPostCall } from "./types.js";
import { sessionUserId } from "./session.js";

/**
 * Get or create an active lifecycle for (ownerId, accountId).
 * @param {string} ownerId
 * @param {string} accountId
 * @param {string} teamId
 * @param {{ title?: string, primaryContactId?: string|null, actorId?: string, orgId?: string|null }} [opts]
 */
export async function getOrCreateLifecycle(ownerId, accountId, teamId, opts = {}) {
  const store = getStore();
  const existing = await store.findActiveLifecycle(ownerId, accountId);
  if (existing) return existing;

  const ts = now();
  const lifecycle = await store.createLifecycle({
    id: newId("lifecycle"),
    ownerId,
    teamId,
    orgId: opts.orgId || null,
    accountId,
    primaryContactId: opts.primaryContactId ?? null,
    stage: "research",
    status: "active",
    title: opts.title || "Account",
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
    prepCount: 0,
    postCallCount: 0,
    openTaskCount: 0,
    latestQualityScore: null,
  });

  await store.addLifecycleEvent({
    id: newId("event"),
    lifecycleId: lifecycle.id,
    type: "lifecycle_created",
    actorId: opts.actorId || ownerId,
    timestamp: ts,
    payload: { accountId, teamId, orgId: opts.orgId || null },
  });

  return lifecycle;
}

/** Attach a prep brief to a lifecycle. */
export async function attachPrep(lifecycleId, prepBrief, actorId) {
  const store = getStore();
  const ts = now();
  const saved = await store.createPrepBrief({ ...prepBrief, lifecycleId, createdAt: prepBrief.createdAt || ts });

  const lifecycle = await store.getLifecycle(lifecycleId);
  if (lifecycle) {
    await store.updateLifecycle(lifecycleId, {
      prepCount: (lifecycle.prepCount || 0) + 1,
      lastActivityAt: ts,
      primaryContactId: lifecycle.primaryContactId || prepBrief.primaryContactId || null,
    });
  }

  await store.addLifecycleEvent({
    id: newId("event"),
    lifecycleId,
    type: "prep_generated",
    actorId: actorId || prepBrief.ownerId,
    timestamp: ts,
    payload: { prepBriefId: saved.id, company: prepBrief.meta?.company },
  });

  return saved;
}

/**
 * Attach or upsert a post-call analysis (dedupe by callIdentityKey).
 * Auto-advances research → discovery on first post-call.
 */
export async function attachPostCall(lifecycleId, postCall, actorId) {
  const store = getStore();
  const ts = now();

  const existing = postCall.callIdentityKey
    ? await store.findPostCallByIdentity(postCall.ownerId, postCall.callIdentityKey)
    : null;

  let saved;
  let isNew = false;

  if (existing) {
    saved = await store.upsertPostCall({
      ...existing,
      ...postCall,
      lifecycleId,
      updatedAt: ts,
    });
  } else {
    isNew = true;
    saved = await store.upsertPostCall({
      ...postCall,
      id: postCall.id || newId("postCall"),
      lifecycleId,
      createdAt: postCall.createdAt || ts,
      updatedAt: ts,
    });
  }

  const lifecycle = await store.getLifecycle(lifecycleId);
  if (lifecycle) {
    const patch = {
      lastActivityAt: ts,
      latestQualityScore: postCall.qualityScore ?? lifecycle.latestQualityScore,
    };
    if (isNew) {
      patch.postCallCount = (lifecycle.postCallCount || 0) + 1;
      patch.stage = stageAfterFirstPostCall(lifecycle.stage);
    }
    await store.updateLifecycle(lifecycleId, patch);

    if (isNew && lifecycle.stage === "research") {
      await store.addLifecycleEvent({
        id: newId("event"),
        lifecycleId,
        type: "stage_changed",
        actorId: actorId || postCall.ownerId,
        timestamp: ts,
        payload: { fromStage: "research", toStage: "discovery", reason: "first_postcall" },
      });
    }
  }

  await store.addLifecycleEvent({
    id: newId("event"),
    lifecycleId,
    type: "postcall_analyzed",
    actorId: actorId || postCall.ownerId,
    timestamp: ts,
    payload: {
      postCallId: saved.id,
      callIdentityKey: postCall.callIdentityKey,
      qualityScore: postCall.qualityScore,
      isNew,
    },
  });

  return saved;
}

/** Manually advance lifecycle stage. */
export async function advanceStage(lifecycleId, toStage, actorId) {
  const store = getStore();
  const lifecycle = await store.getLifecycle(lifecycleId);
  if (!lifecycle || lifecycle.stage === toStage) return lifecycle;

  const ts = now();
  await store.updateLifecycle(lifecycleId, { stage: toStage, lastActivityAt: ts });
  await store.addLifecycleEvent({
    id: newId("event"),
    lifecycleId,
    type: "stage_changed",
    actorId,
    timestamp: ts,
    payload: { fromStage: lifecycle.stage, toStage },
  });

  return store.getLifecycle(lifecycleId);
}

/** Attach a task to a lifecycle. */
export async function attachTask(lifecycleId, task, actorId) {
  const store = getStore();
  const ts = now();
  const saved = await store.createTask({ ...task, lifecycleId, createdAt: task.createdAt || ts });

  const lifecycle = await store.getLifecycle(lifecycleId);
  if (lifecycle && saved.status !== "completed" && saved.status !== "dismissed") {
    await store.updateLifecycle(lifecycleId, {
      openTaskCount: (lifecycle.openTaskCount || 0) + 1,
      lastActivityAt: ts,
    });
  }

  await store.addLifecycleEvent({
    id: newId("event"),
    lifecycleId,
    type: "task_created",
    actorId: actorId || task.ownerId,
    timestamp: ts,
    payload: { taskId: saved.id, title: saved.title },
  });

  return saved;
}

/** List lifecycles for current user or team. */
export async function listLifecyclesForUser(session) {
  const store = getStore();
  const ownerId = sessionUserId(session);
  if (!ownerId) return [];
  return store.listLifecyclesByOwner(ownerId);
}

export async function listLifecyclesForTeam(teamId) {
  const store = getStore();
  if (!teamId) return [];
  return store.listLifecyclesByTeam(teamId);
}

/** Load lifecycle detail with related artifacts. */
export async function getLifecycleDetail(lifecycleId) {
  const store = getStore();
  const lifecycle = await store.getLifecycle(lifecycleId);
  if (!lifecycle) return null;

  const [account, events, preps, postCalls, tasks] = await Promise.all([
    store.getAccount(lifecycle.accountId),
    store.listLifecycleEvents(lifecycleId),
    store.listPrepBriefsByLifecycle(lifecycleId),
    store.listPostCallsByLifecycle(lifecycleId),
    store.listTasksByLifecycle(lifecycleId),
  ]);

  return { lifecycle, account, events, preps, postCalls, tasks };
}
