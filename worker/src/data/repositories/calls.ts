/**
 * postCalls (calls) read repository — ports web/domain/firestore-store.js read methods.
 */

import { cachedGetDoc, cachedQuery } from "../cache";
import { getDoc, queryBy, type FirestoreDoc, type FirestoreEnv } from "../firestore-admin";

const COL = "postCalls";

export async function getPostCall(id: string, env?: FirestoreEnv): Promise<FirestoreDoc | null> {
  return cachedGetDoc(COL, id, () => getDoc(COL, id, env));
}

export async function findPostCallByIdentity(
  ownerId: string,
  callIdentityKey: string,
  env?: FirestoreEnv,
): Promise<FirestoreDoc | null> {
  const rows = await cachedQuery(COL, { findIdentity: ownerId, callIdentityKey }, () =>
    queryBy(
      COL,
      [
        { field: "ownerId", op: "==", value: ownerId },
        { field: "callIdentityKey", op: "==", value: callIdentityKey },
      ],
      undefined,
      1,
      env,
    ),
  );
  return rows[0] || null;
}

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

export async function listPostCallsByLifecycle(
  lifecycleId: string,
  limitCount = 200,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return listByField("lifecycleId", lifecycleId, limitCount, env);
}

export async function listPostCallsByTeam(
  teamId: string,
  limitCount = 200,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return listByField("teamId", teamId, limitCount, env);
}

export async function listPostCallsByOrg(
  orgId: string,
  limitCount = 200,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return listByField("orgId", orgId, limitCount, env);
}

export async function listPostCallsByOwner(
  ownerId: string,
  limitCount = 200,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return listByField("ownerId", ownerId, limitCount, env);
}

export async function listPostCallsByDeal(
  dealId: string,
  limitCount = 50,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return listByField("dealId", dealId, limitCount, env);
}

export async function listPostCallsByAccount(
  accountId: string,
  limitCount = 80,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return listByField("accountId", accountId, limitCount, env);
}

export interface PostCallDetail {
  postCall: FirestoreDoc;
  scorecards: FirestoreDoc[];
  videoFacts: FirestoreDoc[];
  timelineSegments: FirestoreDoc[];
  timelineMarkers: FirestoreDoc[];
  followUps: FirestoreDoc[];
  objections: FirestoreDoc[];
  momDrafts: FirestoreDoc[];
  meddpiccDeltas: FirestoreDoc[];
  tcDeltas: FirestoreDoc[];
  arrLines: FirestoreDoc[];
  dealSignals: FirestoreDoc[];
}

async function listCallChildren(col: string, callId: string, env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  return cachedQuery(col, { callId }, () =>
    queryBy(col, [{ field: "callId", op: "==", value: callId }], undefined, undefined, env),
  );
}

export async function getPostCallDetail(id: string, env?: FirestoreEnv): Promise<PostCallDetail | null> {
  const postCall = await getPostCall(id, env);
  if (!postCall) return null;

  const [
    scorecards,
    videoFacts,
    timelineSegments,
    timelineMarkers,
    followUps,
    objections,
    momDrafts,
    meddpiccDeltas,
    tcDeltas,
    arrLines,
    dealSignals,
  ] = await Promise.all([
    listCallChildren("scorecards", id, env),
    listCallChildren("videoFacts", id, env),
    listCallChildren("timelineSegments", id, env),
    listCallChildren("timelineMarkers", id, env),
    listCallChildren("followUps", id, env),
    listCallChildren("objections", id, env),
    listCallChildren("momDrafts", id, env),
    listCallChildren("meddpiccDeltas", id, env),
    listCallChildren("tcDeltas", id, env),
    listCallChildren("arrLines", id, env),
    listCallChildren("dealSignals", id, env),
  ]);

  return {
    postCall,
    scorecards,
    videoFacts,
    timelineSegments,
    timelineMarkers,
    followUps,
    objections,
    momDrafts,
    meddpiccDeltas,
    tcDeltas,
    arrLines,
    dealSignals,
  };
}

export async function listPostCallsForScope(
  scope: { ownerId?: string; teamId?: string; orgId?: string },
  limitCount: number,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  if (scope.ownerId) return listPostCallsByOwner(scope.ownerId, limitCount, env);
  if (scope.teamId) return listPostCallsByTeam(scope.teamId, limitCount, env);
  if (scope.orgId) return listPostCallsByOrg(scope.orgId, limitCount, env);
  return [];
}
