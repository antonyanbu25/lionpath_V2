#!/usr/bin/env node
/**
 * Firestore -> Cloud SQL backfill (Design A: id_registry).
 *
 * Reads a Firestore export JSON (same shape as migrate-lifecycle-to-deals.mjs
 * consumes, extended with orgs/teams/users/accounts/contacts/deals/
 * dealContacts) and inserts into PostgreSQL in dependency order, registering
 * every public_id -> bigint mapping in id_registry inside the same
 * transaction as each row insert.
 *
 * Dependency order:
 *   org_unit -> app_user -> user_identity -> account -> contact
 *   -> deal -> deal_contact -> activity -> pre_call / post_call
 *
 * Idempotent: ON CONFLICT (public_id) DO NOTHING + register_id() no-ops on
 * re-run. Safe to run repeatedly; use --dry-run to print counts only.
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres:... \
 *   node worker/scripts/migrate-firestore-to-sql.mjs --export ./firestore-export.json
 *
 *   node worker/scripts/migrate-firestore-to-sql.mjs --export ./firestore-export.json --dry-run
 *
 * NOTE: run as postgres / janus_owner (DDL + bypass RLS for bulk load),
 * NOT as janus_app.
 */

import fs from "node:fs/promises";
import pg from "pg";
import { pgClientConfig } from "./lib/pg-client-config.mjs";

const { Client } = pg;

function parseArgs(argv) {
  const args = { exportPath: "", dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--export") args.exportPath = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
  }
  if (!args.exportPath) {
    console.error("usage: migrate-firestore-to-sql.mjs --export <file> [--dry-run]");
    process.exit(1);
  }
  return args;
}

/** Firestore timestamps arrive as { _seconds } objects, millis numbers, or ISO strings. */
function toTs(v) {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v).toISOString();
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof v._seconds === "number") return new Date(v._seconds * 1000).toISOString();
  return null;
}

const LIFECYCLE_STAGE_TO_DEAL = {
  research: "prospecting",
  discovery: "discovery",
  demo: "demo_poc",
  evaluation: "demo_poc",
  business_case: "proposal",
  closed_won: "closed_won",
  closed_lost: "closed_lost",
  nurture: "prospecting",
};

// Enum guards: an unmapped value would abort the whole transaction.
const DEAL_STAGES = new Set(["prospecting", "discovery", "demo_poc", "proposal", "closing", "closed_won", "closed_lost"]);
const DEAL_STATUSES = new Set(["active", "nurture", "won", "lost"]);
function dealStage(v) {
  const s = String(v || "").trim();
  return DEAL_STAGES.has(s) ? s : "prospecting";
}
function dealStatus(v) {
  const s = String(v || "").trim();
  return DEAL_STATUSES.has(s) ? s : "active";
}

