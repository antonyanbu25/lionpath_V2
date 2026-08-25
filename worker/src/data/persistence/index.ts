/**
 * Janus persistence layer — public surface.
 *
 * Import from here, not from individual files:
 *   import { getPool, withSessionContext, PostgresRepository } from "./persistence";
 */

export { getPool, postgresReady, assertPostgresAvailable, closePool } from "./postgres-pool";
export type { PgClient, PgPool, PostgresEnv } from "./postgres-pool";
export { resolveSqlSession, withSessionContext, withSystemContext } from "./session-context";
export type { SqlSession } from "./session-context";
export { resolveInternalId, registerId, upsertReturningId } from "./id-registry";
export type { EntityType } from "./id-registry";
export { PostgresRepository, upsertAppUser, upsertOrgUnit } from "./postgres-repository";
export { FirestoreRepository } from "./firestore-repository";
export { DualWriteRepository, resolvePersistencePort } from "./dual-write-repository";
export { projectOutboxBatch, getFirestoreProjectionIntegrationId } from "./outbox";
export { applyLifecycleEvent } from "./lifecycle-events";
export type { LifecycleEventInput } from "./lifecycle-events";
export { validateJsonbShape, ShapeValidationError, CURRENT_SHAPE_VERSION } from "./shapes";
export type { JsonbShape } from "./shapes";
export { insertAiRun, mapPassNameToRunType } from "./ai-run";
export type { AiRunRow, RunType } from "./ai-run";
export { resolvePersistenceMode } from "./types";
export type {
  PersistenceMode,
  PersistencePort,
  AccountRow,
  ContactRow,
  DealRow,
  DealContactRow,
  ActivityRow,
  PreCallRow,
  PostCallRow,
  ScorecardRow,
  ProductSignalRow,
} from "./types";
