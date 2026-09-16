/** Gap clusters — async verbatim embedding roll-ups (ADR-006, spec §8). */

import type { CrossCuttingTag, ProductArea } from "./product-taxonomy";

export type GapClusterStatus = "draft" | "published" | "archived";

export interface GapCluster {
  id: string;
  orgId: string;
  label: string;
  /** Mean of member verbatim embeddings (L2-normalized). */
  centroid: number[];
  dealCount: number;
  arrTotal: number;
  status: GapClusterStatus;
  /** Set when PM publishes; frozen at label time. */
  taxonomyVersion?: string | null;
  /** Derived summaries — not clustering inputs. */
  productArea?: ProductArea | null;
  crossCuttingTags?: CrossCuttingTag[];
  /** When archived due to split/merge/taxonomy bump. */
  supersededBy?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ClusteringState {
  id: string;
  orgId: string;
  pendingGapCount: number;
  lastIncrementalAt: number | null;
  lastFullRunAt: number | null;
  running: boolean;
  updatedAt: number;
}