async function main() {
  const args = parseArgs(process.argv);
  const data = JSON.parse(await fs.readFile(args.exportPath, "utf8"));

  const counts = {
    org_unit: 0, app_user: 0, user_identity: 0, account: 0, contact: 0,
    deal: 0, deal_contact: 0, activity: 0, pre_call: 0, post_call: 0,
  };

  if (args.dryRun) {
    for (const k of Object.keys(counts)) {
      const fsKey = { org_unit: "orgs", app_user: "users", user_identity: "authIndex", deal_contact: "dealContacts", pre_call: "prepBriefs", post_call: "postCalls" }[k] || k + "s";
      counts[k] = Array.isArray(data[fsKey]) ? data[fsKey].length : 0;
    }
    console.log("dry-run counts:", counts);
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required (postgres / janus_owner).");
    process.exit(1);
  }
  const client = new Client(pgClientConfig(process.env.DATABASE_URL));
  await client.connect();

  // In-memory public_id -> bigint maps for FK resolution within this run.
  const orgIds = new Map();
  const userIds = new Map();
  const accountIds = new Map();
  const contactIds = new Map();
  const dealIds = new Map();
  const activityIds = new Map();

  try {
    await client.query("BEGIN");

    // -- 0. reference data seeds (QA #12, #13) --------------------------------
    // app_role/user_role gate RLS (product_signal 'pm' branch) and admin
    // checks; rubric FK-blocks every scorecard insert. Seed both so dual mode
    // is functional immediately after migration.
    await client.query(
      `INSERT INTO app_role (id, name, description, role_type) VALUES
         ('admin', 'admin', 'Workspace administrator', 'permission'),
         ('manager', 'manager', 'Front-line manager', 'job_function'),
         ('se', 'se', 'Solutions engineer', 'job_function'),
         ('pm', 'pm', 'Product manager', 'job_function')
       ON CONFLICT (id) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO rubric_theme (id, name, display_order) VALUES
         ('default', 'Default', 1)
       ON CONFLICT (id) DO NOTHING`,
    );
    await client.query(
      `INSERT INTO rubric (id, rubric_theme_id, name, version, effective_from) VALUES
         ('default', 'default', 'Default discovery rubric', '1', CURRENT_DATE)
       ON CONFLICT (id) DO NOTHING`,
    );

    // -- 1. org_unit (from orgs + teams) ------------------------------------
    for (const org of data.orgs || []) {
      const path = `/${org.id}/`;
      const r = await client.query(
        `INSERT INTO org_unit (id, name, unit_type, path) VALUES ($1, $2, 'org', $3)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [org.id, org.name || org.id, path]
      );
      orgIds.set(org.id, org.id);
      if (r.rowCount) counts.org_unit++;
    }
    for (const team of data.teams || []) {
      const parent = team.orgId && orgIds.has(team.orgId) ? team.orgId : null;
      const path = parent ? `/${team.orgId}/${team.id}/` : `/${team.id}/`;
      const r = await client.query(
        `INSERT INTO org_unit (id, name, parent_id, unit_type, path) VALUES ($1, $2, $3, 'team', $4)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [team.id, team.name || team.id, parent, path]
      );
      orgIds.set(team.id, team.id);
      if (r.rowCount) counts.org_unit++;
    }

    // -- 2. app_user + user_identity -----------------------------------------
    for (const u of data.users || []) {
      const orgUnitId = (u.teamId && orgIds.get(u.teamId)) || (u.orgId && orgIds.get(u.orgId)) || null;
      const r = await client.query(
        `INSERT INTO app_user (public_id, email, display_name, job_level, org_unit_id, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()))
         ON CONFLICT (public_id) DO NOTHING RETURNING id`,
        [
          u.id,
          String(u.email || "").toLowerCase(),
          u.displayName || null,
          u.role === "manager" ? "manager" : u.role === "admin" ? "VP" : "IC",
          orgUnitId,
          u.status === "inactive" ? "inactive" : "active",
          toTs(u.createdAt),
        ]
      );
      let internalId = r.rows[0]?.id;
      if (!internalId) {
        const existing = await client.query(`SELECT id FROM app_user WHERE public_id = $1`, [u.id]);
        internalId = existing.rows[0]?.id;
      }
      if (internalId) {
        userIds.set(u.id, internalId);
        await client.query(`SELECT register_id('app_user', $1, $2)`, [u.id, internalId]);
        counts.app_user++;
        // QA #14: every migrated user needs a user_identity row or
        // resolveSqlSession can never find them and dual mode silently no-ops.
        // Fall back to the Firestore doc id when authUid is absent.
        const authUid = u.authUid || u.id;
        const ir = await client.query(
          `INSERT INTO user_identity (user_id, auth_provider, auth_uid) VALUES ($1, 'firebase', $2)
           ON CONFLICT (auth_provider, auth_uid) DO NOTHING`,
          [internalId, authUid]
        );
        if (ir.rowCount) counts.user_identity++;
        // QA #12: map Firestore role onto user_role so RLS role branches work.
        const roleId = u.role === "admin" ? "admin" : u.role === "manager" ? "manager" : "se";
        await client.query(
          `INSERT INTO user_role (user_id, role_id, valid_from)
           SELECT $1, $2, now()
           WHERE NOT EXISTS (
             SELECT 1 FROM user_role WHERE user_id = $1 AND role_id = $2 AND valid_to IS NULL
           )`,
          [internalId, roleId]
        );
      }
    }

    // -- 3. account -----------------------------------------------------------
    for (const a of data.accounts || []) {
      const r = await client.query(
        `INSERT INTO account (public_id, name, domain, slug, industry, health_data, external_ref, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()))
         ON CONFLICT (public_id) DO NOTHING RETURNING id`,
        [
          a.id, a.name || "Unknown", a.domain || null, a.slug || null,
          a.industry || null,
          a.health ? JSON.stringify(a.health) : null,
          a.externalRef || null, toTs(a.createdAt),
        ]
      );
      const id = r.rows[0]?.id ?? (await client.query(`SELECT id FROM account WHERE public_id = $1`, [a.id])).rows[0]?.id;
      if (id) {
        accountIds.set(a.id, id);
        await client.query(`SELECT register_id('account', $1, $2)`, [a.id, id]);
        counts.account++;
      }
    }

    // -- 4. contact -----------------------------------------------------------
    for (const c of data.contacts || []) {
      const accId = accountIds.get(c.accountId);
      if (!accId) { console.warn(`skip contact ${c.id}: account ${c.accountId} unmapped`); continue; }
      const r = await client.query(
        `INSERT INTO contact (public_id, account_id, email, name, title, role, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()))
         ON CONFLICT (public_id) DO NOTHING RETURNING id`,
        [c.id, accId, String(c.email || "").toLowerCase(), c.name || null, c.title || null, c.role || null, toTs(c.createdAt)]
      );
      const id = r.rows[0]?.id ?? (await client.query(`SELECT id FROM contact WHERE public_id = $1`, [c.id])).rows[0]?.id;
      if (id) {
        contactIds.set(c.id, id);
        await client.query(`SELECT register_id('contact', $1, $2)`, [c.id, id]);
        counts.contact++;
      }
    }

    // -- 5. deal (from deals; lifecycles folded in per ADR-003/008) -----------
    const dealRows = [...(data.deals || [])];
    for (const lc of data.lifecycles || []) {
      if (lc.dealId) continue; // already linked; the linked deal row carries it
      dealRows.push({
        id: lc.id, // lc_* becomes the deal public_id
        accountId: lc.accountId,
        ownerId: lc.ownerId,
        teamId: lc.teamId,
        orgId: lc.orgId,
        title: lc.title || "New business",
        stage: LIFECYCLE_STAGE_TO_DEAL[lc.stage] || "prospecting",
        status: lc.status === "closed_won" ? "won" : lc.status === "closed_lost" ? "lost" : lc.status || "active",
        createdAt: lc.createdAt,
      });
    }
    for (const d of dealRows) {
      const accId = accountIds.get(d.accountId);
      const ownerId = userIds.get(d.ownerId);
      const orgUnitId = (d.teamId && orgIds.get(d.teamId)) || (d.orgId && orgIds.get(d.orgId)) || null;
      if (!accId || !ownerId || !orgUnitId) {
        console.warn(`skip deal ${d.id}: account/owner/org unmapped`);
        continue;
      }
      const r = await client.query(
        `INSERT INTO deal (public_id, account_id, owner_user_id, org_unit_id, name, stage, status, amount, currency_code, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, now()))
         ON CONFLICT (public_id) DO NOTHING RETURNING id`,
        [
          d.id, accId, ownerId, orgUnitId,
          d.title || d.name || "Untitled deal",
          dealStage(d.stage),
          dealStatus(d.status),
          d.amount ?? null, d.currency || "USD", toTs(d.createdAt),
        ]
      );
      const id = r.rows[0]?.id ?? (await client.query(`SELECT id FROM deal WHERE public_id = $1`, [d.id])).rows[0]?.id;
      if (id) {
        dealIds.set(d.id, id);
        await client.query(`SELECT register_id('deal', $1, $2)`, [d.id, id]);
        counts.deal++;
      }
    }

    // -- 6. deal_contact (ADR-007 §1) -----------------------------------------
    for (const dc of data.dealContacts || []) {
      const dealId = dealIds.get(dc.dealId);
      const contactId = contactIds.get(dc.contactId);
      if (!dealId || !contactId) continue;
      const r = await client.query(
        `INSERT INTO deal_contact (public_id, deal_id, contact_id, role, is_primary, created_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()))
         ON CONFLICT (deal_id, contact_id) DO NOTHING`,
        [dc.id, dealId, contactId, dc.role || null, !!dc.isPrimary, toTs(dc.createdAt)]
      );
      if (r.rowCount) counts.deal_contact++;
    }

    // -- 7. activity + pre_call / post_call ------------------------------------
    // prepBriefs -> activity(type=meeting) + pre_call; postCalls -> activity(type=call) + post_call.
    for (const p of data.prepBriefs || []) {
      const ownerId = userIds.get(p.ownerId);
      const accId = accountIds.get(p.accountId);
      const orgUnitId = (p.teamId && orgIds.get(p.teamId)) || (p.orgId && orgIds.get(p.orgId)) || null;
      if (!ownerId || !accId || !orgUnitId) continue;
      const dealId = p.dealId ? dealIds.get(p.dealId) ?? null : null;
      const ar = await client.query(
        `INSERT INTO activity (public_id, idempotency_key, deal_id, account_id, owner_user_id, org_unit_id, activity_type, subject, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'meeting', $7, COALESCE($8, now()))
         ON CONFLICT (public_id) DO NOTHING RETURNING id`,
        [`act_${p.id}`, `prep_${p.id}`, dealId, accId, ownerId, orgUnitId, p.title || "Prep", toTs(p.createdAt)]
      );
      const actId = ar.rows[0]?.id ?? (await client.query(`SELECT id FROM activity WHERE public_id = $1`, [`act_${p.id}`])).rows[0]?.id;
      if (!actId) continue;
      activityIds.set(p.id, actId);
      await client.query(`SELECT register_id('activity', $1, $2)`, [`act_${p.id}`, actId]);
      counts.activity++;
      const pr = await client.query(
        `INSERT INTO pre_call (public_id, idempotency_key, activity_id, research_brief, input_snapshot, generated_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()))
         ON CONFLICT (public_id) DO NOTHING`,
        [p.id, `prep_${p.id}`, actId, p.brief ? JSON.stringify(p.brief) : null, p.input ? JSON.stringify(p.input) : null, toTs(p.generatedAt)]
      );
      if (pr.rowCount) counts.pre_call++;
    }

    for (const pc of data.postCalls || []) {
      const ownerId = userIds.get(pc.ownerId);
      const accId = accountIds.get(pc.accountId);
      const orgUnitId = (pc.teamId && orgIds.get(pc.teamId)) || (pc.orgId && orgIds.get(pc.orgId)) || null;
      if (!ownerId || !accId || !orgUnitId) continue;
      const dealId = pc.dealId ? dealIds.get(pc.dealId) ?? null : null;
      const ar = await client.query(
        `INSERT INTO activity (public_id, idempotency_key, deal_id, account_id, owner_user_id, org_unit_id, activity_type, subject, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'call', $7, COALESCE($8, now()))
         ON CONFLICT (public_id) DO NOTHING RETURNING id`,
        [`act_${pc.id}`, `call_${pc.callIdentityKey || pc.id}`, dealId, accId, ownerId, orgUnitId, pc.title || "Call", toTs(pc.timestamp ?? pc.createdAt)]
      );
      const actId = ar.rows[0]?.id ?? (await client.query(`SELECT id FROM activity WHERE public_id = $1`, [`act_${pc.id}`])).rows[0]?.id;
      if (!actId) continue;
      activityIds.set(pc.id, actId);
      await client.query(`SELECT register_id('activity', $1, $2)`, [`act_${pc.id}`, actId]);
      counts.activity++;
      const pr = await client.query(
        `INSERT INTO post_call (public_id, idempotency_key, activity_id, transcript_ref, analysis, detail, pipeline_state, analysis_shape_version, detail_shape_version)
         VALUES ($1, $2, $3, $4, $5, $6, 'analysis_done', '1', '1')
         ON CONFLICT (public_id) DO NOTHING`,
        [
          pc.id, `call_${pc.callIdentityKey || pc.id}`, actId,
          pc.detailGcsUri || pc.transcriptRef || null,
          pc.analysis ? JSON.stringify(pc.analysis) : null,
          pc.detail ? JSON.stringify(pc.detail) : null,
        ]
      );
      if (pr.rowCount) counts.post_call++;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }

  console.log("migration complete:", counts);
}

main().catch((err) => {
  console.error("migrate-firestore-to-sql error:", err.message);
  process.exit(1);
});
