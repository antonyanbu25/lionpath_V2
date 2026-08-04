/**
 * Lifecycle aggregate root — getOrCreate, attach artifacts, stage transitions.
 */

import { getStore } from "./store.js";
import { newId, now, stageAfterFirstPostCall } from "./types.js";
import { sessionUserId } from "./session.js";
import {
  resolveDealForEngagement,
  ensureDealForLifecycle,
  bumpDealAfterPrep,
  bumpDealAfterPostCall,
  bumpDealAfterTask,
  advanceDealStage,
  createDealWithExplicitTitle,
} from "./deal-service.js";

/**
 * Get or create an active lifecycle for (ownerId, accountId).
 * @param {string} ownerId
 * @param {string} accountId
 * @param {string} teamId
 * @param {{ title?: string, primaryContactId?: string|null, actorId?: string, orgId?: string|null, dealId?: string|null, prepType?: string, createNewDeal?: boolean, dealTitle?: string|null, dealType?: string|null, useSessionContext?: boolean }} [opts]
 */
export async function getOrCreateLifecycle(ownerId, accountId, teamId, opts = {}) {
  const store = getStore();

  if (opts.createNewDeal) {
    const stale = await store.findActiveLifecycle(ownerId, accountId);
    if (stale) {
      await archiveLifecycle(stale.id, opts.actorId || ownerId, "new_deal");
    }
    const dealType =
      opts.dealType || (opts.prepType === "expansion" ? "expansion" : "new_business");
    const deal = await createDealWithExplicitTitle(accountId, ownerId, teamId, opts.orgId || null, {
      title: opts.dealTitle || opts.title,
      type: dealType,
      primaryContactId: opts.primaryContactId,
      accountName: opts.title,
    });
    const ts = now();
    const lifecycle = await store.createLifecycle({
      id: newId("lifecycle"),
      dealId: deal.id,
      ownerId,
      teamId,
      orgId: opts.orgId || null,
      accountId,
      primaryContactId: opts.primaryContactId ?? deal.primaryContactId ?? null,
      stage: deal.stage,
      status: "active",
      title: opts.title || deal.title || "Account",
      createdAt: ts,
      updatedAt: ts,
      lastActivityAt: ts,
      prepCount: deal.prepCount || 0,
      postCallCount: deal.postCallCount || 0,
      openTaskCount: deal.openTaskCount || 0,
      latestQualityScore: deal.latestQualityScore ?? null,
    });
    await store.addLifecycleEvent({
      id: newId("event"),
      lifecycleId: lifecycle.id,
      type: "lifecycle_created",
      actorId: opts.actorId || ownerId,
      timestamp: ts,
      payload: { accountId, teamId, orgId: opts.orgId || null, dealId: deal.id, reason: "create_new_deal" },
    });
    return lifecycle;
  }

  if (opts.dealId && store.findActiveLifecycleByDeal) {
    const byDeal = await store.findActiveLifecycleByDeal(ownerId, accountId, opts.dealId);
    if (byDeal) return byDeal;
  } else {
    const existing = await store.findActiveLifecycle(ownerId, accountId);
    if (existing) {
      if (!existing.dealId) {
        await ensureDealForLifecycle(existing);
        return store.getLifecycle(existing.id);
      }
      if (opts.dealId && existing.dealId !== opts.dealId) {
        await archiveLifecycle(existing.id, opts.actorId || ownerId, "deal_switch");
      } else if (!opts.dealId || existing.dealId === opts.dealId) {
        return existing;
      }
    }
  }

  if (opts.dealId) {
    const stale = await store.findActiveLifecycle(ownerId, accountId);
    if (stale && stale.dealId !== opts.dealId) {
      await archiveLifecycle(stale.id, opts.actorId || ownerId, "deal_switch");
    }
  }

  const deal = await resolveDealForEngagement(accountId, ownerId, teamId, opts.orgId || null, {
    dealId: opts.dealId,
    prepType: opts.prepType,
    title: opts.title,
    primaryContactId: opts.primaryContactId,
    useSessionContext: opts.useSessionContext !== false && !opts.dealId,
  });

  const ts = now();
  const lifecycle = await store.createLifecycle({
    id: newId("lifecycle"),
    dealId: deal.id,
    ownerId,
    teamId,
    orgId: opts.orgId || null,
    accountId,
    primaryContactId: opts.primaryContactId ?? deal.primaryContactId ?? null,
    stage: deal.stage,
    status: "active",
    title: opts.title || deal.title || "Account",
    createdAt: ts,
    updatedAt: ts,
    lastActivityAt: ts,
    prepCount: deal.prepCount || 0,
    postCallCount: deal.postCallCount || 0,
    openTaskCount: deal.openTaskCount || 0,
    latestQualityScore: deal.latestQualityScore ?? null,
  });

  await store.addLifecycleEvent({
    id: newId("event"),
    lifecycleId: lifecycle.id,
    type: "lifecycle_created",
    actorId: opts.actorId || ownerId,
    timestamp: ts,
    payload: { accountId, teamId, orgId: opts.orgId || null, dealId: deal.id },
  });

  return lifecycle;
}

