import type { FirestoreDoc } from "../firestore-admin";

export const READ_MODEL_COLLECTIONS = {
  teamMetrics: "teamMetrics",
  orgMetrics: "orgMetrics",
  dealTraction: "dealTraction",
  accountRollup: "accountRollup",
  seLaunchpad: "seLaunchpad",
} as const;

export type ReadModelCollection = (typeof READ_MODEL_COLLECTIONS)[keyof typeof READ_MODEL_COLLECTIONS];

export interface ReadModelStamp {
  sourceUpdatedAt: number;
  rebuiltAt: number;
}

export type ReadModelDoc = FirestoreDoc & ReadModelStamp;

export interface PostCallRebuildContext {
  postCallId: string;
  ownerId?: string;
  teamId?: string;
  orgId?: string;
  accountId?: string;
  dealId?: string;
  sourceUpdatedAt: number;
}
