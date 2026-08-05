import type { FirestoreDoc, FirestoreEnv } from "../firestore-admin";
import { scheduleDebounced } from "./debounce";
import { rebuildAccountRollup } from "./rebuild-account-rollup";
import { rebuildDealTraction, rebuildDealTractionForAccount } from "./rebuild-deal-traction";
import { rebuildOrgMetrics } from "./rebuild-org-metrics";
import { rebuildSeLaunchpad } from "./rebuild-se-launchpad";
import { rebuildTeamMetrics } from "./rebuild-team-metrics";
import type { PostCallRebuildContext } from "./types";

function ctxFromPostCall(postCall: FirestoreDoc): PostCallRebuildContext {
  return {
    postCallId: String(postCall.id || ""),
    ownerId: postCall.ownerId ? String(postCall.ownerId) : undefined,
    teamId: postCall.teamId ? String(postCall.teamId) : undefined,
    orgId: postCall.orgId ? String(postCall.orgId) : undefined,
    accountId: postCall.accountId ? String(postCall.accountId) : undefined,
    dealId: postCall.dealId ? String(postCall.dealId) : undefined,
    sourceUpdatedAt: Number(postCall.updatedAt || postCall.createdAt || Date.now()),
  };
}

export function scheduleReadModelRebuilds(postCall: FirestoreDoc, env?: FirestoreEnv): void {
  const ctx = ctxFromPostCall(postCall);
  const { sourceUpdatedAt } = ctx;

  if (ctx.teamId) {
    scheduleDebounced(`teamMetrics/${ctx.teamId}`, () =>
      rebuildTeamMetrics(ctx.teamId!, sourceUpdatedAt, env),
    );
  }
  if (ctx.orgId) {
    scheduleDebounced(`orgMetrics/${ctx.orgId}`, () =>
      rebuildOrgMetrics(ctx.orgId!, sourceUpdatedAt, env),
    );
  }
  if (ctx.dealId) {
    scheduleDebounced(`dealTraction/${ctx.dealId}`, () =>
      rebuildDealTraction(ctx.dealId!, sourceUpdatedAt, env),
    );
  }
  if (ctx.accountId) {
    scheduleDebounced(`accountRollup/${ctx.accountId}`, () =>
      rebuildAccountRollup(ctx.accountId!, sourceUpdatedAt, env),
    );
    scheduleDebounced(`dealTraction/account/${ctx.accountId}`, () =>
      rebuildDealTractionForAccount(ctx.accountId!, sourceUpdatedAt, env),
    );
  }
  if (ctx.ownerId) {
    scheduleDebounced(`seLaunchpad/${ctx.ownerId}`, () =>
      rebuildSeLaunchpad(ctx.ownerId!, sourceUpdatedAt, env),
    );
  }
}

export async function rebuildReadModelsNow(
  postCall: FirestoreDoc,
  env?: FirestoreEnv,
): Promise<void> {
  const ctx = ctxFromPostCall(postCall);
  const { sourceUpdatedAt } = ctx;
  const jobs: Promise<void>[] = [];
  if (ctx.teamId) jobs.push(rebuildTeamMetrics(ctx.teamId, sourceUpdatedAt, env));
  if (ctx.orgId) jobs.push(rebuildOrgMetrics(ctx.orgId, sourceUpdatedAt, env));
  if (ctx.dealId) jobs.push(rebuildDealTraction(ctx.dealId, sourceUpdatedAt, env));
  if (ctx.accountId) {
    jobs.push(rebuildAccountRollup(ctx.accountId, sourceUpdatedAt, env));
    jobs.push(rebuildDealTractionForAccount(ctx.accountId, sourceUpdatedAt, env));
  }
  if (ctx.ownerId) jobs.push(rebuildSeLaunchpad(ctx.ownerId, sourceUpdatedAt, env));
  await Promise.all(jobs);
}

export { ctxFromPostCall };
