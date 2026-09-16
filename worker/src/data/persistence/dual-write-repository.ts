/**
 * DualWriteRepository — transition-mode PersistencePort (Design B).
 *
 * SQL is primary: every write runs inside the caller's withSessionContext
 * transaction, and a sync_outbox row is enqueued in the SAME transaction.
 * The OutboxProjector (internal cron) projects pending rows to Firestore so
 * legacy readers keep working. There are no independent dual writes — if the
 * SQL transaction rolls back, no outbox row exists, so nothing projects.
 *
 * The Firestore payload is the legacy document shape (same as
 * FirestoreRepository writes), built from the row input.
 */

import type { PgClient } from "./postgres-pool";
import { PostgresRepository } from "./postgres-repository";
import { canonicalizeSeMotion } from "../../domain-model/se-motion";
import { scorecardLinesForFirestore } from "./firestore-repository";
import type {
  AccountRow,
  ActivityRow,
  ContactRow,
  DealContactRow,
  DealRow,
  PersistencePort,
  PostCallRow,
  PreCallRow,
  ProductSignalRow,
  ScorecardRow,
  CallParticipantsRow,
  ScorecardThemeAppendRow,
} from "./types";

export class DualWriteRepository implements PersistencePort {
  private pg = new PostgresRepository();

  async upsertAccount(client: PgClient, row: AccountRow): Promise<number> {
    const id = await this.pg.upsertAccount(client, row);
    await this.pg.enqueueOutbox(client, {
      entityType: "account", entityId: row.publicId, operation: "update",
      payload: {
        name: row.name, domain: row.domain ?? null, slug: row.slug ?? null,
        industry: row.industry ?? null, health: row.healthData ?? null,
        externalRef: row.externalRef ?? null,
      },
    });
    return id;
  }

  async patchAccount(
    client: PgClient,
    publicId: string,
    fields: Partial<Omit<AccountRow, "publicId">>,
  ): Promise<number> {
    const id = await this.pg.patchAccount(client, publicId, fields);
    const payload: Record<string, unknown> = {};
    if (fields.name !== undefined) payload.name = fields.name;
    if (fields.domain !== undefined) payload.domain = fields.domain ?? null;
    if (fields.slug !== undefined) payload.slug = fields.slug ?? null;
    if (fields.industry !== undefined) payload.industry = fields.industry ?? null;
    if (fields.healthData !== undefined) payload.health = fields.healthData ?? null;
    if (fields.externalRef !== undefined) payload.externalRef = fields.externalRef ?? null;
    await this.pg.enqueueOutbox(client, {
      entityType: "account", entityId: publicId, operation: "update", payload,
    });
    return id;
  }

  async seatAccountSeTeamMember(
    client: PgClient,
    row: { accountPublicId: string; seUserPublicId: string; role: "primary" | "secondary"; addedByPublicId?: string | null },
  ): Promise<void> {
    // No outbox projection here -- account_se_team is a Postgres-only concept
    // (Account.seTeam on the Firestore side is a denormalized array on the
    // account doc, a different shape). patchAccount's own outbox row already
    // covers the account fields that do have a Firestore equivalent.
    await this.pg.seatAccountSeTeamMember(client, row);
  }

  async upsertContact(client: PgClient, row: ContactRow): Promise<number> {
    const id = await this.pg.upsertContact(client, row);
    await this.pg.enqueueOutbox(client, {
      entityType: "contact", entityId: row.publicId, operation: "update",
      payload: {
        accountId: row.accountPublicId, email: row.email.toLowerCase(),
        name: row.name ?? null, title: row.title ?? null, role: row.role ?? null,
      },
    });
    return id;
  }

  async patchContact(
    client: PgClient,
    publicId: string,
    fields: Partial<Omit<ContactRow, "publicId">>,
  ): Promise<number> {
    const id = await this.pg.patchContact(client, publicId, fields);
    const payload: Record<string, unknown> = {};
    if (fields.accountPublicId !== undefined) payload.accountId = fields.accountPublicId;
    if (fields.email !== undefined) payload.email = fields.email.toLowerCase();
    if (fields.name !== undefined) payload.name = fields.name ?? null;
    if (fields.title !== undefined) payload.title = fields.title ?? null;
    if (fields.role !== undefined) payload.role = fields.role ?? null;
    await this.pg.enqueueOutbox(client, {
      entityType: "contact", entityId: publicId, operation: "update", payload,
    });
    return id;
  }

