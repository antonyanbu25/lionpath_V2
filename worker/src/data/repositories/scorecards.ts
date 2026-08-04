/**
 * scorecards read repository — ports web/domain/firestore-store.js read methods.
 */

import { cachedQuery } from "../cache";
import { getDoc, queryBy, type FirestoreDoc, type FirestoreEnv } from "../firestore-admin";

export async function listScorecardsByCall(callId: string, env?: FirestoreEnv): Promise<FirestoreDoc[]> {
  return cachedQuery("scorecards", { callId }, () =>
    queryBy("scorecards", [{ field: "callId", op: "==", value: callId }], undefined, undefined, env),
  );
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
  const provisional = new Set<string>();
  for (const id of cardIds) {
    const card = await getDoc("scorecards", id, env);
    if (card?.provisional) provisional.add(id);
  }
  return lines.filter((l) => !l.scorecardId || !provisional.has(String(l.scorecardId)));
}
