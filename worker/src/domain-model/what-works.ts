/** Pass 6 — what landed (positive signal). ADR-006, spec §8. */

import type { ProductArea } from "./product-taxonomy";

/** Worker draft — web stamps IDs + RBAC fields at persist time. */
export interface WhatWorksDraft {
  productArea: ProductArea;
  verbatim: string;
  /** Short UI label for win pills (2–5 words). */
  headline?: string | null;
  /** Seconds from call start when the customer said this, if known. */
  atS?: number | null;
  referenceCandidate: boolean;
  taxonomyVersion: string;
}

export interface WhatWorks extends WhatWorksDraft {
  id: string;
  postCallId: string;
  accountId: string;
  ownerId: string;
  teamId: string;
  orgId: string;
  createdAt: number;
  updatedAt: number;
}