  async upsertDeal(client: PgClient, row: DealRow): Promise<number> {
    const id = await this.pg.upsertDeal(client, row);
    await this.pg.enqueueOutbox(client, {
      entityType: "deal", entityId: row.publicId, operation: "update",
      payload: {
        accountId: row.accountPublicId, ownerId: row.ownerPublicId,
        teamId: row.orgUnitId, title: row.name, stage: row.stage,
        status: row.status ?? "active", amount: row.amount ?? null,
        currency: row.currencyCode ?? "USD",
      },
    });
    return id;
  }

  async patchDeal(
    client: PgClient,
    publicId: string,
    fields: Partial<Omit<DealRow, "publicId">>,
  ): Promise<number> {
    const id = await this.pg.patchDeal(client, publicId, fields);
    const payload: Record<string, unknown> = {};
    if (fields.accountPublicId !== undefined) payload.accountId = fields.accountPublicId;
    if (fields.ownerPublicId !== undefined) payload.ownerId = fields.ownerPublicId;
    if (fields.orgUnitId !== undefined) payload.teamId = fields.orgUnitId;
    if (fields.name !== undefined) payload.title = fields.name;
    if (fields.stage !== undefined) payload.stage = fields.stage;
    if (fields.status !== undefined) payload.status = fields.status ?? "active";
    if (fields.amount !== undefined) payload.amount = fields.amount ?? null;
    if (fields.currencyCode !== undefined) payload.currency = fields.currencyCode ?? "USD";
    await this.pg.enqueueOutbox(client, {
      entityType: "deal", entityId: publicId, operation: "update", payload,
    });
    return id;
  }

  async upsertDealContact(client: PgClient, row: DealContactRow): Promise<number> {
    const id = await this.pg.upsertDealContact(client, row);
    await this.pg.enqueueOutbox(client, {
      entityType: "deal_contact", entityId: row.publicId, operation: "update",
      payload: {
        dealId: row.dealPublicId, contactId: row.contactPublicId,
        role: row.role ?? null, isPrimary: row.isPrimary ?? false,
      },
    });
    return id;
  }

  async setPrimaryDealContact(client: PgClient, dealPublicId: string, contactPublicId: string): Promise<void> {
    await this.pg.setPrimaryDealContact(client, dealPublicId, contactPublicId);
    // Project the new primary AND any demoted contacts so Firestore doesn't
    // retain multiple isPrimary: true docs. entityId matches the legacy
    // dealContactId (`${dealId}_${contactId}`) used by applyDomainWrite.
    const demoted = await this.pg.listNonPrimaryDealContacts(client, dealPublicId, contactPublicId);
    await this.pg.enqueueOutbox(client, {
      entityType: "deal_contact", entityId: `${dealPublicId}_${contactPublicId}`, operation: "update",
      payload: { dealId: dealPublicId, contactId: contactPublicId, isPrimary: true },
    });
    for (const contactId of demoted) {
      await this.pg.enqueueOutbox(client, {
        entityType: "deal_contact", entityId: `${dealPublicId}_${contactId}`, operation: "update",
        payload: { dealId: dealPublicId, contactId, isPrimary: false },
      });
    }
  }

  async removeDealContact(client: PgClient, dealPublicId: string, contactPublicId: string): Promise<void> {
    await this.pg.removeDealContact(client, dealPublicId, contactPublicId);
    await this.pg.enqueueOutbox(client, {
      entityType: "deal_contact", entityId: `${dealPublicId}_${contactPublicId}`, operation: "delete",
      payload: { dealId: dealPublicId, contactId: contactPublicId },
    });
  }

