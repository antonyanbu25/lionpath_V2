/**
 * PostgresRepository — PersistencePort implementation against Janus v9.3.
 *
 * Every method:
 *   - runs inside the caller's withSessionContext transaction (RLS applies)
 *   - resolves public_id FKs via id_registry in the same transaction
 *   - is idempotent via ON CONFLICT (public_id) / idempotency keys
 */

import type { PgClient } from "./postgres-pool";
import { registerId, resolveInternalId, upsertReturningId } from "./id-registry";
import { getFirestoreProjectionIntegrationId } from "./outbox";
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

export class PostgresRepository implements PersistencePort {
  async upsertAccount(client: PgClient, row: AccountRow): Promise<number> {
    return upsertReturningId(
      client,
      "account",
      "account",
      `INSERT INTO account (public_id, name, domain, slug, industry, health_data, external_ref, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (public_id) DO UPDATE SET
         name = EXCLUDED.name, domain = EXCLUDED.domain, slug = EXCLUDED.slug,
         industry = EXCLUDED.industry, health_data = EXCLUDED.health_data,
         external_ref = EXCLUDED.external_ref, updated_at = now()
       RETURNING id`,
      [
        row.publicId, row.name, row.domain ?? null, row.slug ?? null,
        row.industry ?? null, row.healthData ? JSON.stringify(row.healthData) : null,
        row.externalRef ?? null,
      ],
      row.publicId,
    );
  }

