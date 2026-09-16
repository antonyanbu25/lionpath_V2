/**
 * PostgresRepository — PersistencePort implementation against Janus v9.3.
 *
 * Every method:
 *   - runs inside the caller's withSessionContext transaction (RLS applies)
 *   - resolves public_id FKs via id_registry in the same transaction
 *   - is idempotent via ON CONFLICT (public_id) / idempotency keys
 */

import type { PgClient, PgPool, PostgresEnv } from "./postgres-pool";
import { registerId, resolveInternalId, upsertReturningId } from "./id-registry";
import { getFirestoreProjectionIntegrationId } from "./outbox";
import { canonicalizeSeMotion } from "../../domain-model/se-motion";
import { createPostgresReadRepository, type PostgresReadRepository } from "./read-repository";
import type { SqlSession } from "./session-context";
import { assertDealStatus } from "./types";
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

export class PostgresRepository implements PersistencePort {
  readRepository(pool: PgPool, session: SqlSession, env?: PostgresEnv): PostgresReadRepository {
    return createPostgresReadRepository(pool, session, env);
  }

  async upsertAccount(client: PgClient, row: AccountRow): Promise<number> {
    // Slug is globally unique among active accounts (idx_account_slug_active,
    // WHERE deleted_at IS NULL). A Firestore-primary caller mints its OWN
    // public_id, but the same company may already exist in Postgres — e.g. from
    // the initial migration — under a DIFFERENT public_id but the SAME slug.
    // A plain ON CONFLICT (public_id) upsert would then raise a unique violation
    // on the slug index and 500 the whole save (this was the staging blocker).
    // When the incoming public_id is new AND its slug already belongs to another
    // active account, reuse that row: update it in place and register the
    // incoming public_id -> existing internal id so every downstream FK
    // resolution (activity, post_call, scorecard, ...) lines up. The public_id
    // guard prevents wrongly merging on a slug rename of an already-mapped row.
    if (row.slug) {
      const byPub = await client.query(`SELECT id FROM account WHERE public_id = $1`, [row.publicId]);
      if (byPub.rows.length === 0) {
        const bySlug = await client.query(
          `SELECT id FROM account WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
          [row.slug],
        );
        const hit = bySlug.rows[0];
        if (hit?.id != null) {
          const id = Number(hit.id);
          await client.query(
            `UPDATE account SET name = $2, domain = $3, industry = $4,
                                health_data = $5, external_ref = $6, updated_at = now()
               WHERE id = $1`,
            [
              id, row.name, row.domain ?? null, row.industry ?? null,
              row.healthData ? JSON.stringify(row.healthData) : null,
              row.externalRef ?? null,
            ],
          );
          await registerId(client, "account", row.publicId, id);
          return id;
        }
      }
    }
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

  // account_se_team has existed since 26_account_se_team.sql, and its RLS
  // policy (account_writable_by_current_user) already gates writes correctly
  // -- but nothing ever inserted into it, so every account stayed "unclaimed"
  // forever regardless of who actually worked it. Firestore-shaped callers
  // (account-service.js's createAccount/ensureSeTeamForPrepActor) pass
  // seTeam/primarySeUserId; this is where that finally lands as real rows.
  async seatAccountSeTeamMember(
    client: PgClient,
    row: { accountPublicId: string; seUserPublicId: string; role: "primary" | "secondary"; addedByPublicId?: string | null },
  ): Promise<void> {
    const accountId = await resolveInternalId(client, "account", row.accountPublicId);
    const seUserId = await resolveInternalId(client, "app_user", row.seUserPublicId);
    let addedBy: number | null = null;
    if (row.addedByPublicId) {
      try {
        addedBy = await resolveInternalId(client, "app_user", row.addedByPublicId);
      } catch {
        addedBy = null;
      }
    }
    if (row.role === "primary") {
      // uq_aset_primary allows only one active primary per account -- demote
      // any other holder first so this insert/update doesn't violate it.
      await client.query(
        `UPDATE account_se_team SET role = 'secondary'
           WHERE account_id = $1 AND role = 'primary' AND removed_at IS NULL AND se_user_id <> $2`,
        [accountId, seUserId],
      );
    }
    await client.query(
      `INSERT INTO account_se_team (account_id, se_user_id, role, added_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (account_id, se_user_id) DO UPDATE SET
         role = EXCLUDED.role, removed_at = NULL`,
      [accountId, seUserId, row.role, addedBy],
    );
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
        row.stage, assertDealStatus(row.status) ?? "active", row.amount ?? null, row.currencyCode ?? "USD",
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
    // Validated, not mapped — an unmapped client status aborts the whole
    // transaction rather than just this UPDATE. See assertDealStatus.
    if (fields.status !== undefined) push("status", assertDealStatus(fields.status) ?? "active");
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

    // idx_deal_contact_primary is UNIQUE (deal_id)
    //   WHERE is_primary AND deleted_at IS NULL
    // and it was named by no ON CONFLICT — roadmap 3.4 / audit 07 §3. Measured
    // REACHABLE (test-unique-constraint-coverage.ts C12): with a primary
    // already on the deal, upserting a SECOND contact with isPrimary: true
    // inserted a second is_primary row and raised a raw duplicate-key error
    // that ABORTED the enclosing transaction.
    //
    // Worth noting why this one slipped through: setPrimaryDealContact right
    // below DOES demote first, and its comment even names this index. The
    // defence existed; upsertDealContact just never got it, so promoting a
    // contact through the upsert path and promoting it through the set path
    // behaved completely differently.
    //
    // LAST WRITER WINS, deliberately, and this is the one place among these
    // fixes where the choice is a real judgement rather than a mechanical one.
    // The caller passed isPrimary: true EXPLICITLY — it is asserting who the
    // primary is, not reporting a coincidence. DO NOTHING would drop that
    // assertion and leave the old primary in place while returning success,
    // which is the worse outcome: the UI shows the promotion as accepted and
    // the data disagrees. Demoting the incumbent is also exactly what the
    // sibling path (setPrimaryDealContact) and the analogous constraint
    // (uq_aset_primary, in seatAccountSeTeamMember) already do, so this makes
    // the three consistent instead of inventing a fourth rule.
    //
    // contact_id <> $2 so the row about to be upserted is not demoted by its
    // own call — mirrors seatAccountSeTeamMember's se_user_id <> $2.
    if (row.isPrimary) {
      await client.query(
        `UPDATE deal_contact SET is_primary = false, updated_at = now()
           WHERE deal_id = $1 AND is_primary AND deleted_at IS NULL AND contact_id <> $2`,
        [dealId, contactId],
      );
    }

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
      `WITH existing AS (
         SELECT id
         FROM activity
         WHERE public_id = $1
            OR ($2::text IS NOT NULL AND idempotency_key = $2)
         ORDER BY CASE WHEN public_id = $1 THEN 0 ELSE 1 END
         LIMIT 1
         FOR UPDATE
       ),
       updated AS (
         UPDATE activity
         SET deal_id = $3, subject = $8, occurred_at = $9, updated_at = now()
         WHERE id = (SELECT id FROM existing)
         RETURNING id
       ),
       inserted AS (
         INSERT INTO activity (public_id, idempotency_key, deal_id, account_id, owner_user_id, org_unit_id, activity_type, subject, occurred_at, updated_at)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, now()
         WHERE NOT EXISTS (SELECT 1 FROM existing)
         ON CONFLICT (public_id) DO UPDATE SET
           deal_id = EXCLUDED.deal_id, subject = EXCLUDED.subject,
           occurred_at = EXCLUDED.occurred_at, updated_at = now()
         RETURNING id
       )
       SELECT id FROM updated
       UNION ALL
       SELECT id FROM inserted
       UNION ALL
       SELECT id FROM activity WHERE public_id = $1
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
    // Same public_id-or-idempotency_key check as upsertActivity/upsertPostCall
    // above. The old version only named idempotency_key in ON CONFLICT, so
    // two concurrent synthesize writes for the same brief could both miss
    // that check and collide on the public_id unique index instead -- a
    // constraint this statement never named, so Postgres raised a bare
    // duplicate-key error instead of updating.
    // pre_call.activity_id is UNIQUE (one brief per call, by construction), and
    // it was named by NO ON CONFLICT — roadmap 3.4 / audit 07 §3. Measured
    // REACHABLE and DETERMINISTICALLY so: a re-synthesis that mints a fresh
    // public_id and a fresh idempotency_key for the same activity matched
    // neither `existing` predicate, inserted, and raised a raw
    // `pre_call_activity_id_key` violation that ABORTED the enclosing
    // transaction (25P02 on every later statement). See
    // test-unique-constraint-coverage.ts C4.
    //
    // The fix is the third `existing` predicate below, NOT a second ON CONFLICT
    // clause: PostgreSQL allows exactly one conflict target per INSERT and this
    // one is already spent on (public_id), which it needs for replay
    // idempotence. Matching activity_id makes the constraint unreachable the
    // same way idx_activity_idempotency is unreachable in upsertActivity.
    //
    // activity_id is ranked LAST, so public_id still wins and idempotency_key
    // still beats it — the more specific identity keeps priority. The UPDATE
    // branch deliberately does not write activity_id: when the match came from
    // public_id or idempotency_key the incumbent's activity may differ, and
    // re-pointing it would just move the collision to a different row.
    //
    // RESIDUE, stated rather than glossed: two CONCURRENT writers can still
    // both find no existing row and race the index. FOR UPDATE cannot lock a
    // row that does not exist yet. That is H3's recorded hazard in
    // test-concurrency-hazards.ts and a writer-convergence problem (P3), not
    // something a conflict target can express.
    return upsertReturningId(
      client,
      "pre_call",
      "pre_call",
      `WITH existing AS (
         SELECT id
         FROM pre_call
         WHERE public_id = $1
            OR ($2::text IS NOT NULL AND idempotency_key = $2)
            OR activity_id = $3
         ORDER BY CASE
                    WHEN public_id = $1 THEN 0
                    WHEN $2::text IS NOT NULL AND idempotency_key = $2 THEN 1
                    ELSE 2
                  END
         LIMIT 1
         FOR UPDATE
       ),
       updated AS (
         UPDATE pre_call
         SET research_brief = $4, input_snapshot = $5
         WHERE id = (SELECT id FROM existing)
         RETURNING id
       ),
       inserted AS (
         INSERT INTO pre_call (public_id, idempotency_key, activity_id, research_brief, input_snapshot, generated_at)
         SELECT $1, $2, $3, $4, $5, now()
         WHERE NOT EXISTS (SELECT 1 FROM existing)
         ON CONFLICT (public_id) DO UPDATE SET
           research_brief = EXCLUDED.research_brief, input_snapshot = EXCLUDED.input_snapshot
         RETURNING id
       )
       SELECT id FROM updated
       UNION ALL
       SELECT id FROM inserted
       UNION ALL
       SELECT id FROM pre_call WHERE public_id = $1
       UNION ALL
       SELECT id FROM pre_call WHERE idempotency_key = $2 AND $2 IS NOT NULL
       LIMIT 1`,
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
    // Same public_id-or-idempotency_key check as upsertActivity above. The old
    // version only named idempotency_key in ON CONFLICT, so two concurrent
    // writes for the same call (real traffic pattern -- the client fires
    // overlapping domain-write attempts per call) could both pass the
    // idempotency_key check unresolved, then collide on the public_id unique
    // index instead -- a constraint this statement never named, so Postgres
    // raised it as a bare "duplicate key value violates unique constraint
    // post_call_public_id_key" instead of gracefully updating. Confirmed live
    // on staging 2026-09-09, blocking every scorecard write behind it.
    //
    // post_call.activity_id is ALSO UNIQUE and was named by no ON CONFLICT
    // either — roadmap 3.4 / audit 07 §3. H3 in test-concurrency-hazards.ts
    // caught it only intermittently (10 of 12 CONCURRENT attempts) because it
    // raced two writers on one public_id; C5 in
    // test-unique-constraint-coverage.ts reaches it with NO race at all, in two
    // sequential writes, because a re-analysis under a new public_id and a new
    // idempotency_key matches neither `existing` predicate. It raised
    // `post_call_activity_id_key` and aborted the enclosing transaction.
    //
    // Fixed by the third `existing` predicate, for the reasons spelled out on
    // upsertPreCall above: only one ON CONFLICT target is permitted per INSERT
    // and (public_id) is load-bearing here, so activity_id has to be absorbed
    // by the existing-row lookup instead. The concurrent residue (H3) stands.
    return upsertReturningId(
      client,
      "post_call",
      "post_call",
      `WITH existing AS (
         SELECT id
         FROM post_call
         WHERE public_id = $1
            OR ($2::text IS NOT NULL AND idempotency_key = $2)
            OR activity_id = $3
         ORDER BY CASE
                    WHEN public_id = $1 THEN 0
                    WHEN $2::text IS NOT NULL AND idempotency_key = $2 THEN 1
                    ELSE 2
                  END
         LIMIT 1
         FOR UPDATE
       ),
       updated AS (
         UPDATE post_call
         SET transcript_ref = $4, analysis = $5, detail = $6, pipeline_state = $7,
             analysis_shape_version = $8, detail_shape_version = $9, se_motion = $10,
             updated_at = now()
         WHERE id = (SELECT id FROM existing)
         RETURNING id
       ),
       inserted AS (
         INSERT INTO post_call (public_id, idempotency_key, activity_id, transcript_ref, analysis, detail, pipeline_state, analysis_shape_version, detail_shape_version, se_motion, updated_at)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now()
         WHERE NOT EXISTS (SELECT 1 FROM existing)
         ON CONFLICT (public_id) DO UPDATE SET
           transcript_ref = EXCLUDED.transcript_ref, analysis = EXCLUDED.analysis,
           detail = EXCLUDED.detail, pipeline_state = EXCLUDED.pipeline_state,
           analysis_shape_version = EXCLUDED.analysis_shape_version,
           detail_shape_version = EXCLUDED.detail_shape_version,
           se_motion = EXCLUDED.se_motion, updated_at = now()
         RETURNING id
       )
       SELECT id FROM updated
       UNION ALL
       SELECT id FROM inserted
       UNION ALL
       SELECT id FROM post_call WHERE public_id = $1
       UNION ALL
       SELECT id FROM post_call WHERE idempotency_key = $2 AND $2 IS NOT NULL
       LIMIT 1`,
      [
        row.publicId, row.idempotencyKey ?? null, activityId, row.transcriptRef ?? null,
        row.analysis ? JSON.stringify(row.analysis) : null,
        row.detail ? JSON.stringify(row.detail) : null,
        row.pipelineState ?? "ingested",
        row.analysisShapeVersion ?? "1",
        row.detailShapeVersion ?? "1",
        canonicalizeSeMotion(row.seMotion),
      ],
      row.publicId,
    );
  }

  async upsertScorecard(client: PgClient, row: ScorecardRow): Promise<number> {
    const activityId = await resolveInternalId(client, "activity", row.activityPublicId);
    const ownerId = await resolveInternalId(client, "app_user", row.ownerPublicId);

    // The rubric must already exist. It is loader-owned (D17) and janus_app has
    // SELECT only on it, so there is no auto-provision path any more -- the old
    // one minted rubric_parameter rows on first sighting, which was only ever a
    // workaround for the catalog having no real home. A missing rubric now
    // fails loudly rather than inventing a profile nothing was scored against.
    const rubric = await client.query(
      `SELECT call_type, se_motion, version, provisional, total_credits
         FROM rubric WHERE id = $1`,
      [row.rubricId],
    );
    if (rubric.rowCount === 0) {
      throw Object.assign(
        new Error(
          `rubric ${row.rubricId} does not exist — run janus/scripts/load-rubric-catalog.mjs. ` +
            `Profiles are data, not code (D16), and scorecard.rubric_id is a NOT NULL FK.`,
        ),
        { status: 409 },
      );
    }
    const profile = rubric.rows[0] as {
      call_type: string; se_motion: string; version: string;
      provisional: boolean; total_credits: number;
    };
    // Catch a caller that resolved the wrong profile before the composite FK
    // does, so the error names the mismatch instead of a constraint.
    if (profile.call_type !== row.callType || profile.se_motion !== row.seMotion) {
      throw Object.assign(
        new Error(
          `rubric ${row.rubricId} is (${profile.call_type}, ${profile.se_motion}) but the ` +
            `scorecard claims (${row.callType}, ${row.seMotion}). The call-type x motion ` +
            `matrix is sparse — 19 valid pairs of 24 — so this pair may have no profile.`,
        ),
        { status: 409 },
      );
    }

    // Demote prior current scorecard(s) for this activity before inserting the
    // new current one — idx_scorecard_activity_current allows only one.
    await client.query(
      `UPDATE scorecard SET is_current = false WHERE activity_id = $1 AND is_current = true`,
      [activityId],
    );

    const cat = (key: string) =>
      row.categoryScores && key in row.categoryScores ? row.categoryScores[key] : null;

    // Motion provenance, decided HERE and not taken from the client (D14).
    //
    // The browser computes motion with defaultSeMotion() and the server
    // historically just trusted the document, so any path that bypassed
    // web/postcall.js -- an older client, a direct API call, a re-analysis job
    // -- stamped new_business silently. Comparing the claimed motion against
    // what the org tree resolves is what makes "resolved" mean resolved.
    let motionSource = row.seMotionSource;
    if (!motionSource) {
      const resolved = await client.query(
        `SELECT resolve_se_motion_for_user($1) AS motion`,
        [ownerId],
      );
      const orgMotion = resolved.rows[0]?.motion as string | null;
      motionSource =
        orgMotion == null
          ? "defaulted"                              // nothing up the chain says
          : orgMotion === row.seMotion
            ? "resolved"                             // agrees with the org tree
            : "override";                            // deliberately different
      if (motionSource === "defaulted") {
        console.warn(
          `[scoring] ${row.publicId}: no default_se_motion anywhere above the owner's ` +
            `org unit, so seMotion="${row.seMotion}" is a FALLBACK, not a resolution. ` +
            `Set default_se_motion on the segment (D15) or this score may be against ` +
            `the wrong profile.`,
        );
      }
    }

    const scorecardId = await upsertReturningId(
      client,
      "scorecard",
      "scorecard",
      `INSERT INTO scorecard (
         public_id, activity_id, rubric_id, owner_user_id, org_unit_id,
         composite_score, call_type, se_motion, se_motion_source, rubric_version,
         provisional, total_credits, included_credits, confidence,
         leadership_shareable, golden_calibrated,
         category_discovery_qualification, category_solution_technical_fit,
         category_business_value, category_credibility_objections,
         category_communication_control,
         verifier_justifications, golden_justifications, is_current)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16, $17, $18, $19, $20, $21, $22, $23, true)
       ON CONFLICT (activity_id, rubric_id) DO UPDATE SET
         composite_score      = EXCLUDED.composite_score,
         se_motion            = EXCLUDED.se_motion,
         se_motion_source     = EXCLUDED.se_motion_source,
         rubric_version       = EXCLUDED.rubric_version,
         provisional          = EXCLUDED.provisional,
         total_credits        = EXCLUDED.total_credits,
         included_credits     = EXCLUDED.included_credits,
         confidence           = EXCLUDED.confidence,
         leadership_shareable = EXCLUDED.leadership_shareable,
         golden_calibrated    = EXCLUDED.golden_calibrated,
         category_discovery_qualification = EXCLUDED.category_discovery_qualification,
         category_solution_technical_fit  = EXCLUDED.category_solution_technical_fit,
         category_business_value          = EXCLUDED.category_business_value,
         category_credibility_objections  = EXCLUDED.category_credibility_objections,
         category_communication_control   = EXCLUDED.category_communication_control,
         verifier_justifications = EXCLUDED.verifier_justifications,
         golden_justifications   = EXCLUDED.golden_justifications,
         is_current           = true
       RETURNING id`,
      [
        row.publicId, activityId, row.rubricId, ownerId, row.orgUnitId,
        row.compositeScore ?? null,
        row.callType,
        row.seMotion,
        motionSource,
        row.rubricVersion || profile.version,
        // Frozen from the rubric unless the caller states otherwise.
        row.provisional ?? profile.provisional,
        row.totalCredits ?? profile.total_credits,
        row.includedCredits ?? null,
        row.confidence ?? null,
        row.leadershipShareable ?? false,
        row.goldenCalibrated ?? false,
        cat("discovery_qualification"), cat("solution_technical_fit"),
        cat("business_value"), cat("credibility_objections"),
        cat("communication_control"),
        row.verifierJustifications ? JSON.stringify(row.verifierJustifications) : null,
        row.goldenJustifications ? JSON.stringify(row.goldenJustifications) : null,
      ],
      row.publicId,
    );

    // Re-analysis replaces the themes wholesale rather than merging. A profile
    // version can drop a theme (NB discovery lost storytelling, 33 -> 32
    // credits), so a merge would leave an orphan theme in the denominator and
    // silently change the composite. This also clears the slate for the
    // per-theme upsertScorecardTheme calls that follow the header write.
    await client.query(`DELETE FROM scorecard_theme WHERE scorecard_id = $1`, [scorecardId]);

    for (const theme of row.themes ?? []) {
      const excluded = !!theme.evidenceUnavailable || !!theme.modelOmitted;
      if (excluded && !theme.notApplicableReason) {
        throw Object.assign(
          new Error(
            `theme ${theme.themeKey} is excluded but has no notApplicableReason. An ` +
              `unexplained exclusion is indistinguishable from a bug, and the SE reads ` +
              `this string when they ask why the theme scored nothing.`,
          ),
          { status: 422 },
        );
      }
      const themeRes = await client.query(
        `INSERT INTO scorecard_theme (
           scorecard_id, rubric_theme_id, theme_key, grade, credit, category,
           evidence_unavailable, model_omitted, not_applicable_reason,
           confidence, coaching_note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          scorecardId, theme.rubricThemeId, theme.themeKey,
          // An excluded theme carries NO grade. Storing 0 would make it look
          // scored, and chk_scorecard_theme_na rejects it anyway.
          excluded ? null : theme.grade,
          theme.credit, theme.category,
          !!theme.evidenceUnavailable, !!theme.modelOmitted,
          theme.notApplicableReason ?? null,
          theme.confidence ?? null, theme.coachingNote ?? null,
        ],
      );
      const themeRowId = Number(themeRes.rows[0].id);

      // An excluded theme has no sub-parameter verdicts to store.
      if (excluded) continue;

      for (const sub of theme.subParameters) {
        await client.query(
          `INSERT INTO scorecard_line (
             scorecard_id, scorecard_theme_id, rubric_parameter_id, rubric_theme_id,
             param_index, score, param_name_snapshot, param_weight_snapshot,
             evidence, evidence_json)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (scorecard_id, rubric_parameter_id) DO UPDATE SET
             score = EXCLUDED.score,
             evidence = EXCLUDED.evidence,
             evidence_json = EXCLUDED.evidence_json`,
          [
            scorecardId, themeRowId, sub.rubricParameterId, theme.rubricThemeId,
            sub.paramIndex, sub.score, sub.paramNameSnapshot, sub.paramWeightSnapshot,
            sub.evidence ?? null,
            sub.evidenceJson ? JSON.stringify(sub.evidenceJson) : null,
          ],
        );
      }
    }

    // Deal risk incidents. Replaced with the themes, for the same reason.
    await client.query(`DELETE FROM scorecard_deal_risk WHERE scorecard_id = $1`, [scorecardId]);
    for (const risk of row.dealRiskFlags ?? []) {
      await client.query(
        `INSERT INTO scorecard_deal_risk
           (scorecard_id, category, description, severity, at_s, quote)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [scorecardId, risk.category, risk.description,
         risk.severity ?? null, risk.atS ?? null, risk.quote ?? null],
      );
    }

    return scorecardId;
  }

  /**
   * Append one theme (and its five sub-parameter verdicts) to a scorecard.
   *
   * Matches how the browser actually persists: upsertScorecard writes the
   * header and clears the themes, then one of these arrives per theme.
   *
   * Resolves the catalog ids itself. The client sends only a theme_key, and
   * the catalog in SQL is the authoritative copy (D16/D17), so looking up
   * rubric_theme and rubric_parameter here means the client cannot reference a
   * theme the profile does not have.
   */
  async upsertScorecardTheme(client: PgClient, row: ScorecardThemeAppendRow): Promise<number> {
    const sc = await client.query(
      `SELECT id, rubric_id FROM scorecard WHERE public_id = $1`,
      [row.scorecardPublicId],
    );
    if (sc.rowCount === 0) {
      throw Object.assign(
        new Error(
          `scorecard ${row.scorecardPublicId} does not exist — the header must be written ` +
            `before its themes.`,
        ),
        { status: 409 },
      );
    }
    const scorecardId = Number(sc.rows[0].id);
    const rubricId = String(sc.rows[0].rubric_id);

    const theme = await client.query(
      `SELECT id, credit, category FROM rubric_theme
        WHERE rubric_id = $1 AND theme_key = $2`,
      [rubricId, row.themeKey],
    );
    if (theme.rowCount === 0) {
      throw Object.assign(
        new Error(
          `theme "${row.themeKey}" is not in rubric ${rubricId}. Either the catalog is stale ` +
            `(re-run load-rubric-catalog.mjs) or the client scored against a different ` +
            `profile version than the one the scorecard references.`,
        ),
        { status: 409 },
      );
    }
    const rubricThemeId = String(theme.rows[0].id);
    // Trust the catalog for credit and category, not the client — they decide
    // the denominator, and a stale client must not be able to reweight a score.
    const credit = Number(theme.rows[0].credit);
    const category = String(theme.rows[0].category);

    const excluded = !!row.evidenceUnavailable || !!row.modelOmitted;
    if (excluded && !row.notApplicableReason) {
      throw Object.assign(
        new Error(
          `theme ${row.themeKey} is excluded but carries no notApplicableReason. ` +
            `chk_scorecard_theme_reason rejects a silent exclusion, because it is ` +
            `indistinguishable from a bug.`,
        ),
        { status: 422 },
      );
    }

    const inserted = await client.query(
      `INSERT INTO scorecard_theme (
         scorecard_id, rubric_theme_id, theme_key, grade, credit, category,
         evidence_unavailable, model_omitted, not_applicable_reason,
         confidence, coaching_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (scorecard_id, theme_key) DO UPDATE SET
         grade = EXCLUDED.grade,
         evidence_unavailable = EXCLUDED.evidence_unavailable,
         model_omitted = EXCLUDED.model_omitted,
         not_applicable_reason = EXCLUDED.not_applicable_reason,
         confidence = EXCLUDED.confidence,
         coaching_note = EXCLUDED.coaching_note
       RETURNING id`,
      [
        scorecardId, rubricThemeId, row.themeKey,
        excluded ? null : row.grade,
        credit, category,
        !!row.evidenceUnavailable, !!row.modelOmitted,
        row.notApplicableReason ?? null,
        row.confidence ?? null, row.coachingNote ?? null,
      ],
    );
    const themeRowId = Number(inserted.rows[0].id);

    // An excluded theme has no verdicts to store.
    if (excluded) return themeRowId;

    const params = await client.query(
      `SELECT id, param_index, name, weight FROM rubric_parameter
        WHERE rubric_theme_id = $1 ORDER BY param_index`,
      [rubricThemeId],
    );
    if (params.rowCount !== row.subParameters.length) {
      console.warn(
        `[scoring] theme ${row.themeKey}: ${row.subParameters.length} verdict(s) for ` +
          `${params.rowCount} catalog sub-parameter(s). Storing the overlap; the theme ` +
          `grade already came from the scorer so the composite is unaffected.`,
      );
    }

    for (const [i, param] of params.rows.entries()) {
      const sub = row.subParameters[i];
      if (!sub) break;
      await client.query(
        `INSERT INTO scorecard_line (
           scorecard_id, scorecard_theme_id, rubric_parameter_id, rubric_theme_id,
           param_index, score, param_name_snapshot, param_weight_snapshot,
           evidence, evidence_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (scorecard_id, rubric_parameter_id) DO UPDATE SET
           score = EXCLUDED.score,
           evidence = EXCLUDED.evidence,
           evidence_json = EXCLUDED.evidence_json`,
        [
          scorecardId, themeRowId, String(param.id), rubricThemeId,
          Number(param.param_index), sub.score,
          String(param.name), Number(param.weight),
          sub.evidence ?? null,
          sub.evidenceJson ? JSON.stringify(sub.evidenceJson) : null,
        ],
      );
    }

    return themeRowId;
  }

  /**
   * Write the participants on a call, from the identity stamp (D9, D11).
   *
   * Replaces rather than merges: a re-analysis recomputes the whole set, and
   * merging would leave someone attached to a call they were removed from.
   *
   * Resolves SE and contact ids through id_registry, so an SE is a REAL
   * app_user FK rather than a name string -- which is the precision D9 exists
   * to stop losing. A participant that cannot be resolved is skipped with a
   * warning rather than failing the whole call write: losing one participant
   * is much better than losing the call.
   */
  async replaceCallParticipants(client: PgClient, row: CallParticipantsRow): Promise<number> {
    const activityId = await resolveInternalId(client, "activity", row.activityPublicId);

    await client.query(`DELETE FROM call_participant WHERE activity_id = $1`, [activityId]);

    const skipped: string[] = [];
    let written = 0;

    // Every app_user already written for this activity. uq_cp_activity_user is
    // UNIQUE (activity_id, app_user_id), and a violation here does not skip one
    // row — it aborts the enclosing transaction/SAVEPOINT and discards the WHOLE
    // participant set, including rows with no conflict at all, such as the
    // meeting room. Measured: 0 of 5 participants persisted (H7/J-035).
    //
    // Deduping only secondarySe against primarySe (as this did) left two
    // reachable collisions: a user who is both primary SE and internal leader
    // (a manager joining their own report's call), and the same id repeated
    // within secondarySeUserPublicIds. Keyed on the RESOLVED internal id rather
    // than the public id, because two public ids can map to one app_user after
    // an identity merge.
    const seenUserIds = new Set<number>();

    const resolveUser = async (publicId: string): Promise<number | null> => {
      try {
        return await resolveInternalId(client, "app_user", publicId);
      } catch {
        skipped.push(`app_user/${publicId}`);
        return null;
      }
    };

    const add = async (
      kind: "contact" | "se" | "ae" | "internal_leader" | "room",
      opts: {
        appUserId?: number | null;
        contactId?: number | null;
        name?: string | null;
        email?: string | null;
        isPrimary?: boolean;
        role?: string | null;
      },
    ) => {
      // First writer for a given user wins. Order is deliberate: primary SE is
      // added before secondaries and leaders, so the most specific role is the
      // one kept rather than being overwritten by a later observer row.
      if (opts.appUserId != null) {
        if (seenUserIds.has(opts.appUserId)) {
          skipped.push(`duplicate_user/${kind}/${opts.appUserId}`);
          return;
        }
        seenUserIds.add(opts.appUserId);
      }
      await client.query(
        `INSERT INTO call_participant
           (activity_id, participant_kind, app_user_id, contact_id,
            participant_name, participant_email, participant_role, is_primary)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          activityId, kind,
          opts.appUserId ?? null, opts.contactId ?? null,
          opts.name ?? null, opts.email ?? null,
          // A room does not participate, so it carries no role
          // (chk_cp_room_no_role).
          kind === "room" ? null : (opts.role ?? "attendee"),
          !!opts.isPrimary,
        ],
      );
      written += 1;
    };

    // Primary SE. presenter, not attendee: they ran the call.
    if (row.primarySeUserPublicId) {
      const id = await resolveUser(row.primarySeUserPublicId);
      if (id != null) await add("se", { appUserId: id, isPrimary: true, role: "presenter" });
    }

    for (const pid of row.secondarySeUserPublicIds ?? []) {
      // Cheap short-circuit; `add` now enforces uniqueness on the resolved id,
      // which is what actually prevents the uq_cp_activity_user abort.
      if (pid === row.primarySeUserPublicId) continue;
      const id = await resolveUser(pid);
      if (id != null) await add("se", { appUserId: id, isPrimary: false });
    }

    for (const pid of row.internalLeaderPublicIds ?? []) {
      const id = await resolveUser(pid);
      if (id != null) await add("internal_leader", { appUserId: id, role: "observer" });
    }

    // The AE. Correctly name/email -- AEs are not Janus users.
    if (row.aeName || row.aeEmail) {
      await add("ae", { name: row.aeName ?? null, email: row.aeEmail ?? null });
    }

    for (const cid of row.contactPublicIds ?? []) {
      let contactId: number | null = null;
      try {
        contactId = await resolveInternalId(client, "contact", cid);
      } catch {
        skipped.push(`contact/${cid}`);
        continue;
      }
      await add("contact", { contactId });
    }

    for (const name of row.roomNames ?? []) {
      if (name) await add("room", { name });
    }

    if (skipped.length) {
      console.warn(
        `[participants] ${row.activityPublicId}: wrote ${written}, skipped ${skipped.length} ` +
          `unresolvable (${skipped.join(", ")}). The call still landed.`,
      );
    }
    return written;
  }

  // ===========================================================================
  // post_call.detail items
  //
  // Twelve of the browser's write methods (upsertVideoFacts, upsertFollowUp,
  // upsertMomDraft, upsertDealSignal, upsertObjection, upsertTimelineSegment,
  // upsertTimelineMarker, upsertArrLine, upsertWhatWorks, upsertTcDelta,
  // upsertMeddpiccDelta and their deletes) target collections that are already
  // stored as arrays INSIDE post_call.detail -- which is where both browser
  // stores read them from, via detailArray().
  //
  // So they are not separate tables. They are an upsert into a jsonb array,
  // keyed on the item's own id. Doing it in SQL rather than read-modify-write
  // in the application keeps it atomic: two passes writing different item
  // kinds on the same call cannot clobber each other.
  // ===========================================================================

  /** Upsert one item into post_call.detail -> key, matched on item.id. */
  async upsertDetailItem(
    client: PgClient,
    row: { callPublicId: string; key: string; item: Record<string, unknown> },
  ): Promise<number> {
    if (!row.item?.id) {
      throw Object.assign(
        new Error(`detail item for ${row.key} has no id — cannot upsert without one`),
        { status: 422 },
      );
    }
    const res = await client.query(
      `UPDATE post_call
          SET detail = jsonb_set(
                COALESCE(detail, '{}'::jsonb),
                ARRAY[$2],
                COALESCE(
                  (SELECT jsonb_agg(e)
                     FROM jsonb_array_elements(COALESCE(detail -> $2, '[]'::jsonb)) e
                    WHERE e ->> 'id' IS DISTINCT FROM ($3::jsonb ->> 'id')),
                  '[]'::jsonb
                ) || jsonb_build_array($3::jsonb),
                true),
              updated_at = now()
        WHERE public_id = $1
        RETURNING id`,
      [row.callPublicId, row.key, JSON.stringify(row.item)],
    );
    if (res.rowCount === 0) {
      throw Object.assign(
        new Error(
          `post_call ${row.callPublicId} does not exist — its ${row.key} item has ` +
            `nothing to attach to. The call must be written first.`,
        ),
        { status: 409 },
      );
    }
    return Number(res.rows[0].id);
  }

  /** Remove one item from post_call.detail -> key by its id. */
  async deleteDetailItem(
    client: PgClient,
    row: { callPublicId: string; key: string; itemId: string },
  ): Promise<number> {
    const res = await client.query(
      `UPDATE post_call
          SET detail = jsonb_set(
                COALESCE(detail, '{}'::jsonb),
                ARRAY[$2],
                COALESCE(
                  (SELECT jsonb_agg(e)
                     FROM jsonb_array_elements(COALESCE(detail -> $2, '[]'::jsonb)) e
                    WHERE e ->> 'id' IS DISTINCT FROM $3),
                  '[]'::jsonb
                ),
                true),
              updated_at = now()
        WHERE public_id = $1
        RETURNING id`,
      [row.callPublicId, row.key, row.itemId],
    );
    return res.rowCount ?? 0;
  }

  /** Clear a whole detail array — deleteTranscriptTimelineByCall and friends. */
  async clearDetailKeys(
    client: PgClient,
    row: { callPublicId: string; keys: string[] },
  ): Promise<number> {
    const res = await client.query(
      `UPDATE post_call
          SET detail = COALESCE(detail, '{}'::jsonb) - $2::text[],
              updated_at = now()
        WHERE public_id = $1
        RETURNING id`,
      [row.callPublicId, row.keys],
    );
    return res.rowCount ?? 0;
  }

  // ===========================================================================
  // Tasks (D8)
  //
  // task was READ-ONLY: listTasks and listTasksByLifecycle both read FROM task
  // but no INSERT INTO task existed anywhere in worker/src. Writes went to a
  // per-user KV blob (tasks.ts), a third store.
  // ===========================================================================

  async upsertTask(
    client: PgClient,
    row: {
      publicId: string;
      activityPublicId?: string | null;
      dealPublicId?: string | null;
      ownerPublicId: string;
      title: string;
      description?: string | null;
      status?: string;
      dueDate?: string | null;
      source?: "ai_generated" | "manual";
      taskKey?: string | null;
      completedAt?: string | null;
    },
  ): Promise<number> {
    const ownerId = await resolveInternalId(client, "app_user", row.ownerPublicId);
    const activityId = row.activityPublicId
      ? await resolveInternalId(client, "activity", row.activityPublicId)
      : null;
    const dealId = row.dealPublicId
      ? await resolveInternalId(client, "deal", row.dealPublicId)
      : null;

    const source = row.source ?? "manual";
    // chk_task_ai_key: an AI task must carry a task_key, which is also what
    // idx_task_ai_dedup uses so a repeated pass does not duplicate it.
    const taskKey = source === "ai_generated"
      ? (row.taskKey || row.publicId)
      : (row.taskKey ?? null);
    const status = row.status ?? "open";
    // chk_task_completed_at requires the timestamp once completed.
    const completedAt = status === "completed"
      ? (row.completedAt ?? new Date().toISOString())
      : (row.completedAt ?? null);

    // idx_task_ai_dedup is UNIQUE (activity_id, task_key)
    //   WHERE source = 'ai_generated' AND deleted_at IS NULL
    // and it was named by no ON CONFLICT — roadmap 3.4 / audit 07 §3. Measured
    // REACHABLE (test-unique-constraint-coverage.ts C6): a re-run of the same
    // extraction pass that mints a fresh public_id for the same
    // (activity, task_key) inserted and raised a raw duplicate-key error that
    // ABORTED the enclosing transaction, taking every later write in the
    // handler with it.
    //
    // §3 implies the fix is to name the index. It cannot be: PostgreSQL permits
    // one ON CONFLICT target per INSERT and this statement's is already
    // (public_id), which it needs so a replayed task does not duplicate. So the
    // dedup key gets a pre-emptive lookup instead — the same shape upsertAccount
    // uses for idx_account_slug_active and upsertContact for
    // idx_contact_account_email_active, both of which MEASURE ABSORBED.
    //
    // DO UPDATE semantics, not DO NOTHING: the dedup key means "this is the
    // same task, re-derived", so the incoming row carries the newest title,
    // description, status and due date. DO NOTHING would discard the AI's
    // revised wording and leave a stale task while reporting success — a silent
    // lost write, which is worse than the abort it replaces. The concurrent
    // writer that DO UPDATE could clobber is the same pass re-deriving the same
    // task, so last-writer-wins loses nothing meaningful.
    //
    // FOR UPDATE locks the incumbent, so a concurrent second writer blocks here
    // and then takes this same branch instead of racing the index.
    //
    // Only when activity_id and task_key are both present: NULLs are distinct
    // in a unique index, so a task with either missing can never reach it.
    if (source === "ai_generated" && taskKey && activityId != null) {
      const dup = await client.query(
        `SELECT id FROM task
          WHERE activity_id = $1 AND task_key = $2
            AND source = 'ai_generated' AND deleted_at IS NULL
          LIMIT 1
          FOR UPDATE`,
        [activityId, taskKey],
      );
      const hit = dup.rows[0] as { id: number | string } | undefined;
      if (hit?.id != null) {
        const id = Number(hit.id);
        await client.query(
          `UPDATE task SET title = $2, description = $3, status = $4, due_date = $5::date,
                           deal_id = $6, completed_at = $7, updated_at = now()
             WHERE id = $1`,
          [id, row.title, row.description ?? null, status, row.dueDate ?? null, dealId, completedAt],
        );
        // Registering the incoming public_id against the incumbent is what lets
        // the caller's id resolve. When the incumbent held a DIFFERENT
        // public_id this is the H4/J-034 remap and the old id stops resolving —
        // logged by registerId, and the same trade upsertContact already makes.
        await registerId(client, "task", row.publicId, id);
        return id;
      }
    }

    return upsertReturningId(
      client, "task", "task",
      `INSERT INTO task (public_id, activity_id, deal_id, owner_user_id, title,
                         description, status, due_date, source, task_key,
                         completed_at, sync_state, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,'synced',now())
       ON CONFLICT (public_id) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description,
         status = EXCLUDED.status, due_date = EXCLUDED.due_date,
         deal_id = EXCLUDED.deal_id, activity_id = EXCLUDED.activity_id,
         completed_at = EXCLUDED.completed_at, updated_at = now()
       RETURNING id`,
      [row.publicId, activityId, dealId, ownerId, row.title,
       row.description ?? null, status, row.dueDate ?? null, source, taskKey,
       completedAt],
      row.publicId,
    );
  }

  /** Soft delete: task carries deleted_at, and the AI dedup index depends on it. */
  async softDeleteTask(client: PgClient, publicId: string): Promise<number> {
    const res = await client.query(
      `UPDATE task SET deleted_at = now(), updated_at = now()
        WHERE public_id = $1 AND deleted_at IS NULL RETURNING id`,
      [publicId],
    );
    return res.rowCount ?? 0;
  }

  // ===========================================================================
  // The five tables from 31_remaining_collections.sql
  // ===========================================================================

  async addContactEvent(
    client: PgClient,
    row: {
      publicId: string; contactPublicId: string; eventType: string;
      actorPublicId?: string | null; payload?: unknown;
    },
  ): Promise<number> {
    const contactId = await resolveInternalId(client, "contact", row.contactPublicId);
    const actorId = row.actorPublicId
      ? await resolveInternalId(client, "app_user", row.actorPublicId).catch(() => null)
      : null;
    // Append-only, so ON CONFLICT DO NOTHING rather than DO UPDATE: replaying
    // the same event must not rewrite history.
    const res = await client.query(
      `INSERT INTO contact_event (public_id, contact_id, event_type, actor_user_id, payload)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (public_id) DO NOTHING
       RETURNING id`,
      [row.publicId, contactId, row.eventType, actorId,
       row.payload ? JSON.stringify(row.payload) : null],
    );
    return res.rows[0] ? Number(res.rows[0].id) : 0;
  }

  async upsertDealSummary(
    client: PgClient,
    row: { publicId: string; dealPublicId: string; summary?: string | null; payload?: unknown },
  ): Promise<number> {
    const dealId = await resolveInternalId(client, "deal", row.dealPublicId);
    // Conflict on deal_id, not public_id: the store upserts on the natural key
    // and there is exactly one summary per deal.
    const res = await client.query(
      `INSERT INTO deal_summary (public_id, deal_id, summary, payload, generated_at, updated_at)
       VALUES ($1,$2,$3,$4,now(),now())
       ON CONFLICT (deal_id) DO UPDATE SET
         summary = EXCLUDED.summary, payload = EXCLUDED.payload,
         generated_at = now(), updated_at = now()
       RETURNING id`,
      [row.publicId, dealId, row.summary ?? null,
       row.payload ? JSON.stringify(row.payload) : null],
    );
    return Number(res.rows[0].id);
  }

  async upsertAccountSummary(
    client: PgClient,
    row: { publicId: string; accountPublicId: string; summary?: string | null; payload?: unknown },
  ): Promise<number> {
    const accountId = await resolveInternalId(client, "account", row.accountPublicId);
    const res = await client.query(
      `INSERT INTO account_summary (public_id, account_id, summary, payload, generated_at, updated_at)
       VALUES ($1,$2,$3,$4,now(),now())
       ON CONFLICT (account_id) DO UPDATE SET
         summary = EXCLUDED.summary, payload = EXCLUDED.payload,
         generated_at = now(), updated_at = now()
       RETURNING id`,
      [row.publicId, accountId, row.summary ?? null,
       row.payload ? JSON.stringify(row.payload) : null],
    );
    return Number(res.rows[0].id);
  }

  async upsertTechnicalCommit(
    client: PgClient,
    row: {
      publicId: string; dealPublicId: string; accountPublicId: string;
      ownerPublicId: string; orgUnitId: string; payload?: unknown;
    },
  ): Promise<number> {
    const dealId = await resolveInternalId(client, "deal", row.dealPublicId);
    const accountId = await resolveInternalId(client, "account", row.accountPublicId);
    const ownerId = await resolveInternalId(client, "app_user", row.ownerPublicId);
    const res = await client.query(
      `INSERT INTO technical_commit (public_id, deal_id, account_id, owner_user_id,
                                     org_unit_id, payload, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (deal_id) DO UPDATE SET
         payload = EXCLUDED.payload, owner_user_id = EXCLUDED.owner_user_id,
         updated_at = now()
       RETURNING id`,
      [row.publicId, dealId, accountId, ownerId, row.orgUnitId,
       row.payload ? JSON.stringify(row.payload) : null],
    );
    return Number(res.rows[0].id);
  }

  async addArrOverride(
    client: PgClient,
    row: {
      publicId: string; dealPublicId: string; previousValue?: number | null;
      newValue: number; reason: string; createdByPublicId?: string | null;
    },
  ): Promise<number> {
    const dealId = await resolveInternalId(client, "deal", row.dealPublicId);
    const by = row.createdByPublicId
      ? await resolveInternalId(client, "app_user", row.createdByPublicId).catch(() => null)
      : null;
    // Append-only; chk_arr_override_changed rejects a no-op.
    const res = await client.query(
      `INSERT INTO arr_override (public_id, deal_id, previous_value, new_value, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (public_id) DO NOTHING
       RETURNING id`,
      [row.publicId, dealId, row.previousValue ?? null, row.newValue, row.reason, by],
    );
    return res.rows[0] ? Number(res.rows[0].id) : 0;
  }

  // ===========================================================================
  // signal_cluster and clustering_state (D20)
  // ===========================================================================

  async upsertSignalCluster(
    client: PgClient,
    row: {
      publicId: string; name: string; capabilityArea?: string | null;
      description?: string | null; status?: string; centroid?: number[] | null;
      dealCount?: number; arrTotal?: number; taxonomyVersion?: string | null;
      productArea?: string | null; crossCuttingTags?: string[] | null;
      supersededBy?: string[] | null;
    },
  ): Promise<number> {
    const status = row.status ?? "draft";
    // chk_signal_cluster_lifecycle: published needs published_at + a taxonomy
    // version; archived needs superseded_by.
    return upsertReturningId(
      client, "product_signal", "signal_cluster",
      `INSERT INTO signal_cluster (public_id, name, capability_area, description, status,
         centroid, centroid_dim, deal_count, arr_total, taxonomy_version, product_area,
         cross_cutting_tags, superseded_by, published_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
               CASE WHEN $5 = 'published' THEN now() ELSE NULL END, now())
       ON CONFLICT (public_id) DO UPDATE SET
         name = EXCLUDED.name, capability_area = EXCLUDED.capability_area,
         description = EXCLUDED.description, status = EXCLUDED.status,
         centroid = EXCLUDED.centroid, centroid_dim = EXCLUDED.centroid_dim,
         deal_count = EXCLUDED.deal_count, arr_total = EXCLUDED.arr_total,
         taxonomy_version = EXCLUDED.taxonomy_version,
         product_area = EXCLUDED.product_area,
         cross_cutting_tags = EXCLUDED.cross_cutting_tags,
         superseded_by = EXCLUDED.superseded_by,
         published_at = COALESCE(signal_cluster.published_at, EXCLUDED.published_at),
         updated_at = now()
       RETURNING id`,
      [row.publicId, row.name, row.capabilityArea ?? null, row.description ?? null,
       status, row.centroid ?? null, row.centroid?.length ?? null,
       row.dealCount ?? 0, row.arrTotal ?? 0, row.taxonomyVersion ?? null,
       row.productArea ?? null, row.crossCuttingTags ?? null, row.supersededBy ?? null],
      row.publicId,
    );
  }

  async upsertClusteringState(
    client: PgClient,
    row: {
      pendingGapCount?: number; lastIncrementalAt?: string | null;
      lastFullRunAt?: string | null; running?: boolean;
    },
  ): Promise<number> {
    // Single row, id='singleton'. chk_clustering_state_running requires
    // running_since when running, so a crashed pass is recoverable.
    const res = await client.query(
      `INSERT INTO clustering_state (id, pending_gap_count, last_incremental_at,
                                     last_full_run_at, running, running_since, updated_at)
       VALUES ('singleton', $1, $2::timestamptz, $3::timestamptz, $4,
               CASE WHEN $4 THEN now() ELSE NULL END, now())
       ON CONFLICT (id) DO UPDATE SET
         pending_gap_count = EXCLUDED.pending_gap_count,
         last_incremental_at = COALESCE(EXCLUDED.last_incremental_at,
                                        clustering_state.last_incremental_at),
         last_full_run_at = COALESCE(EXCLUDED.last_full_run_at,
                                     clustering_state.last_full_run_at),
         running = EXCLUDED.running,
         running_since = CASE WHEN EXCLUDED.running THEN
                           COALESCE(clustering_state.running_since, now())
                         ELSE NULL END,
         updated_at = now()
       RETURNING 1 AS id`,
      [row.pendingGapCount ?? 0, row.lastIncrementalAt ?? null,
       row.lastFullRunAt ?? null, !!row.running],
    );
    return res.rowCount ?? 0;
  }

  async upsertProductSignal(client: PgClient, row: ProductSignalRow): Promise<number> {
    const ownerId = await resolveInternalId(client, "app_user", row.ownerPublicId);
    const accountId = await resolveInternalId(client, "account", row.accountPublicId);
    const activityId = row.activityPublicId
      ? await resolveInternalId(client, "activity", row.activityPublicId)
      : null;

    // idx_psig_ai_key is UNIQUE (activity_id, signal_key)
    //   WHERE deleted_at IS NULL
    // and it was named by no ON CONFLICT — roadmap 3.4 / audit 07 §3. Measured
    // REACHABLE (test-unique-constraint-coverage.ts C7): a re-extraction that
    // mints a fresh public_id for the same (activity, signal_key) raised a raw
    // duplicate-key error and ABORTED the enclosing transaction.
    //
    // Note the index is NOT restricted to AI sources the way idx_task_ai_dedup
    // is, so a pm_created or se_created signal reaches it too — this lookup is
    // therefore unconditional on source.
    //
    // Same reasoning as upsertTask above: the single ON CONFLICT target is
    // spent on (public_id), so the dedup key needs a pre-emptive lookup. Same
    // DO UPDATE choice, and for the same reason — a matching signal_key means
    // the extraction re-derived the SAME signal, and the columns updated below
    // are exactly the three the ON CONFLICT (public_id) branch refreshes, so a
    // key-matched replay and a public_id-matched replay now behave alike
    // instead of one updating and the other aborting.
    if (activityId != null && row.signalKey) {
      const dup = await client.query(
        `SELECT id FROM product_signal
          WHERE activity_id = $1 AND signal_key = $2 AND deleted_at IS NULL
          LIMIT 1
          FOR UPDATE`,
        [activityId, row.signalKey],
      );
      const hit = dup.rows[0] as { id: number | string } | undefined;
      if (hit?.id != null) {
        const id = Number(hit.id);
        await client.query(
          `UPDATE product_signal SET title = $2, description = $3, evidence = $4
             WHERE id = $1`,
          [id, row.title, row.description ?? null, row.evidence ?? null],
        );
        await registerId(client, "product_signal", row.publicId, id);
        return id;
      }
    }

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
