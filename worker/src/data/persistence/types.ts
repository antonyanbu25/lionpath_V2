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
export type PersistenceReadMode = "firestore" | "pg";

/**
 * Default is "sql": Postgres is the only system of record, Firestore is not
 * a write target.
 *
 * Changed from "dual" once staging's cutover was confirmed complete (D-cutover,
 * 2026-09). "dual" silently falling back to Firestore for any unwired write
 * path was the exact mechanism that let real post-call/pre-call writes go
 * missing from Postgres without anyone noticing -- staying on "dual" as the
 * default trades that risk for a quieter failure mode, which is the wrong
 * direction now that the cutover is meant to be real. In "sql" mode a gap is
 * a loud 501 (see the mode guard in routes.ts), not a silent no-op.
 *
 * Set PERSISTENCE_MODE=dual explicitly to opt an environment back into the
 * Firestore-fallback safety net (e.g. a fresh, unprovisioned deploy).
 */
export function resolvePersistenceMode(env?: {
  PERSISTENCE_MODE?: string;
}): PersistenceMode {
  const raw = (env?.PERSISTENCE_MODE || process.env.PERSISTENCE_MODE || "sql").trim();
  if (raw === "firestore" || raw === "dual" || raw === "sql") return raw;
  // An unrecognised value is a config typo. Fail toward the legacy path rather
  // than silently promoting Postgres to primary on a misspelling.
  console.warn(`PERSISTENCE_MODE="${raw}" is not firestore|dual|sql — falling back to firestore.`);
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

/**
 * Every value `deal_status_enum` accepts (00_phase0_infra_and_org.sql:39).
 *
 * The SQL vocabulary and the client vocabulary are DIFFERENT, and only
 * `active` appears in both:
 *
 *   SQL       active | nurture | won  | lost
 *   client    active | paused  | archived | closed_won_grace
 *
 * (client side: web/domain/types.js:14 plus the closed_won_grace status that
 * web/domain/*-store.js and worker/src/jobs/deal-grace-sweep.ts use.)
 *
 * They express the same lifecycle differently rather than disagreeing: SQL
 * records a won deal as `status='won'` plus `closed_won_at`, and derives the
 * 90-day grace window from that timestamp (32_deal_closed_won.sql), where
 * Firestore stores `closed_won_grace` as its own status and has a sweep job
 * flip it to `archived`.
 *
 * A translation between the two is therefore OWED, and is deliberately not
 * guessed at here — see assertDealStatus.
 */
export const DEAL_STATUS_VALUES = ["active", "nurture", "won", "lost"] as const;
export type DealStatus = (typeof DEAL_STATUS_VALUES)[number];

/**
 * Reject a status `deal_status_enum` cannot hold, BEFORE it reaches SQL.
 *
 * Why this matters more than a clearer message: an invalid enum value does not
 * just fail its own statement, it POISONS THE WHOLE TRANSACTION. Measured on a
 * disposable cluster:
 *
 *   SELECT 'archived'::deal_status_enum
 *     -> 22P02 invalid input value for enum deal_status_enum: "archived"
 *   -- the very next statement, unrelated:
 *     -> 25P02 current transaction is aborted, commands ignored until end of
 *              transaction block
 *
 * So one bad status takes down every other write batched with it, and the
 * caller cannot recover by catching — the connection is unusable until
 * rollback. A JS throw here leaves the transaction intact, so a caller that
 * catches can carry on and the failure is attributable to one field.
 *
 * Deliberately throws rather than mapping. Mapping looks tempting
 * (`archived` -> ?, `paused` -> `nurture`, `closed_won_grace` -> `won`) but a
 * wrong guess is not cosmetic: `redact_pii()` irreversibly NULLs
 * post_call.analysis and .detail for deals with `status='lost'` older than 12
 * months, so mis-mapping anything to `lost` eventually destroys call analysis.
 * That translation needs an owner, not a default.
 */
export function assertDealStatus(status: string | undefined | null): DealStatus | undefined {
  if (status == null || status === "") return undefined;
  if ((DEAL_STATUS_VALUES as readonly string[]).includes(status)) return status as DealStatus;
  throw Object.assign(
    new Error(
      `deal.status "${status}" is not a value deal_status_enum accepts ` +
        `(${DEAL_STATUS_VALUES.join(", ")}). The client vocabulary ` +
        `(paused, archived, closed_won_grace) has no translation to SQL yet, and ` +
        `passing it through aborts the whole transaction, not just this row.`,
    ),
    { status: 422 },
  );
}

export interface DealRow {
  publicId: string;
  accountPublicId: string;
  ownerPublicId: string;
  orgUnitId: string;
  name: string;
  stage: string;
  /** Must be a deal_status_enum value — see assertDealStatus. */
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
  /** QIP catalog motion. Distinct from Deal.type. Defaults to new_business. */
  seMotion?: "new_business" | "expansion";
}

export interface PreCallRow {
  publicId: string;
  idempotencyKey?: string | null;
  activityPublicId: string;
  researchBrief?: Record<string, unknown> | null;
  inputSnapshot?: Record<string, unknown> | null;
}

/**
 * One sub-parameter verdict — the 0/1/2 the model returns.
 *
 * score is NULLABLE: null means the model returned no verdict for this
 * sub-parameter, which is not the same fact as a scored 0. Migration 22 made
 * scorecard_line.score nullable for exactly this.
 */
export interface ScorecardSubParameterRow {
  rubricParameterId: string;
  /** 1..5, position within the theme. */
  paramIndex: number;
  score: number | null;
  paramNameSnapshot: string;
  paramWeightSnapshot: number;
  /** Human-readable summary. */
  evidence?: string | null;
  /** ScorecardEvidence[] — timestamped transcript or video quotes. */
  evidenceJson?: unknown;
}

/**
 * One theme scored on the call — the domain ScorecardLine, stored in
 * scorecard_theme. 11-16 of these per scorecard.
 *
 * The three states, enforced by chk_scorecard_theme_na:
 *   scored                -> grade 0..10, neither flag set
 *   habit theme, no evidence -> grade 0, neither flag set (a REAL 0)
 *   not applicable        -> grade null, a flag set, reason REQUIRED
 */
export interface ScorecardThemeRow {
  themeKey: string;
  /** rubric_theme.id from the loaded catalog. Must exist — the catalog is
   *  loader-owned (D17) and the app has no INSERT on it. */
  rubricThemeId: string;
  /** Sum of the five sub-parameter scores. NULL when the theme is excluded. */
  grade: number | null;
  credit: number;
  category: string;
  /** Excluded from the denominator: video missing, or the incident never occurred. */
  evidenceUnavailable?: boolean;
  /** Excluded because the model omitted the theme. Same arithmetic, different fact. */
  modelOmitted?: boolean;
  /** Required whenever either exclusion flag is set. */
  notApplicableReason?: string | null;
  confidence?: number | null;
  coachingNote?: string | null;
  subParameters: ScorecardSubParameterRow[];
}

/** Deal risk incident — separate lane from habit themes (QIP section 6). */
export interface ScorecardDealRiskRow {
  category:
    | "claim_to_verify"
    | "commitment_outside_remit"
    | "missing_stakeholder"
    | "process_gap"
    | "legal_compliance";
  description: string;
  severity?: "low" | "medium" | "high" | null;
  atS?: number | null;
  quote?: string | null;
}

/**
 * A QIP scorecard, at full fidelity (D26) — every dimension its own column so
 * any aggregation can be reconstructed afterwards.
 *
 * Reshaped alongside migration 22. The old shape had a flat `lines` array and
 * no call_type, motion provenance, credits, confidence or provisional flag —
 * 13 of the 17 fields the scorer produces had nowhere to go, and
 * compositeScore could not even be stored because the column was CHECK 0..2.
 */
export interface ScorecardRow {
  publicId: string;
  activityPublicId: string;
  /** rubric.id for the (callType, seMotion, version) triple. */
  rubricId: string;
  ownerPublicId: string;
  orgUnitId: string;

  // --- Profile identity. A composite FK checks these against the rubric row,
  //     so a scorecard can never claim a (callType, seMotion) its profile
  //     does not have.
  callType: string;
  seMotion: "new_business" | "expansion";
  /**
   * How seMotion was decided. Omit it and the repository resolves it against
   * the org tree (resolve_se_motion_for_user) — which is the point: a claimed
   * motion that agrees with the hierarchy is "resolved", one that differs is
   * an "override", and no hierarchy answer at all is "defaulted" and suspect.
   * Supply it only when the caller genuinely knows better.
   */
  seMotionSource?: "resolved" | "override" | "defaulted";
  rubricVersion: string;

  // --- Scores. compositeScore is the RAW 0-10 value; the 8.0 leadership cap
  //     is applied on read, never stored, so the true score stays recoverable.
  compositeScore?: number | null;
  totalCredits?: number | null;
  includedCredits?: number | null;
  confidence?: number | null;
  /** Keyed by CategoryKey. A category with no included credits is null, not 0. */
  categoryScores?: Record<string, number | null>;

  // --- Flags
  /** Copied from the rubric when omitted, then frozen — promoting a profile
   *  later must not retroactively pull old scores into aggregates. */
  provisional?: boolean;
  leadershipShareable?: boolean;
  goldenCalibrated?: boolean;

  // --- Audit payloads. Kept for explanation, not aggregated over.
  verifierJustifications?: unknown;
  goldenJustifications?: unknown;

  /**
   * Optional. The browser persists the header and then each theme as SEPARATE
   * calls (web/domain/scorecard-service.js: upsertScorecard once, then
   * upsertScorecardLine per theme), so the header write clears existing themes
   * and each theme arrives via upsertScorecardTheme. Supplying them inline is
   * supported for server-side callers that have the whole draft at once.
   */
  themes?: ScorecardThemeRow[];
  dealRiskFlags?: ScorecardDealRiskRow[];
}

/**
 * One theme appended to an already-written scorecard.
 *
 * rubricThemeId / rubricParameterId are resolved SERVER-SIDE from theme_key
 * and param_index against the loaded catalog — the browser only knows the
 * theme key, and the catalog in SQL is authoritative anyway (D16/D17).
 */
export interface ScorecardThemeAppendRow {
  scorecardPublicId: string;
  themeKey: string;
  grade: number | null;
  credit: number;
  category: string;
  evidenceUnavailable?: boolean;
  modelOmitted?: boolean;
  notApplicableReason?: string | null;
  confidence?: number | null;
  coachingNote?: string | null;
  /** The five 0/1/2 verdicts, in order. */
  subParameters: Array<{
    score: number | null;
    evidence?: string | null;
    evidenceJson?: unknown;
  }>;
}

/**
 * The participants on one call, derived from CallIdentities.
 *
 * D9 decided five kinds: contact · se · ae · internal_leader · room.
 * CallIdentities (web/domain/dual-write.js stampCallIdentities) supplies four
 * of them — a meeting room is not in the identity stamp, so `room` rows come
 * from the transcript pass when that is wired.
 *
 * Replace-not-merge: a re-analysis recomputes the whole participant set, and
 * merging would leave someone on a call they were removed from.
 */
export interface CallParticipantsRow {
  activityPublicId: string;
  /** CallIdentities.primarySeUserId — a real app_user public_id. */
  primarySeUserPublicId?: string | null;
  /** CallIdentities.secondarySeUserIds[]. */
  secondarySeUserPublicIds?: string[];
  /** AEs are not Janus users (DealAe = {name, email}), so name/email only. */
  aeName?: string | null;
  aeEmail?: string | null;
  /** CallIdentities.contactIds[] — customer contacts. */
  contactPublicIds?: string[];
  /** Internal leaders who joined, when known. */
  internalLeaderPublicIds?: string[];
  /** Meeting rooms — a resource, identified by name alone. */
  roomNames?: string[];
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

export type DomainReadDoc = Record<string, unknown> & { id: string };

export interface DomainListScope {
  ownerId?: string;
  teamId?: string;
  orgId?: string;
}

export interface DealReadDetail {
  deal: DomainReadDoc;
  summary: DomainReadDoc | null;
  technicalCommit: DomainReadDoc | null;
  dealSignals: DomainReadDoc[];
  arrLines: DomainReadDoc[];
  productGaps: DomainReadDoc[];
  whatWorks: DomainReadDoc[];
}

export interface PostCallReadDetail {
  postCall: DomainReadDoc;
  scorecards: DomainReadDoc[];
  videoFacts: DomainReadDoc[];
  timelineSegments: DomainReadDoc[];
  timelineMarkers: DomainReadDoc[];
  followUps: DomainReadDoc[];
  objections: DomainReadDoc[];
  momDrafts: DomainReadDoc[];
  meddpiccDeltas: DomainReadDoc[];
  tcDeltas: DomainReadDoc[];
  arrLines: DomainReadDoc[];
  dealSignals: DomainReadDoc[];
}

export interface PersistenceReadPort {
  listAccounts(): Promise<DomainReadDoc[]>;
  getAccount(id: string): Promise<DomainReadDoc | null>;
  findAccountBySlug(slug: string): Promise<DomainReadDoc | null>;
  findAccountsByDomain(domain: string): Promise<DomainReadDoc[]>;
  findAccountByDomain(domain: string): Promise<DomainReadDoc | null>;
  findAccountByName(name: string): Promise<DomainReadDoc | null>;
  listContactsByAccount(accountId: string): Promise<DomainReadDoc[]>;
  findContactsByEmail(email: string): Promise<DomainReadDoc[]>;
  findContactByAccountEmail(accountId: string, email: string): Promise<DomainReadDoc | null>;
  listDeals(limitCount?: number): Promise<DomainReadDoc[]>;
  getDeal(id: string): Promise<DomainReadDoc | null>;
  getDealDetail(id: string): Promise<DealReadDetail | null>;
  listDealsByAccount(accountId: string, ownerId?: string): Promise<DomainReadDoc[]>;
  listDealsForScope(scope: DomainListScope, limitCount: number): Promise<DomainReadDoc[]>;
  findActiveDeal(accountId: string, type: string): Promise<DomainReadDoc | null>;
  getLifecycle(id: string): Promise<DomainReadDoc | null>;
  findActiveLifecycle(accountId: string, type?: string): Promise<DomainReadDoc | null>;
  listLifecycleEvents(lifecycleId: string): Promise<DomainReadDoc[]>;
  listPrepBriefsByLifecycle(lifecycleId: string): Promise<DomainReadDoc[]>;
  listPostCallsByLifecycle(lifecycleId: string, limitCount?: number): Promise<DomainReadDoc[]>;
  listPostCallsByAccount(accountId: string, limitCount?: number): Promise<DomainReadDoc[]>;
  listCallSummariesByAccount(accountId: string, limitCount?: number): Promise<DomainReadDoc[]>;
  listCallSummariesByDeal(dealId: string, limitCount?: number): Promise<DomainReadDoc[]>;
  findPostCallByIdentity(ownerId: string, callIdentityKey: string): Promise<DomainReadDoc | null>;
  listTasksByLifecycle(lifecycleId: string): Promise<DomainReadDoc[]>;
  listTasks(limitCount?: number): Promise<DomainReadDoc[]>;
  listPostCalls(limitCount?: number): Promise<DomainReadDoc[]>;
  getPostCallDetail(id: string): Promise<PostCallReadDetail | null>;
}

/**
 * The port. Every method maps to one SQL statement batch; implementations
 * must resolve public_id FKs via id_registry inside the caller's transaction.
 */
export interface PersistencePort {
  upsertAccount(client: PgClient, row: AccountRow): Promise<number>;
  /** Partial update: only the provided fields are written; absent fields are untouched. */
  patchAccount(client: PgClient, publicId: string, fields: Partial<Omit<AccountRow, "publicId">>): Promise<number>;
  seatAccountSeTeamMember(
    client: PgClient,
    row: { accountPublicId: string; seUserPublicId: string; role: "primary" | "secondary"; addedByPublicId?: string | null },
  ): Promise<void>;
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
  upsertScorecardTheme(client: PgClient, row: ScorecardThemeAppendRow): Promise<number>;
  replaceCallParticipants(client: PgClient, row: CallParticipantsRow): Promise<number>;
  upsertDetailItem(client: PgClient, row: { callPublicId: string; key: string; item: Record<string, unknown> }): Promise<number>;
  deleteDetailItem(client: PgClient, row: { callPublicId: string; key: string; itemId: string }): Promise<number>;
  clearDetailKeys(client: PgClient, row: { callPublicId: string; keys: string[] }): Promise<number>;
  upsertTask(client: PgClient, row: Record<string, unknown> & { publicId: string; ownerPublicId: string; title: string }): Promise<number>;
  softDeleteTask(client: PgClient, publicId: string): Promise<number>;
  addContactEvent(client: PgClient, row: { publicId: string; contactPublicId: string; eventType: string; actorPublicId?: string | null; payload?: unknown }): Promise<number>;
  upsertDealSummary(client: PgClient, row: { publicId: string; dealPublicId: string; summary?: string | null; payload?: unknown }): Promise<number>;
  upsertAccountSummary(client: PgClient, row: { publicId: string; accountPublicId: string; summary?: string | null; payload?: unknown }): Promise<number>;
  upsertTechnicalCommit(client: PgClient, row: { publicId: string; dealPublicId: string; accountPublicId: string; ownerPublicId: string; orgUnitId: string; payload?: unknown }): Promise<number>;
  addArrOverride(client: PgClient, row: { publicId: string; dealPublicId: string; previousValue?: number | null; newValue: number; reason: string; createdByPublicId?: string | null }): Promise<number>;
  upsertSignalCluster(client: PgClient, row: Record<string, unknown> & { publicId: string; name: string }): Promise<number>;
  upsertClusteringState(client: PgClient, row: { pendingGapCount?: number; lastIncrementalAt?: string | null; lastFullRunAt?: string | null; running?: boolean }): Promise<number>;
  upsertProductSignal(client: PgClient, row: ProductSignalRow): Promise<number>;

  /** Enqueue a Firestore projection for the just-written row (same tx). */
  enqueueOutbox(
    client: PgClient,
    entry: { entityType: string; entityId: string; operation: string; payload: Record<string, unknown> },
  ): Promise<void>;
}
