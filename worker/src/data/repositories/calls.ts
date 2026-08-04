/**
 * postCalls (calls) read repository — ports web/domain/firestore-store.js read methods.
 */

import { cachedGetDoc, cachedQuery } from "../cache";
import { getDoc, queryBy, type FirestoreDoc, type FirestoreEnv } from "../firestore-admin";
import { hydratePostCallDoc } from "../call-payload-storage";
import { listScorecardsByCall } from "./scorecards";
import { listArrLinesByCall } from "./signals";

const COL = "postCalls";

const DETAIL_ARRAY_KEYS = [
  "videoFacts",
  "timelineSegments",
  "timelineMarkers",
  "tcDeltas",
  "meddpiccDeltas",
  "objections",
  "followUps",
  "momDrafts",
  "dealSignals",
] as const;

function detailArray(postCall: FirestoreDoc | null, key: string): FirestoreDoc[] {
  const detail = postCall?.detail as Record<string, unknown> | undefined;
  const rows = detail?.[key];
  return Array.isArray(rows) ? (rows as FirestoreDoc[]) : [];
}

function hasEmbeddedDetail(postCall: FirestoreDoc): boolean {
  const detail = postCall?.detail as Record<string, unknown> | undefined;
  if (!detail) return false;
  return DETAIL_ARRAY_KEYS.some((key) => {
    const rows = detail[key];
    return Array.isArray(rows) && rows.length > 0;
  });
}

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

function embeddedOrLegacy(
  embedded: FirestoreDoc[],
  legacy: FirestoreDoc[],
): FirestoreDoc[] {
  return embedded.length ? embedded : legacy;
}

export async function getPostCallDetail(id: string, env?: FirestoreEnv): Promise<PostCallDetail | null> {
  const raw = await getPostCall(id, env);
  if (!raw) return null;
  const postCall = await hydratePostCallDoc(raw, env);

  const [scorecards, arrLines] = await Promise.all([
    listScorecardsByCall(id, env),
    listArrLinesByCall(id, env),
  ]);

  const embedded = hasEmbeddedDetail(postCall);
  const [
    legacyVideoFacts,
    legacyTimelineSegments,
    legacyTimelineMarkers,
    legacyFollowUps,
    legacyObjections,
    legacyMomDrafts,
    legacyMeddpiccDeltas,
    legacyTcDeltas,
    legacyDealSignals,
  ] = embedded
    ? [[], [], [], [], [], [], [], [], []]
    : await Promise.all([
        listCallChildren("videoFacts", id, env),
        listCallChildren("timelineSegments", id, env),
        listCallChildren("timelineMarkers", id, env),
        listCallChildren("followUps", id, env),
        listCallChildren("objections", id, env),
        listCallChildren("momDrafts", id, env),
        listCallChildren("meddpiccDeltas", id, env),
        listCallChildren("tcDeltas", id, env),
        listCallChildren("dealSignals", id, env),
      ]);

  return {
    postCall,
    scorecards,
    videoFacts: embeddedOrLegacy(detailArray(postCall, "videoFacts"), legacyVideoFacts),
    timelineSegments: embeddedOrLegacy(detailArray(postCall, "timelineSegments"), legacyTimelineSegments),
    timelineMarkers: embeddedOrLegacy(detailArray(postCall, "timelineMarkers"), legacyTimelineMarkers),
    followUps: embeddedOrLegacy(detailArray(postCall, "followUps"), legacyFollowUps),
    objections: embeddedOrLegacy(detailArray(postCall, "objections"), legacyObjections),
    momDrafts: embeddedOrLegacy(detailArray(postCall, "momDrafts"), legacyMomDrafts),
    meddpiccDeltas: embeddedOrLegacy(detailArray(postCall, "meddpiccDeltas"), legacyMeddpiccDeltas),
    tcDeltas: embeddedOrLegacy(detailArray(postCall, "tcDeltas"), legacyTcDeltas),
    arrLines,
    dealSignals: embeddedOrLegacy(detailArray(postCall, "dealSignals"), legacyDealSignals),
  };
}

/** @deprecated Prefer listCallSummariesForScope for list surfaces. */
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
