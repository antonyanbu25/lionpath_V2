/**
 * FirestoreRepository — PersistencePort implementation for the legacy store.
 *
 * Used when PERSISTENCE_MODE=firestore (today's production behavior). Writes
 * plain documents via the admin SDK; no id_registry, no RLS — scoping stays
 * in worker/src/data/scope.ts as it does today.
 *
 * The `client` parameter is ignored (no transaction in Firestore mode); the
 * port keeps it in the signature so call sites are mode-agnostic.
 */

import { getDb, type FirestoreEnv } from "../firestore-admin";
import type { PgClient } from "./postgres-pool";
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
} from "./types";

export class FirestoreRepository implements PersistencePort {
  constructor(private env: FirestoreEnv) {}

  private async setDoc(collection: string, id: string, data: Record<string, unknown>): Promise<number> {
    const db = await getDb(this.env);
    await db.collection(collection).doc(id).set({ ...data, id }, { merge: true });
    return 0; // no internal bigint id in Firestore mode
  }

  async upsertAccount(_c: PgClient, row: AccountRow): Promise<number> {
    return this.setDoc("accounts", row.publicId, {
      name: row.name, domain: row.domain ?? null, slug: row.slug ?? null,
      industry: row.industry ?? null, health: row.healthData ?? null,
      externalRef: row.externalRef ?? null,
    });
  }

  private async patchDoc(collection: string, id: string, data: Record<string, unknown>): Promise<number> {
    const db = await getDb(this.env);
    await db.collection(collection).doc(id).set({ ...data, updatedAt: Date.now() }, { merge: true });
    return 0;
  }

  async patchAccount(_c: PgClient, publicId: string, fields: Partial<Omit<AccountRow, "publicId">>): Promise<number> {
    const data: Record<string, unknown> = {};
    if (fields.name !== undefined) data.name = fields.name;
    if (fields.domain !== undefined) data.domain = fields.domain ?? null;
    if (fields.slug !== undefined) data.slug = fields.slug ?? null;
    if (fields.industry !== undefined) data.industry = fields.industry ?? null;
    if (fields.healthData !== undefined) data.health = fields.healthData ?? null;
    if (fields.externalRef !== undefined) data.externalRef = fields.externalRef ?? null;
    return this.patchDoc("accounts", publicId, data);
  }

  async patchContact(_c: PgClient, publicId: string, fields: Partial<Omit<ContactRow, "publicId">>): Promise<number> {
    const data: Record<string, unknown> = {};
    if (fields.accountPublicId !== undefined) data.accountId = fields.accountPublicId;
    if (fields.email !== undefined) data.email = fields.email.toLowerCase();
    if (fields.name !== undefined) data.name = fields.name ?? null;
    if (fields.title !== undefined) data.title = fields.title ?? null;
    if (fields.role !== undefined) data.role = fields.role ?? null;
    return this.patchDoc("contacts", publicId, data);
  }

  async patchDeal(_c: PgClient, publicId: string, fields: Partial<Omit<DealRow, "publicId">>): Promise<number> {
    const data: Record<string, unknown> = {};
    if (fields.accountPublicId !== undefined) data.accountId = fields.accountPublicId;
    if (fields.ownerPublicId !== undefined) data.ownerId = fields.ownerPublicId;
    if (fields.orgUnitId !== undefined) data.teamId = fields.orgUnitId;
    if (fields.name !== undefined) data.title = fields.name;
    if (fields.stage !== undefined) data.stage = fields.stage;
    if (fields.status !== undefined) data.status = fields.status ?? "active";
    if (fields.amount !== undefined) data.amount = fields.amount ?? null;
    if (fields.currencyCode !== undefined) data.currency = fields.currencyCode ?? "USD";
    return this.patchDoc("deals", publicId, data);
  }

  async upsertContact(_c: PgClient, row: ContactRow): Promise<number> {
    return this.setDoc("contacts", row.publicId, {
      accountId: row.accountPublicId, email: row.email.toLowerCase(),
      name: row.name ?? null, title: row.title ?? null, role: row.role ?? null,
    });
  }

  async upsertDeal(_c: PgClient, row: DealRow): Promise<number> {
    return this.setDoc("deals", row.publicId, {
      accountId: row.accountPublicId, ownerId: row.ownerPublicId,
      teamId: row.orgUnitId, title: row.name, stage: row.stage,
      status: row.status ?? "active", amount: row.amount ?? null,
      currency: row.currencyCode ?? "USD",
    });
  }

  async upsertDealContact(_c: PgClient, row: DealContactRow): Promise<number> {
    return this.setDoc("dealContacts", row.publicId, {
      dealId: row.dealPublicId, contactId: row.contactPublicId,
      role: row.role ?? null, isPrimary: row.isPrimary ?? false,
    });
  }

  async setPrimaryDealContact(_c: PgClient, dealPublicId: string, contactPublicId: string): Promise<void> {
    const db = await getDb(this.env);
    const snap = await db.collection("dealContacts").where("dealId", "==", dealPublicId).get();
    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.set(doc.ref, { isPrimary: doc.data().contactId === contactPublicId }, { merge: true });
    }
    await batch.commit();
  }

  async removeDealContact(_c: PgClient, dealPublicId: string, contactPublicId: string): Promise<void> {
    const db = await getDb(this.env);
    const snap = await db
      .collection("dealContacts")
      .where("dealId", "==", dealPublicId)
      .where("contactId", "==", contactPublicId)
      .get();
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
  }

  async upsertActivity(_c: PgClient, row: ActivityRow): Promise<number> {
    return this.setDoc("activities", row.publicId, {
      dealId: row.dealPublicId ?? null, accountId: row.accountPublicId,
      ownerId: row.ownerPublicId, teamId: row.orgUnitId,
      type: row.activityType, subject: row.subject ?? null, occurredAt: row.occurredAt,
    });
  }

  async upsertPreCall(_c: PgClient, row: PreCallRow): Promise<number> {
    return this.setDoc("prepBriefs", row.publicId, {
      activityId: row.activityPublicId,
      brief: row.researchBrief ?? null, input: row.inputSnapshot ?? null,
    });
  }

  async upsertPostCall(_c: PgClient, row: PostCallRow): Promise<number> {
    return this.setDoc("postCalls", row.publicId, {
      activityId: row.activityPublicId, transcriptRef: row.transcriptRef ?? null,
      analysis: row.analysis ?? null, detail: row.detail ?? null,
      pipelineState: row.pipelineState ?? "ingested",
    });
  }

  async upsertScorecard(_c: PgClient, row: ScorecardRow): Promise<number> {
    return this.setDoc("scorecards", row.publicId, {
      activityId: row.activityPublicId, rubricId: row.rubricId,
      ownerId: row.ownerPublicId, teamId: row.orgUnitId,
      compositeScore: row.compositeScore ?? null, lines: row.lines,
    });
  }

  async upsertProductSignal(_c: PgClient, row: ProductSignalRow): Promise<number> {
    return this.setDoc("productGaps", row.publicId, {
      activityId: row.activityPublicId ?? null, accountId: row.accountPublicId,
      ownerId: row.ownerPublicId, teamId: row.orgUnitId,
      source: row.source ?? "ai_extracted", signalType: row.signalType,
      signalKey: row.signalKey ?? null, title: row.title,
      description: row.description ?? null, evidence: row.evidence ?? null,
    });
  }

  async enqueueOutbox(): Promise<void> {
    // No-op in Firestore mode: Firestore is the primary store, nothing to project.
  }
}
