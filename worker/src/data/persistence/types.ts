/**
 * PersistencePort — the storage contract the worker codes against.
 *
 * Implementations:
 *   - PostgresRepository (target, SQL-primary)
 *   - FirestoreRepository (legacy, wraps firestore-admin.ts)
 *   - DualWriteRepository (transition: SQL transaction + sync_outbox row that
 *     projects to Firestore; reads per PERSISTENCE_MODE)
 *
 * All mutating methods take a PgClient so callers can compose multi-entity
 * writes inside one withSessionContext transaction (RLS + atomicity).
 */

import type { PgClient } from "./postgres-pool";

export type PersistenceMode = "firestore" | "dual" | "sql";

export function resolvePersistenceMode(env?: {
  PERSISTENCE_MODE?: string;
}): PersistenceMode {
  const raw = (env?.PERSISTENCE_MODE || process.env.PERSISTENCE_MODE || "firestore").trim();
  if (raw === "dual" || raw === "sql") return raw;
  return "firestore";
}

export interface AccountRow {
  publicId: string;
  name: string;
  domain?: string | null;
  slug?: string | null;
  industry?: string | null;
  healthData?: Record<string, unknown> | null;
  externalRef?: string | null;
}

export interface ContactRow {
  publicId: string;
  accountPublicId: string;
  email: string;
  name?: string | null;
  title?: string | null;
  role?: string | null;
}

export interface DealRow {
  publicId: string;
  accountPublicId: string;
  ownerPublicId: string;
  orgUnitId: string;
  name: string;
  stage: string;
  status?: string;
  amount?: number | null;
  currencyCode?: string;
}

export interface DealContactRow {
  publicId: string;
  dealPublicId: string;
  contactPublicId: string;
  role?: string | null;
  isPrimary?: boolean;
}

export interface ActivityRow {
  publicId: string;
  idempotencyKey?: string | null;
  dealPublicId?: string | null;
  accountPublicId: string;
  ownerPublicId: string;
  orgUnitId: string;
  activityType: "call" | "meeting" | "email" | "task" | "demo";
  subject?: string | null;
  occurredAt: string;
}

export interface PostCallRow {
  publicId: string;
  idempotencyKey?: string | null;
  activityPublicId: string;
  transcriptRef?: string | null;
  analysis?: Record<string, unknown> | null;
  detail?: Record<string, unknown> | null;
  pipelineState?: string;
  analysisShapeVersion?: string;
  detailShapeVersion?: string;
}

export interface PreCallRow {
  publicId: string;
  idempotencyKey?: string | null;
  activityPublicId: string;
  researchBrief?: Record<string, unknown> | null;
  inputSnapshot?: Record<string, unknown> | null;
}

export interface ScorecardRow {
  publicId: string;
  activityPublicId: string;
  rubricId: string;
  ownerPublicId: string;
  orgUnitId: string;
  compositeScore?: number | null;
  lines: Array<{
    rubricParameterId: string;
    rubricThemeId: string;
    score: number;
    paramNameSnapshot: string;
    paramWeightSnapshot: number;
    evidence?: string | null;
  }>;
}

export interface ProductSignalRow {
  publicId: string;
  activityPublicId?: string | null;
  accountPublicId: string;
  ownerPublicId: string;
  orgUnitId: string;
  source?: "ai_extracted" | "pm_created" | "se_created";
  signalType: "product_gap" | "objection" | "competitor_intel" | "feature_request";
  signalKey?: string | null;
  title: string;
  description?: string | null;
  evidence?: string | null;
}

/**
 * The port. Every method maps to one SQL statement batch; implementations
 * must resolve public_id FKs via id_registry inside the caller's transaction.
 */
export interface PersistencePort {
  upsertAccount(client: PgClient, row: AccountRow): Promise<number>;
  /** Partial update: only the provided fields are written; absent fields are untouched. */
  patchAccount(client: PgClient, publicId: string, fields: Partial<Omit<AccountRow, "publicId">>): Promise<number>;
  upsertContact(client: PgClient, row: ContactRow): Promise<number>;
  patchContact(client: PgClient, publicId: string, fields: Partial<Omit<ContactRow, "publicId">>): Promise<number>;
  upsertDeal(client: PgClient, row: DealRow): Promise<number>;
  patchDeal(client: PgClient, publicId: string, fields: Partial<Omit<DealRow, "publicId">>): Promise<number>;
  upsertDealContact(client: PgClient, row: DealContactRow): Promise<number>;
  setPrimaryDealContact(client: PgClient, dealPublicId: string, contactPublicId: string): Promise<void>;
  removeDealContact(client: PgClient, dealPublicId: string, contactPublicId: string): Promise<void>;
  upsertActivity(client: PgClient, row: ActivityRow): Promise<number>;
  upsertPreCall(client: PgClient, row: PreCallRow): Promise<number>;
  upsertPostCall(client: PgClient, row: PostCallRow): Promise<number>;
  upsertScorecard(client: PgClient, row: ScorecardRow): Promise<number>;
  upsertProductSignal(client: PgClient, row: ProductSignalRow): Promise<number>;

  /** Enqueue a Firestore projection for the just-written row (same tx). */
  enqueueOutbox(
    client: PgClient,
    entry: { entityType: string; entityId: string; operation: string; payload: Record<string, unknown> },
  ): Promise<void>;
}
