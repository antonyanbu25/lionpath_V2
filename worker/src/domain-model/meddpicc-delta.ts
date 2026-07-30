/** Per-call MEDDPICC movement — snapshot-plus-delta (spec §2.2). */

import type { MeddpiccFieldKey, MeddpiccFieldSlot } from "./meddpicc";

export type MeddpiccChangeType = "confirmed" | "changed" | "new";

export interface MeddpiccDeltaDraft {
  callId: string;
  dealId: string;
  slot: MeddpiccFieldKey;
  previous: MeddpiccFieldSlot | null;
  current: MeddpiccFieldSlot;
  changeType: MeddpiccChangeType;
  evidence: string;
}

export interface MeddpiccDelta extends MeddpiccDeltaDraft {
  id: string;
  ownerId: string;
  teamId: string;
  orgId: string;
  accountId: string;
  createdAt: number;
  updatedAt: number;
}