  async upsertActivity(client: PgClient, row: ActivityRow): Promise<number> {
    const id = await this.pg.upsertActivity(client, row);
    await this.pg.enqueueOutbox(client, {
      entityType: "activity", entityId: row.publicId, operation: "update",
      payload: {
        dealId: row.dealPublicId ?? null, accountId: row.accountPublicId,
        ownerId: row.ownerPublicId, teamId: row.orgUnitId,
        type: row.activityType, subject: row.subject ?? null, occurredAt: row.occurredAt,
      },
    });
    return id;
  }

  async upsertPreCall(client: PgClient, row: PreCallRow): Promise<number> {
    const id = await this.pg.upsertPreCall(client, row);
    await this.pg.enqueueOutbox(client, {
      entityType: "pre_call", entityId: row.publicId, operation: "update",
      payload: {
        activityId: row.activityPublicId,
        brief: row.researchBrief ?? null, input: row.inputSnapshot ?? null,
      },
    });
    return id;
  }

  async upsertPostCall(client: PgClient, row: PostCallRow): Promise<number> {
    const id = await this.pg.upsertPostCall(client, row);
    await this.pg.enqueueOutbox(client, {
      entityType: "post_call", entityId: row.publicId, operation: "update",
      payload: {
        activityId: row.activityPublicId, transcriptRef: row.transcriptRef ?? null,
        analysis: row.analysis ?? null, detail: row.detail ?? null,
        pipelineState: row.pipelineState ?? "ingested",
        seMotion: canonicalizeSeMotion(row.seMotion),
      },
    });
    return id;
  }

  async upsertScorecard(client: PgClient, row: ScorecardRow): Promise<number> {
    const id = await this.pg.upsertScorecard(client, row);
    await this.pg.enqueueOutbox(client, {
      entityType: "scorecard", entityId: row.publicId, operation: "update",
      payload: {
        activityId: row.activityPublicId, rubricId: row.rubricId,
        ownerId: row.ownerPublicId, teamId: row.orgUnitId,
        compositeScore: row.compositeScore ?? null,
        lines: scorecardLinesForFirestore(row),
        callType: row.callType,
        seMotionSource: row.seMotionSource,
        rubricVersion: row.rubricVersion,
        seMotion: canonicalizeSeMotion(row.seMotion),
      },
    });
    return id;
  }

  async upsertScorecardTheme(client: PgClient, row: ScorecardThemeAppendRow): Promise<number> {
    const id = await this.pg.upsertScorecardTheme(client, row);
    await this.pg.enqueueOutbox(client, {
      entityType: "scorecard_theme",
      entityId: `${row.scorecardPublicId}__${row.themeKey}`,
      operation: "update",
      payload: {
        scorecardId: row.scorecardPublicId,
        themeKey: row.themeKey,
        grade: row.grade,
        credit: row.credit,
        category: row.category,
        subParameters: row.subParameters,
        evidenceUnavailable: !!row.evidenceUnavailable,
        modelOmitted: !!row.modelOmitted,
        notApplicableReason: row.notApplicableReason ?? null,
        confidence: row.confidence ?? null,
        coachingNote: row.coachingNote ?? null,
      },
    });
    return id;
  }

  async replaceCallParticipants(client: PgClient, row: CallParticipantsRow): Promise<number> {
    // No outbox row: Firestore keeps participants on the postCalls doc as
    // postCall.identities, which upsertPostCall already projects. Enqueuing
    // here would project the same fact twice.
    return this.pg.replaceCallParticipants(client, row);
  }

  async upsertDetailItem(client: PgClient, ...a: unknown[]): Promise<number> {
    // No outbox row: sql mode has no Firestore projection.
    return (this.pg as unknown as Record<string, (...x: unknown[]) => Promise<number>>).upsertDetailItem(client, ...a);
  }

  async deleteDetailItem(client: PgClient, ...a: unknown[]): Promise<number> {
    // No outbox row: sql mode has no Firestore projection.
    return (this.pg as unknown as Record<string, (...x: unknown[]) => Promise<number>>).deleteDetailItem(client, ...a);
  }

  async clearDetailKeys(client: PgClient, ...a: unknown[]): Promise<number> {
    // No outbox row: sql mode has no Firestore projection.
    return (this.pg as unknown as Record<string, (...x: unknown[]) => Promise<number>>).clearDetailKeys(client, ...a);
  }

