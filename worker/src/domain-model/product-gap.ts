/** Pass 6 — product gaps (negative signal). ADR-006, spec §8. */

import type {
  CrossCuttingTag,
  DealImpact,
  GapDisposition,
  GapType,
  ProductArea,
  ProductGapStatus,
} from "./product-taxonomy";

export interface CompetitorNamed {
  name: string;
  saidBetter: boolean;
}

/** Worker draft — web stamps IDs + RBAC fields at persist time. */
export interface ProductGapDraft {
  productArea: ProductArea;
  subArea: string;
  crossCuttingTags: CrossCuttingTag[];
  verbatim: string;
  /** Short UI label for pills/cards (2–5 words). */
  headline?: string | null;
  /** Seconds from call start when the customer said this, if known. */
  atS?: number | null;
  disposition: GapDisposition;
  dealImpact: DealImpact;
  gapType: GapType;
  competitorNamed: CompetitorNamed | null;
  /** Joined from PostCall.arrSnapshot — never model-supplied. */
  arrTouched: number | null;
  embedding: number[];
  taxonomyVersion: string;
  status: ProductGapStatus;
}

export interface ProductGap extends ProductGapDraft {
  id: string;
  postCallId: string;
  dealId: string;
  accountId: string;
  ownerId: string;
  teamId: string;
  orgId: string;
  clusterId?: string | null;
  createdAt: number;
  updatedAt: number;
}
