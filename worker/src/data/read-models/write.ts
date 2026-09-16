import { setDoc, type FirestoreDoc, type FirestoreEnv } from "../firestore-admin";
import type { ReadModelCollection, ReadModelStamp } from "./types";

export async function writeReadModel(
  col: ReadModelCollection,
  id: string,
  body: Record<string, unknown>,
  sourceUpdatedAt: number,
  env?: FirestoreEnv,
): Promise<FirestoreDoc> {
  const ts = Date.now();
  const stamp: ReadModelStamp = {
    sourceUpdatedAt,
    rebuiltAt: ts,
  };
  return setDoc(col, id, { ...body, id, ...stamp }, env);
}