  async upsertTask(client: PgClient, ...a: unknown[]): Promise<number> {
    // No outbox row: sql mode has no Firestore projection.
    return (this.pg as unknown as Record<string, (...x: unknown[]) => Promise<number>>).upsertTask(client, ...a);
  }

  async softDeleteTask(client: PgClient, ...a: unknown[]): Promise<number> {
    // No outbox row: sql mode has no Firestore projection.
    return (this.pg as unknown as Record<string, (...x: unknown[]) => Promise<number>>).softDeleteTask(client, ...a);
  }

  async addContactEvent(client: PgClient, ...a: unknown[]): Promise<number> {
    // No outbox row: sql mode has no Firestore projection.
    return (this.pg as unknown as Record<string, (...x: unknown[]) => Promise<number>>).addContactEvent(client, ...a);
  }

  async upsertDealSummary(client: PgClient, ...a: unknown[]): Promise<number> {
    // No outbox row: sql mode has no Firestore projection.
    return (this.pg as unknown as Record<string, (...x: unknown[]) => Promise<number>>).upsertDealSummary(client, ...a);
  }

  async upsertAccountSummary(client: PgClient, ...a: unknown[]): Promise<number> {
    // No outbox row: sql mode has no Firestore projection.
    return (this.pg as unknown as Record<string, (...x: unknown[]) => Promise<number>>).upsertAccountSummary(client, ...a);
  }

  async upsertTechnicalCommit(client: PgClient, ...a: unknown[]): Promise<number> {
    // No outbox row: sql mode has no Firestore projection.
    return (this.pg as unknown as Record<string, (...x: unknown[]) => Promise<number>>).upsertTechnicalCommit(client, ...a);
  }

  async addArrOverride(client: PgClient, ...a: unknown[]): Promise<number> {
    // No outbox row: sql mode has no Firestore projection.
    return (this.pg as unknown as Record<string, (...x: unknown[]) => Promise<number>>).addArrOverride(client, ...a);
  }

  async upsertSignalCluster(client: PgClient, ...a: unknown[]): Promise<number> {
    // No outbox row: sql mode has no Firestore projection.
    return (this.pg as unknown as Record<string, (...x: unknown[]) => Promise<number>>).upsertSignalCluster(client, ...a);
  }

  async upsertClusteringState(client: PgClient, ...a: unknown[]): Promise<number> {
    // No outbox row: sql mode has no Firestore projection.
    return (this.pg as unknown as Record<string, (...x: unknown[]) => Promise<number>>).upsertClusteringState(client, ...a);
  }

  async upsertProductSignal(client: PgClient, row: ProductSignalRow): Promise<number> {
    const id = await this.pg.upsertProductSignal(client, row);
    await this.pg.enqueueOutbox(client, {
      entityType: "product_signal", entityId: row.publicId, operation: "update",
      payload: {
        activityId: row.activityPublicId ?? null, accountId: row.accountPublicId,
        ownerId: row.ownerPublicId, teamId: row.orgUnitId,
        source: row.source ?? "ai_extracted", signalType: row.signalType,
        signalKey: row.signalKey ?? null, title: row.title,
        description: row.description ?? null, evidence: row.evidence ?? null,
      },
    });
    return id;
  }

  async enqueueOutbox(
    client: PgClient,
    entry: { entityType: string; entityId: string; operation: string; payload: Record<string, unknown> },
  ): Promise<void> {
    await this.pg.enqueueOutbox(client, entry);
  }
}

/** Mode-aware factory: the single place that decides which port a request gets. */
export function resolvePersistencePort(env: {
  PERSISTENCE_MODE?: string;
}): PersistencePort | null {
  // Default "sql" — see resolvePersistenceMode in types.ts for rationale.
  const mode = (env.PERSISTENCE_MODE || process.env.PERSISTENCE_MODE || "sql").trim();
  if (mode === "sql" || mode === "dual") return mode === "dual" ? new DualWriteRepository() : new PostgresRepository();
  return null; // firestore mode: legacy paths (applyDomainWrite) stay in charge
}
