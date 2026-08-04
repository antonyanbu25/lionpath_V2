/**
 * callSummaries read repository — thin list projection for postCalls.
 */

import { cachedQuery } from "../cache";
import { queryBy, type FirestoreDoc, type FirestoreEnv } from "../firestore-admin";

const COL = "callSummaries";

async function listByField(
  field: string,
  value: string,
  limitCount: number,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return cachedQuery(COL, { listBy: field, value, limitCount }, () =>
    queryBy(COL, [{ field, op: "==", value }], { field: "createdAt", direction: "desc" }, limitCount, env),
  );
}

export async function listCallSummariesByOwner(
  ownerId: string,
  limitCount = 200,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return listByField("ownerId", ownerId, limitCount, env);
}

export async function listCallSummariesByTeam(
  teamId: string,
  limitCount = 200,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return listByField("teamId", teamId, limitCount, env);
}

export async function listCallSummariesByOrg(
  orgId: string,
  limitCount = 200,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return listByField("orgId", orgId, limitCount, env);
}

export async function listCallSummariesByDeal(
  dealId: string,
  limitCount = 50,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return listByField("dealId", dealId, limitCount, env);
}

export async function listCallSummariesByAccount(
  accountId: string,
  limitCount = 80,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return listByField("accountId", accountId, limitCount, env);
}

export async function listCallSummariesForScope(
  scope: { ownerId?: string; teamId?: string; orgId?: string },
  limitCount: number,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  if (scope.ownerId) return listCallSummariesByOwner(scope.ownerId, limitCount, env);
  if (scope.teamId) return listCallSummariesByTeam(scope.teamId, limitCount, env);
  if (scope.orgId) return listCallSummariesByOrg(scope.orgId, limitCount, env);
  return [];
}
