/**
 * tasks read repository — ports web/domain/firestore-store.js read methods.
 */

import { cachedQuery } from "../cache";
import { queryBy, type FirestoreDoc, type FirestoreEnv } from "../firestore-admin";

const CHUNK_SIZE = 30;

export async function listTasksByLifecycle(
  lifecycleId: string,
  env?: FirestoreEnv,
): Promise<FirestoreDoc[]> {
  return cachedQuery("tasks", { lifecycleId }, () =>
    queryBy(
      "tasks",
      [{ field: "lifecycleId", op: "==", value: lifecycleId }],
      { field: "createdAt", direction: "desc" },
      undefined,
      env,
    ),
  );
}

export async function listTasksForLifecycles(
  lifecycleIds: string[],
  env?: FirestoreEnv,
): Promise<Map<string, FirestoreDoc[]>> {
  const ids = [...new Set(lifecycleIds.filter(Boolean))];
  /** @type {Map<string, FirestoreDoc[]>} */
  const byLifecycle = new Map();
  if (!ids.length) return byLifecycle;

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + CHUNK_SIZE));
  }

  const chunkRows = await Promise.all(
    chunks.map((chunk) =>
      queryBy(
        "tasks",
        [{ field: "lifecycleId", op: "in", value: chunk }],
        { field: "createdAt", direction: "desc" },
        undefined,
        env,
      ),
    ),
  );

  for (const row of chunkRows.flat()) {
    const lifecycleId = String(row.lifecycleId || "");
    if (!lifecycleId) continue;
    if (!byLifecycle.has(lifecycleId)) byLifecycle.set(lifecycleId, []);
    byLifecycle.get(lifecycleId)!.push(row);
  }
  return byLifecycle;
}
