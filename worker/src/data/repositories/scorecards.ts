/**
 * scorecards read repository — ports web/domain/firestore-store.js read methods.
 */

import { cachedQuery } from "../cache";
import { getAll, queryBy, type FirestoreDoc, type FirestoreEnv } from "../firestore-admin";

const CHUNK_SIZE = 30;

function groupByField(rows: FirestoreDoc[], field: string): Map<string, FirestoreDoc[]> {
  const out = new Map<string, FirestoreDoc[]>();
  for (const row of rows) {
    const key = String(row[field] || "");
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(row);
  }
  return out;
}

async function queryByCallIdsInChunks(
  col: string,
  callIds: string[],
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  const ids = [...new Set(callIds.filter(Boolean))];
  if (!ids.length) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + CHUNK_SIZE));
  }
  const chunkRows = await Promise.all(
    chunks.map((chunk) =>
      queryBy(col, [{ field: "callId", op: "in", value: chunk }], undefined, undefined, env),
    ),
  );
  return chunkRows.flat();
}

export async function listScorecardsByCall(callId: string, env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  return cachedQuery("scorecards", { callId }, () =>
    queryBy("scorecards", [{ field: "callId", op: "==", value: callId }], undefined, undefined, env),
  );
}

export async function listScorecardLinesByCall(
  callId: string,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return cachedQuery("scorecardLines", { byCall: callId }, () =>
    queryBy("scorecardLines", [{ field: "callId", op: "==", value: callId }], undefined, undefined, env),
  );
}

export async function listScorecardsForCalls(
  callIds: string[],
  env?: FirestoreEnv,
): Promise<Map<string, FirestoreDoc[]>> {
  const rows = await queryByCallIdsInChunks("scorecards", callIds, env);
  return groupByField(rows, "callId");
}

export async function listScorecardLinesForCalls(
  callIds: string[],
  env?: FirestoreEnv,
): Promise<Map<string, FirestoreDoc[]>> {
  const rows = await queryByCallIdsInChunks("scorecardLines", callIds, env);
  return groupByField(rows, "callId");
}

export async function listScorecardLinesByTeamTheme(
  teamId: string,
  themeKey: string,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  const lines = await cachedQuery("scorecardLines", { teamId, themeKey }, () =>
    queryBy(
      "scorecardLines",
      [
        { field: "teamId", op: "==", value: teamId },
        { field: "themeKey", op: "==", value: themeKey },
        { field: "applicable", op: "==", value: true },
      ],
      undefined,
      undefined,
      env,
    ),
  );

  const cardIds = [...new Set(lines.map((l) => l.scorecardId).filter(Boolean))] as string[];
  const cards = cardIds.length ? await getAll("scorecards", cardIds, env) : [];
  const provisional = new Set(cards.filter((c) => c.provisional).map((c) => c.id));
  return lines.filter((l) => !l.scorecardId || !provisional.has(String(l.scorecardId)));
}
