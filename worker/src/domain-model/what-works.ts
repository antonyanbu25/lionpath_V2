/** Pass 6 — what landed (positive signal). ADR-006, spec §8. */

import type { ProductArea } from "./product-taxonomy";

/** Worker draft — web stamps IDs + RBAC fields at persist time. */
export interface WhatWorksDraft {
  productArea: ProductArea;
  verbatim: string;
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