/** Attach a prep brief to a lifecycle. */
export async function attachPrep(lifecycleId, prepBrief, actorId) {
  const store = getStore();
  const ts = now();
  const lifecycle = await store.getLifecycle(lifecycleId);
  const dealId = prepBrief.dealId || lifecycle?.dealId || null;
  const saved = await store.createPrepBrief({
    ...prepBrief,
    lifecycleId,
    dealId,
    createdAt: prepBrief.createdAt || ts,
  });

  if (lifecycle) {
    if (dealId) {
      await bumpDealAfterPrep(dealId, { primaryContactId: prepBrief.primaryContactId });
    } else {
      await store.updateLifecycle(lifecycleId, {
        prepCount: (lifecycle.prepCount || 0) + 1,
        lastActivityAt: ts,
        primaryContactId: lifecycle.primaryContactId || prepBrief.primaryContactId || null,
      });
    }
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
export async function attachPostCall(lifecycleId, postCall, actorId, callSummary = null) {
  const store = getStore();
  const ts = now();
  const lifecycle = await store.getLifecycle(lifecycleId);

  const existing = postCall.callIdentityKey
    ? await store.findPostCallByIdentity(postCall.ownerId, postCall.callIdentityKey)
    : null;

  let saved;
  let isNew = false;

  if (existing) {
    const merged = {
      ...existing,
      ...postCall,
      lifecycleId,
      dealId: postCall.dealId || existing.dealId || lifecycle?.dealId || null,
      updatedAt: ts,
    };
    saved = store.upsertPostCallWithSummary
      ? await store.upsertPostCallWithSummary(merged, callSummary ? { ...callSummary, id: merged.id, updatedAt: ts } : null)
      : await store.upsertPostCall(merged);
  } else {
    isNew = true;
    const created = {
      ...postCall,
      id: postCall.id || newId("postCall"),
      lifecycleId,
      dealId: postCall.dealId || lifecycle?.dealId || null,
      createdAt: postCall.createdAt || ts,
      updatedAt: ts,
    };
    saved = store.upsertPostCallWithSummary
      ? await store.upsertPostCallWithSummary(
          created,
          callSummary ? { ...callSummary, id: created.id, createdAt: created.createdAt, updatedAt: ts } : null,
        )
      : await store.upsertPostCall(created);
  }

  const dealId = saved.dealId || lifecycle?.dealId || null;
  if (lifecycle) {
    let newStage = lifecycle.stage;
    if (dealId) {
      if (isNew) {
        newStage = stageAfterFirstPostCall(lifecycle.stage);
        await bumpDealAfterPostCall(dealId, {
          isNew: true,
          qualityScore: postCall.qualityScore,
          stage: newStage,
        });
      } else {
        await bumpDealAfterPostCall(dealId, { isNew: false, qualityScore: postCall.qualityScore });
      }
      const refreshed = await store.getLifecycle(lifecycleId);
      if (refreshed) newStage = refreshed.stage;
    } else {
      const patch = {
        lastActivityAt: ts,
        latestQualityScore: postCall.qualityScore ?? lifecycle.latestQualityScore,
      };
      if (isNew) {
        patch.postCallCount = (lifecycle.postCallCount || 0) + 1;
        newStage = stageAfterFirstPostCall(lifecycle.stage);
        patch.stage = newStage;
      }
      await store.updateLifecycle(lifecycleId, patch);
    }

    if (isNew && lifecycle.stage === "research" && newStage === "discovery") {
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

/** Manually advance lifecycle stage (deal is canonical when linked). */
export async function advanceStage(lifecycleId, toStage, actorId) {
  const store = getStore();
  const lifecycle = await store.getLifecycle(lifecycleId);
  if (!lifecycle || lifecycle.stage === toStage) return lifecycle;

  if (lifecycle.dealId) {
    await advanceDealStage(lifecycle.dealId, toStage, actorId);
    return store.getLifecycle(lifecycleId);
  }

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
  const lifecycle = await store.getLifecycle(lifecycleId);
  const dealId = task.dealId || lifecycle?.dealId || null;
  const saved = await store.createTask({ ...task, lifecycleId, dealId, createdAt: task.createdAt || ts });

  if (lifecycle && saved.status !== "completed" && saved.status !== "dismissed") {
    if (dealId) {
      await bumpDealAfterTask(dealId);
    } else {
      await store.updateLifecycle(lifecycleId, {
        openTaskCount: (lifecycle.openTaskCount || 0) + 1,
        lastActivityAt: ts,
      });
    }
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

/** List active lifecycles for one account (all SE spines). */
export async function listActiveLifecyclesForAccount(accountId) {
  const store = getStore();
  if (!accountId || !store.listActiveLifecyclesForAccount) return [];
  return store.listActiveLifecyclesForAccount(accountId);
}

/** Archive a lifecycle (e.g. when SE leaves deal team). */
export async function archiveLifecycle(lifecycleId, actorId, reason) {
  const store = getStore();
  const lifecycle = await store.getLifecycle(lifecycleId);
  if (!lifecycle || lifecycle.status === "archived") return lifecycle;

  const ts = now();
  await store.updateLifecycle(lifecycleId, { status: "archived", lastActivityAt: ts });
  await store.addLifecycleEvent({
    id: newId("event"),
    lifecycleId,
    type: "lifecycle_archived",
    actorId: actorId || lifecycle.ownerId,
    timestamp: ts,
    payload: { reason: reason || "se_removed" },
  });
  return store.getLifecycle(lifecycleId);
}

/** Log SE roster change on the SE's lifecycle spine. */
export async function logSeTeamEvent(lifecycleId, type, actorId, payload) {
  const store = getStore();
  const ts = now();
  await store.addLifecycleEvent({
    id: newId("event"),
    lifecycleId,
    type,
    actorId,
    timestamp: ts,
    payload,
  });
}

/**
 * Lifecycles visible to the signed-in user (own / team / org scope).
 * @param {object} session
 */
export async function listLifecyclesForSession(session) {
  const { effectiveSessionUserId } = await import("./session.js");
  const ownerId = effectiveSessionUserId(session);
  if (!ownerId) return [];

  const { safeStoreOp } = await import("./safe-store.js");
  const store = getStore();

  try {
    const { getVisibleScope, userWithDirectorFlag, getOrg } = await import("./org-service.js");
    const user = await safeStoreOp("getUser", () => store.getUser(ownerId), null);
    const org = user?.orgId ? await safeStoreOp("getOrg", () => getOrg(user.orgId), null) : null;
    const enriched = userWithDirectorFlag(user, org);
    const scope = await getVisibleScope(enriched);

    /** @type {import("./types.js").Lifecycle[]} */
    let lifecycles = [];

    if (scope.type === "own") {
      lifecycles = await safeStoreOp(
        "listLifecyclesByOwner",
        () => store.listLifecyclesByOwner(ownerId),
        [],
      );
      let accounts = [];
      if (store.listAccounts) {
        accounts = await safeStoreOp("listAccounts", () => store.listAccounts(), []);
      }
      const accountIdsOnTeam = new Set(
        accounts
          .filter((a) => (a.seTeam || []).some((m) => m.seUserId === ownerId))
          .map((a) => a.id),
      );
      for (const accountId of accountIdsOnTeam) {
        const lc = await safeStoreOp(
          "findActiveLifecycle",
          () => store.findActiveLifecycle(ownerId, accountId),
          null,
        );
        if (lc) lifecycles.push(lc);
      }
    } else if (scope.type === "team") {
      const seen = new Set();
      for (const teamId of scope.teamIds) {
        const teamLcs = await safeStoreOp(
          "listLifecyclesByTeam",
          () => store.listLifecyclesByTeam(teamId),
          [],
        );
        for (const lc of teamLcs) {
          if (!seen.has(lc.id)) {
            seen.add(lc.id);
            lifecycles.push(lc);
          }
        }
      }
    } else if (scope.type === "org" && scope.orgId) {
      if (store.listLifecyclesByOrg) {
        lifecycles = await safeStoreOp(
          "listLifecyclesByOrg",
          () => store.listLifecyclesByOrg(scope.orgId),
          [],
        );
      }
      if (!lifecycles.length && scope.teamIds.length) {
        const seen = new Set();
        for (const teamId of scope.teamIds) {
          const teamLcs = await safeStoreOp(
            "listLifecyclesByTeam",
            () => store.listLifecyclesByTeam(teamId),
            [],
          );
          for (const lc of teamLcs) {
            if (!seen.has(lc.id)) {
              seen.add(lc.id);
              lifecycles.push(lc);
            }
          }
        }
      }
    }

    return lifecycles.filter((l) => l.status === "active");
  } catch (err) {
    console.warn("[lifecycle] listLifecyclesForSession failed:", err?.message || err);
    return [];
  }
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
