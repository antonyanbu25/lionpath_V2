/**
 * deals read repository — ports web/domain/firestore-store.js read methods.
 */

import { cachedQuery } from "../cache";
import { getDoc, queryBy, type FirestoreDoc, type FirestoreEnv } from "../firestore-admin";
import { DEAL_LIST_FIELDS } from "../field-masks";

const COL = "deals";

export async function getDeal(id: string, env?: FirestoreEnv): Promise<FirestoreDoc | null> {
  return getDoc(COL, id, env);
}

export async function findActiveDeal(
  accountId: string,
  type: string,
  env?: FirestoreEnv,
): Promise<FirestoreDoc | null> {
  const rows = await cachedQuery(COL, { findActive: accountId, type }, () =>
    queryBy(
      COL,
      [
        { field: "accountId", op: "==", value: accountId },
        { field: "type", op: "==", value: type },
        { field: "status", op: "==", value: "active" },
      ],
      undefined,
      1,
      env,
    ),
  );
  return rows[0] || null;
}

export async function listDealsByAccount(
  accountId: string,
  ownerId?: string,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  const filters = [{ field: "accountId", op: "==" as const, value: accountId }];
  if (ownerId) filters.push({ field: "ownerId", op: "==", value: ownerId });
  return cachedQuery(COL, { listByAccount: accountId, ownerId: ownerId || null }, () =>
    queryBy(
      COL,
      filters,
      { field: "lastActivityAt", direction: "desc" },
      undefined,
      env,
      [...DEAL_LIST_FIELDS],
    ),
  );
}

export async function listDealsByOwner(
  ownerId: string,
  limitCount = 300,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return cachedQuery(COL, { listByOwner: ownerId, limitCount }, () =>
    queryBy(
      COL,
      [{ field: "ownerId", op: "==", value: ownerId }],
      { field: "lastActivityAt", direction: "desc" },
      limitCount,
      env,
      [...DEAL_LIST_FIELDS],
    ),
  );
}

export async function listDealsByTeam(
  teamId: string,
  limitCount = 300,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return cachedQuery(COL, { listByTeam: teamId, limitCount }, () =>
    queryBy(
      COL,
      [{ field: "teamId", op: "==", value: teamId }],
      { field: "lastActivityAt", direction: "desc" },
      limitCount,
      env,
      [...DEAL_LIST_FIELDS],
    ),
  );
}

export async function listDealsByOrg(
  orgId: string,
  limitCount = 300,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return cachedQuery(COL, { listByOrg: orgId, limitCount }, () =>
    queryBy(
      COL,
      [{ field: "orgId", op: "==", value: orgId }],
      { field: "lastActivityAt", direction: "desc" },
      limitCount,
      env,
      [...DEAL_LIST_FIELDS],
    ),
  );
}

export async function getDealSummaryByDeal(dealId: string, env?: FirestoreEnv): Promise<FirestoreDoc | null> {
  const rows = await cachedQuery("dealSummaries", { dealId }, () =>
    queryBy("dealSummaries", [{ field: "dealId", op: "==", value: dealId }], undefined, 1, env),
  );
  return rows[0] || null;
}

export async function getTechnicalCommitByDeal(
  dealId: string,
  env?: FirestoreEnv,
): Promise<FirestoreDoc | null> {
  const rows = await cachedQuery("technicalCommits", { dealId }, () =>
    queryBy("technicalCommits", [{ field: "dealId", op: "==", value: dealId }], undefined, 1, env),
  );
  return rows[0] || null;
}

export async function listDealsForScope(
  scope: { ownerId?: string; teamId?: string; orgId?: string },
  limitCount: number,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  if (scope.ownerId) return listDealsByOwner(scope.ownerId, limitCount, env);
  if (scope.teamId) return listDealsByTeam(scope.teamId, limitCount, env);
  if (scope.orgId) return listDealsByOrg(scope.orgId, limitCount, env);
  return [];
}

export interface DealDetail {
  deal: FirestoreDoc;
  summary: FirestoreDoc | null;
  technicalCommit: FirestoreDoc | null;
  dealSignals: FirestoreDoc[];
  arrLines: FirestoreDoc[];
}

export async function getDealDetail(id: string, env?: FirestoreEnv): Promise<DealDetail | null> {
  const deal = await getDeal(id, env);
  if (!deal) return null;
  const { listDealSignalsByDeal, listArrLinesByDeal } = await import("./signals");
  const [summary, technicalCommit, dealSignals, arrLines] = await Promise.all([
    getDealSummaryByDeal(id, env),
    getTechnicalCommitByDeal(id, env),
    listDealSignalsByDeal(id, 50, env),
    listArrLinesByDeal(id, 200, env),
  ]);
  return { deal, summary, technicalCommit, dealSignals, arrLines };
}