  async patchAccount(
    client: PgClient,
    publicId: string,
    fields: Partial<Omit<AccountRow, "publicId">>,
  ): Promise<number> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (fields.name !== undefined) push("name", fields.name);
    if (fields.domain !== undefined) push("domain", fields.domain ?? null);
    if (fields.slug !== undefined) push("slug", fields.slug ?? null);
    if (fields.industry !== undefined) push("industry", fields.industry ?? null);
    if (fields.healthData !== undefined) push("health_data", fields.healthData ? JSON.stringify(fields.healthData) : null);
    if (fields.externalRef !== undefined) push("external_ref", fields.externalRef ?? null);
    if (sets.length === 0) {
      return resolveInternalId(client, "account", publicId);
    }
    vals.push(publicId);
    const res = await client.query(
      `UPDATE account SET ${sets.join(", ")}, updated_at = now() WHERE public_id = $${vals.length} RETURNING id`,
      vals,
    );
    if (res.rows.length === 0) throw new Error(`patchAccount: no account with public_id=${publicId}`);
    return (res.rows[0] as { id: number }).id;
  }

  async upsertContact(client: PgClient, row: ContactRow): Promise<number> {
    const accountId = await resolveInternalId(client, "account", row.accountPublicId);
    const email = row.email.toLowerCase();
    const existing = await client.query(
      `SELECT id, public_id FROM contact
       WHERE account_id = $1 AND email = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [accountId, email],
    );
    if (existing.rows[0]) {
      const id = Number((existing.rows[0] as { id: number | string }).id);
      const oldPublicId = (existing.rows[0] as { public_id: string }).public_id;
      await registerId(client, "contact", oldPublicId, id);
      await client.query(
        `UPDATE contact SET name = $2, title = $3, role = $4, updated_at = now()
         WHERE id = $1`,
        [id, row.name ?? null, row.title ?? null, row.role ?? null],
      );
      await registerId(client, "contact", row.publicId, id);
      return id;
    }
    return upsertReturningId(
      client,
      "contact",
      "contact",
      `INSERT INTO contact (public_id, account_id, email, name, title, role, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (public_id) DO UPDATE SET
         account_id = EXCLUDED.account_id, email = EXCLUDED.email, name = EXCLUDED.name,
         title = EXCLUDED.title, role = EXCLUDED.role, updated_at = now()
       RETURNING id`,
      [row.publicId, accountId, email, row.name ?? null, row.title ?? null, row.role ?? null],
      row.publicId,
    );
  }

  async patchContact(
    client: PgClient,
    publicId: string,
    fields: Partial<Omit<ContactRow, "publicId">>,
  ): Promise<number> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (fields.accountPublicId !== undefined) {
      const accountId = await resolveInternalId(client, "account", fields.accountPublicId);
      push("account_id", accountId);
    }
    if (fields.email !== undefined) push("email", fields.email.toLowerCase());
    if (fields.name !== undefined) push("name", fields.name ?? null);
    if (fields.title !== undefined) push("title", fields.title ?? null);
    if (fields.role !== undefined) push("role", fields.role ?? null);
    if (sets.length === 0) return resolveInternalId(client, "contact", publicId);
    vals.push(publicId);
    const res = await client.query(
      `UPDATE contact SET ${sets.join(", ")}, updated_at = now() WHERE public_id = $${vals.length} RETURNING id`,
      vals,
    );
    if (res.rows.length === 0) throw new Error(`patchContact: no contact with public_id=${publicId}`);
    return (res.rows[0] as { id: number }).id;
  }

  async upsertDeal(client: PgClient, row: DealRow): Promise<number> {
    const accountId = await resolveInternalId(client, "account", row.accountPublicId);
    const ownerId = await resolveInternalId(client, "app_user", row.ownerPublicId);
    return upsertReturningId(
      client,
      "deal",
      "deal",
      `INSERT INTO deal (public_id, account_id, owner_user_id, org_unit_id, name, stage, status, amount, currency_code, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (public_id) DO UPDATE SET
         account_id = EXCLUDED.account_id, owner_user_id = EXCLUDED.owner_user_id,
         org_unit_id = EXCLUDED.org_unit_id, name = EXCLUDED.name, stage = EXCLUDED.stage,
         status = EXCLUDED.status, amount = EXCLUDED.amount, currency_code = EXCLUDED.currency_code,
         updated_at = now()
       RETURNING id`,
      [
        row.publicId, accountId, ownerId, row.orgUnitId, row.name,
        row.stage, row.status ?? "active", row.amount ?? null, row.currencyCode ?? "USD",
      ],
      row.publicId,
    );
  }

  async patchDeal(
    client: PgClient,
    publicId: string,
    fields: Partial<Omit<DealRow, "publicId">>,
  ): Promise<number> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (fields.accountPublicId !== undefined) {
      push("account_id", await resolveInternalId(client, "account", fields.accountPublicId));
    }
    if (fields.ownerPublicId !== undefined) {
      push("owner_user_id", await resolveInternalId(client, "app_user", fields.ownerPublicId));
    }
    if (fields.orgUnitId !== undefined) push("org_unit_id", fields.orgUnitId);
    if (fields.name !== undefined) push("name", fields.name);
    if (fields.stage !== undefined) push("stage", fields.stage);
    if (fields.status !== undefined) push("status", fields.status ?? "active");
    if (fields.amount !== undefined) push("amount", fields.amount ?? null);
    if (fields.currencyCode !== undefined) push("currency_code", fields.currencyCode ?? "USD");
    if (sets.length === 0) return resolveInternalId(client, "deal", publicId);
    vals.push(publicId);
    const res = await client.query(
      `UPDATE deal SET ${sets.join(", ")}, updated_at = now() WHERE public_id = $${vals.length} RETURNING id`,
      vals,
    );
    if (res.rows.length === 0) throw new Error(`patchDeal: no deal with public_id=${publicId}`);
    return (res.rows[0] as { id: number }).id;
  }

  async upsertDealContact(client: PgClient, row: DealContactRow): Promise<number> {
    const dealId = await resolveInternalId(client, "deal", row.dealPublicId);
    const contactId = await resolveInternalId(client, "contact", row.contactPublicId);
    return upsertReturningId(
      client,
      "deal_contact",
      "deal_contact",
      `INSERT INTO deal_contact (public_id, deal_id, contact_id, role, is_primary, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (deal_id, contact_id) DO UPDATE SET
         role = EXCLUDED.role, is_primary = EXCLUDED.is_primary, updated_at = now()
       RETURNING id`,
      [row.publicId, dealId, contactId, row.role ?? null, row.isPrimary ?? false],
      row.publicId,
    );
  }

  async setPrimaryDealContact(
    client: PgClient,
    dealPublicId: string,
    contactPublicId: string,
  ): Promise<void> {
    const dealId = await resolveInternalId(client, "deal", dealPublicId);
    const contactId = await resolveInternalId(client, "contact", contactPublicId);
    // Partial unique index idx_deal_contact_primary enforces one primary.
    await client.query(
      `UPDATE deal_contact SET is_primary = false, updated_at = now() WHERE deal_id = $1 AND is_primary`,
      [dealId],
    );
    await client.query(
      `UPDATE deal_contact SET is_primary = true, updated_at = now() WHERE deal_id = $1 AND contact_id = $2`,
      [dealId, contactId],
    );
  }

  async removeDealContact(client: PgClient,
    dealPublicId: string,
    contactPublicId: string,
  ): Promise<void> {
    const dealId = await resolveInternalId(client, "deal", dealPublicId);
    const contactId = await resolveInternalId(client, "contact", contactPublicId);
    await client.query(
      `UPDATE deal_contact SET deleted_at = now(), is_primary = false, updated_at = now()
       WHERE deal_id = $1 AND contact_id = $2 AND deleted_at IS NULL`,
      [dealId, contactId],
    );
  }

  /** Public IDs of a deal's active contacts excluding one (for demotion outbox fan-out). */
  async listNonPrimaryDealContacts(
    client: PgClient,
    dealPublicId: string,
    excludeContactPublicId: string,
  ): Promise<string[]> {
    const dealId = await resolveInternalId(client, "deal", dealPublicId);
    const res = await client.query(
      `SELECT c.public_id FROM deal_contact dc
       JOIN contact c ON c.id = dc.contact_id
       WHERE dc.deal_id = $1 AND dc.deleted_at IS NULL
         AND c.public_id <> $2`,
      [dealId, excludeContactPublicId],
    );
    return (res.rows as Array<{ public_id: string }>).map((r) => r.public_id);
  }

  async upsertActivity(client: PgClient, row: ActivityRow): Promise<number> {
    const accountId = await resolveInternalId(client, "account", row.accountPublicId);
    const ownerId = await resolveInternalId(client, "app_user", row.ownerPublicId);
    const dealId = row.dealPublicId
      ? await resolveInternalId(client, "deal", row.dealPublicId)
      : null;
    return upsertReturningId(
      client,
      "activity",
      "activity",
      `WITH upserted AS (
         INSERT INTO activity (public_id, idempotency_key, deal_id, account_id, owner_user_id, org_unit_id, activity_type, subject, occurred_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET
           deal_id = EXCLUDED.deal_id, subject = EXCLUDED.subject,
           occurred_at = EXCLUDED.occurred_at, updated_at = now()
         RETURNING id
       )
       SELECT id FROM upserted
       UNION ALL
       SELECT id FROM activity WHERE idempotency_key = $2 AND $2 IS NOT NULL
       LIMIT 1`,
      [
        row.publicId, row.idempotencyKey ?? null, dealId, accountId, ownerId,
        row.orgUnitId, row.activityType, row.subject ?? null, row.occurredAt,
      ],
      row.publicId,
    );
  }

  async upsertPreCall(client: PgClient, row: PreCallRow): Promise<number> {
    const activityId = await resolveInternalId(client, "activity", row.activityPublicId);
    return upsertReturningId(
      client,
      "pre_call",
      "pre_call",
      `INSERT INTO pre_call (public_id, idempotency_key, activity_id, research_brief, input_snapshot, generated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET
         research_brief = EXCLUDED.research_brief, input_snapshot = EXCLUDED.input_snapshot
       RETURNING id`,
      [
        row.publicId, row.idempotencyKey ?? null, activityId,
        row.researchBrief ? JSON.stringify(row.researchBrief) : null,
        row.inputSnapshot ? JSON.stringify(row.inputSnapshot) : null,
      ],
      row.publicId,
    );
  }

  async upsertPostCall(client: PgClient, row: PostCallRow): Promise<number> {
    const activityId = await resolveInternalId(client, "activity", row.activityPublicId);
    return upsertReturningId(
      client,
      "post_call",
      "post_call",
      `INSERT INTO post_call (public_id, idempotency_key, activity_id, transcript_ref, analysis, detail, pipeline_state, analysis_shape_version, detail_shape_version, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET
         transcript_ref = EXCLUDED.transcript_ref, analysis = EXCLUDED.analysis,
         detail = EXCLUDED.detail, pipeline_state = EXCLUDED.pipeline_state,
         analysis_shape_version = EXCLUDED.analysis_shape_version,
         detail_shape_version = EXCLUDED.detail_shape_version, updated_at = now()
       RETURNING id`,
      [
        row.publicId, row.idempotencyKey ?? null, activityId, row.transcriptRef ?? null,
        row.analysis ? JSON.stringify(row.analysis) : null,
        row.detail ? JSON.stringify(row.detail) : null,
        row.pipelineState ?? "ingested",
        row.analysisShapeVersion ?? "1",
        row.detailShapeVersion ?? "1",
      ],
      row.publicId,
    );
  }

  async upsertScorecard(client: PgClient, row: ScorecardRow): Promise<number> {
    const activityId = await resolveInternalId(client, "activity", row.activityPublicId);
    const ownerId = await resolveInternalId(client, "app_user", row.ownerPublicId);
    // Demote prior current scorecard(s) for this activity before inserting the
    // new current one — idx_scorecard_activity_current allows only one.
    await client.query(
      `UPDATE scorecard SET is_current = false WHERE activity_id = $1 AND is_current = true`,
      [activityId],
    );
    const scorecardId = await upsertReturningId(
      client,
      "scorecard",
      "scorecard",
      `INSERT INTO scorecard (public_id, activity_id, rubric_id, owner_user_id, org_unit_id, composite_score, is_current)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (activity_id, rubric_id) DO UPDATE SET composite_score = EXCLUDED.composite_score, is_current = true
       RETURNING id`,
      [row.publicId, activityId, row.rubricId, ownerId, row.orgUnitId, row.compositeScore ?? null],
      row.publicId,
    );
    for (const line of row.lines) {
      await client.query(
        `INSERT INTO scorecard_line (scorecard_id, rubric_parameter_id, rubric_theme_id, score, param_name_snapshot, param_weight_snapshot, evidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (scorecard_id, rubric_parameter_id) DO UPDATE SET
           score = EXCLUDED.score, evidence = EXCLUDED.evidence`,
        [
          scorecardId, line.rubricParameterId, line.rubricThemeId, line.score,
          line.paramNameSnapshot, line.paramWeightSnapshot, line.evidence ?? null,
        ],
      );
    }
    return scorecardId;
  }

  async upsertProductSignal(client: PgClient, row: ProductSignalRow): Promise<number> {
    const ownerId = await resolveInternalId(client, "app_user", row.ownerPublicId);
    const accountId = await resolveInternalId(client, "account", row.accountPublicId);
    const activityId = row.activityPublicId
      ? await resolveInternalId(client, "activity", row.activityPublicId)
      : null;
    return upsertReturningId(
      client,
      "product_signal",
      "product_signal",
      `INSERT INTO product_signal (public_id, activity_id, account_id, owner_user_id, org_unit_id, source, signal_type, signal_key, title, description, evidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (public_id) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description, evidence = EXCLUDED.evidence
       RETURNING id`,
      [
        row.publicId, activityId, accountId, ownerId, row.orgUnitId,
        row.source ?? "ai_extracted", row.signalType, row.signalKey ?? null,
        row.title, row.description ?? null, row.evidence ?? null,
      ],
      row.publicId,
    );
  }

  async enqueueOutbox(
    client: PgClient,
    entry: { entityType: string; entityId: string; operation: string; payload: Record<string, unknown> },
  ): Promise<void> {
    const integrationId = await getFirestoreProjectionIntegrationId(client);
    await client.query(
      `INSERT INTO sync_outbox (entity_type, entity_id, integration_id, operation, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.entityType, entry.entityId, integrationId, entry.operation, JSON.stringify(entry.payload)],
    );
  }
}

/** Register a user row (login sync path) — app_user + user_identity. */
export async function upsertAppUser(
  client: PgClient,
  row: {
    publicId: string;
    email: string;
    displayName?: string | null;
    jobLevel?: string | null;
    orgUnitId?: string | null;
    authUid?: string | null;
  },
): Promise<number> {
  const id = await upsertReturningId(
    client,
    "app_user",
    "app_user",
    `INSERT INTO app_user (public_id, email, display_name, job_level, org_unit_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (public_id) DO UPDATE SET
       email = EXCLUDED.email, display_name = EXCLUDED.display_name,
       job_level = EXCLUDED.job_level, org_unit_id = EXCLUDED.org_unit_id, updated_at = now()
     RETURNING id`,
    [row.publicId, row.email.toLowerCase(), row.displayName ?? null, row.jobLevel ?? "IC", row.orgUnitId ?? null],
    row.publicId,
  );
  if (row.authUid) {
    await client.query(
      `INSERT INTO user_identity (user_id, auth_provider, auth_uid)
       VALUES ($1, 'firebase', $2)
       ON CONFLICT (auth_provider, auth_uid) DO NOTHING`,
      [id, row.authUid],
    );
  }
  return id;
}

/** Register an org_unit (org or team) — id is the Firestore string id. */
export async function upsertOrgUnit(
  client: PgClient,
  row: { id: string; name: string; parentId?: string | null; unitType: "org" | "region" | "team" | "squad"; path: string },
): Promise<void> {
  await client.query(
    `INSERT INTO org_unit (id, name, parent_id, unit_type, path)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, parent_id = EXCLUDED.parent_id,
       unit_type = EXCLUDED.unit_type, path = EXCLUDED.path`,
    [row.id, row.name, row.parentId ?? null, row.unitType, row.path],
  );
}
