/**
 * deal signals / ARR / product signals read repository.
 */

import { cachedGetDoc, cachedQuery } from "../cache";
import { getDoc, queryBy, whereInChunked, type FirestoreDoc, type FirestoreEnv } from "../firestore-admin";

export async function listDealSignalsByCall(callId: string, env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  return cachedQuery("dealSignals", { byCall: callId }, () =>
    queryBy("dealSignals", [{ field: "callId", op: "==", value: callId }], undefined, undefined, env),
  );
}

export async function listDealSignalsByDeal(
  dealId: string,
  limitCount = 50,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return cachedQuery("dealSignals", { byDeal: dealId, limitCount }, () =>
    queryBy(
      "dealSignals",
      [{ field: "dealId", op: "==", value: dealId }],
      { field: "createdAt", direction: "desc" },
      limitCount,
      env,
    ),
  );
}

export async function listDealSignalsForDeals(
  dealIds: string[],
  perDealLimit = 1,
  env?: FirestoreEnv,
): Promise<Map<string, FirestoreDoc[]>> {
  const ids = [...new Set(dealIds.filter(Boolean))];
  const byDeal = new Map<string, FirestoreDoc[]>();
  if (!ids.length) return byDeal;

  const rows = await whereInChunked(
    "dealSignals",
    "dealId",
    ids,
    [],
    { field: "createdAt", direction: "desc" },
    env,
  );

  for (const row of rows) {
    const dealId = String(row.dealId || "");
    if (!dealId) continue;
    if (!byDeal.has(dealId)) byDeal.set(dealId, []);
    const arr = byDeal.get(dealId)!;
    if (arr.length < perDealLimit) arr.push(row);
  }
  return byDeal;
}

export async function listArrLinesByCall(callId: string, env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  return cachedQuery("arrLines", { byCall: callId }, () =>
    queryBy("arrLines", [{ field: "callId", op: "==", value: callId }], undefined, undefined, env),
  );
}

export async function listArrLinesByDeal(
  dealId: string,
  limitCount = 200,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return cachedQuery("arrLines", { byDeal: dealId, limitCount }, () =>
    queryBy(
      "arrLines",
      [{ field: "dealId", op: "==", value: dealId }],
      { field: "computedAt", direction: "desc" },
      limitCount,
      env,
    ),
  );
}

export async function listArrLinesForDeals(dealIds: string[], env?: FirestoreEnv): Promise<Map<string, FirestoreDoc[]>> {
  const ids = [...new Set(dealIds.filter(Boolean))];
  const byDeal = new Map<string, FirestoreDoc[]>();
  if (!ids.length) return byDeal;

  const rows = await whereInChunked(
    "arrLines",
    "dealId",
    ids,
    [],
    { field: "computedAt", direction: "desc" },
    env,
  );

  for (const row of rows) {
    const dealId = String(row.dealId || "");
    if (!dealId) continue;
    if (!byDeal.has(dealId)) byDeal.set(dealId, []);
    byDeal.get(dealId)!.push(row);
  }
  return byDeal;
}

export async function listArrOverridesByDeal(
  dealId: string,
  limitCount = 100,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return cachedQuery("arrOverrides", { dealId, limitCount }, () =>
    queryBy(
      "arrOverrides",
      [{ field: "dealId", op: "==", value: dealId }],
      { field: "createdAt", direction: "desc" },
      limitCount,
      env,
    ),
  );
}

export async function listProductGapsByPostCall(postCallId: string, env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  return cachedQuery("productGaps", { postCallId }, () =>
    queryBy("productGaps", [{ field: "postCallId", op: "==", value: postCallId }], undefined, undefined, env),
  );
}

export async function listProductGapsByOrg(orgId: string, limitCount = 500, env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  return cachedQuery("productGaps", { orgId, limitCount }, () =>
    queryBy(
      "productGaps",
      [{ field: "orgId", op: "==", value: orgId }],
      { field: "createdAt", direction: "desc" },
      limitCount,
      env,
    ),
  );
}

export async function listProductGapsByDeal(dealId: string, limitCount = 500, env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  return cachedQuery("productGaps", { dealId, limitCount }, () =>
    queryBy(
      "productGaps",
      [{ field: "dealId", op: "==", value: dealId }],
      { field: "createdAt", direction: "desc" },
      limitCount,
      env,
    ),
  );
}

export async function listWhatWorksByPostCall(postCallId: string, env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  return cachedQuery("whatWorks", { postCallId }, () =>
    queryBy("whatWorks", [{ field: "postCallId", op: "==", value: postCallId }], undefined, undefined, env),
  );
}

export async function listWhatWorksByOrg(orgId: string, limitCount = 500, env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  return cachedQuery("whatWorks", { orgId, limitCount }, () =>
    queryBy(
      "whatWorks",
      [{ field: "orgId", op: "==", value: orgId }],
      { field: "createdAt", direction: "desc" },
      limitCount,
      env,
    ),
  );
}

export async function listWhatWorksByDeal(dealId: string, limitCount = 500, env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  return cachedQuery("whatWorks", { dealId, limitCount }, () =>
    queryBy(
      "whatWorks",
      [{ field: "dealId", op: "==", value: dealId }],
      { field: "createdAt", direction: "desc" },
      limitCount,
      env,
    ),
  );
}

export async function listTechnicalCommitsByOrg(
  orgId: string,
  limitCount = 500,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return cachedQuery("technicalCommits", { orgId, limitCount }, () =>
    queryBy(
      "technicalCommits",
      [{ field: "orgId", op: "==", value: orgId }],
      { field: "updatedAt", direction: "desc" },
      limitCount,
      env,
    ),
  );
}

export async function listGapClustersByOrg(orgId: string, limitCount = 200, env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  return cachedQuery("gapClusters", { orgId, limitCount }, () =>
    queryBy(
      "gapClusters",
      [
        { field: "orgId", op: "==", value: orgId },
        { field: "status", op: "in", value: ["draft", "published"] },
      ],
      { field: "arrTotal", direction: "desc" },
      limitCount,
      env,
    ),
  );
}

export async function getGapCluster(id: string, env?: FirestoreEnv): Promise<FirestoreDoc | null> {
  return cachedGetDoc("gapClusters", id, () => getDoc("gapClusters", id, env));
}

export async function getClusteringState(orgId: string, env?: FirestoreEnv): Promise<FirestoreDoc | null> {
  return cachedGetDoc("clusteringState", orgId, () => getDoc("clusteringState", orgId, env));
}

export async function listTcDeltasByDeal(dealId: string, limitCount = 200, env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  return cachedQuery("tcDeltas", { dealId, limitCount }, () =>
    queryBy(
      "tcDeltas",
      [{ field: "dealId", op: "==", value: dealId }],
      { field: "createdAt", direction: "desc" },
      limitCount,
      env,
    ),
  );
}
