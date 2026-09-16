#!/usr/bin/env node
/**
 * Show exactly what a pre-call or post-call write landed in Postgres.
 *
 * Run this after creating a prep brief or a post-call analysis in the app, to
 * confirm the relational tables actually received the data rather than only
 * Firestore. Read-only -- it writes nothing.
 *
 * Prints, per record: the activity row, the pre_call/post_call row, the
 * account/deal/contact rows the FKs resolved to, and then the tables that are
 * EXPECTED TO BE EMPTY today because nothing writes them yet (scorecard,
 * call_participant, task, product_signal). An empty scorecard table is not a
 * bug in the schema -- PostgresRepository.upsertScorecard has no production
 * caller. See docs/datamodel/BUILD_PLAN.md section 8.
 *
 * Usage:
 *   node janus/scripts/verify-call-storage.mjs                 # 10 most recent of each
 *   node janus/scripts/verify-call-storage.mjs pcl_abc123      # one record by public_id
 *   node janus/scripts/verify-call-storage.mjs --counts        # just the row counts
 *
 * Connects with DATABASE_URL_MIGRATIONS by default so RLS cannot hide a row
 * you are looking for. Pass --as-app to connect as janus_app instead, which is
 * how you confirm RLS is actually scoping reads (you will need to supply the
 * session vars the app sets -- see --as-app output).
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import { loadDevVars, WORKER_ROOT } from "../../worker/scripts/lib/load-dev-vars.mjs";
import { pgClientConfig } from "../../worker/scripts/lib/pg-client-config.mjs";

const require = createRequire(join(WORKER_ROOT, "package.json"));

loadDevVars();

const args = process.argv.slice(2);
const asApp = args.includes("--as-app");
const countsOnly = args.includes("--counts");
const publicId = args.find((a) => !a.startsWith("--")) || null;

const url = asApp
  ? process.env.DATABASE_URL
  : process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;

if (!url) {
  console.error(
    "No connection string.\n" +
      "  DATABASE_URL_MIGRATIONS  preferred here -- bypasses RLS so nothing is hidden\n" +
      "  DATABASE_URL             with --as-app, to verify RLS scoping instead\n" +
      "Set one in worker/.dev.vars.",
  );
  process.exit(1);
}

const pg = require("pg");
const client = new pg.Client(pgClientConfig(url));
await client.connect();

// The migration role does NOT see past RLS here. account, deal, activity,
// pre_call, post_call and scorecard are all FORCE ROW LEVEL SECURITY, which
// subjects the table OWNER to the policies, and managed Postgres does not give
// the admin role rolsuper or rolbypassrls. Without this an admin-role query
// returns ZERO rows and every table looks empty -- which reads exactly like
// "the dual-write never landed" and is completely wrong.
if (!asApp) {
  await client.query(`SELECT set_config('app.is_admin', 'true', false)`);
}

function heading(text) {
  console.log(`\n${"=".repeat(72)}\n${text}\n${"=".repeat(72)}`);
}

function table(rows) {
  if (!rows || rows.length === 0) {
    console.log("  (no rows)");
    return;
  }
  for (const [i, row] of rows.entries()) {
    if (rows.length > 1) console.log(`  --- ${i + 1} of ${rows.length} ---`);
    for (const [k, v] of Object.entries(row)) {
      let shown;
      if (v === null) shown = "NULL";
      else if (typeof v === "object") {
        const json = JSON.stringify(v);
        shown = json.length > 120 ? `${json.slice(0, 117)}… (${json.length} chars)` : json;
      } else shown = String(v);
      console.log(`  ${k.padEnd(26)} ${shown}`);
    }
  }
}

try {
  // -------------------------------------------------------------------------
  // Row counts across everything a call flow touches.
  // -------------------------------------------------------------------------
  heading("Row counts");

  const counts = await client.query(`
    SELECT 'account'          AS tbl, count(*)::int AS n FROM account
    UNION ALL SELECT 'contact',          count(*)::int FROM contact
    UNION ALL SELECT 'deal',             count(*)::int FROM deal
    UNION ALL SELECT 'deal_contact',     count(*)::int FROM deal_contact
    UNION ALL SELECT 'activity',         count(*)::int FROM activity
    UNION ALL SELECT 'pre_call',         count(*)::int FROM pre_call
    UNION ALL SELECT 'post_call',        count(*)::int FROM post_call
    UNION ALL SELECT 'scorecard',        count(*)::int FROM scorecard
    UNION ALL SELECT 'scorecard_theme',  count(*)::int FROM scorecard_theme
    UNION ALL SELECT 'scorecard_line',   count(*)::int FROM scorecard_line
    UNION ALL SELECT 'call_participant', count(*)::int FROM call_participant
    UNION ALL SELECT 'task',             count(*)::int FROM task
    UNION ALL SELECT 'product_signal',   count(*)::int FROM product_signal
    UNION ALL SELECT 'app_user',         count(*)::int FROM app_user
    UNION ALL SELECT 'org_unit',         count(*)::int FROM org_unit
    UNION ALL SELECT 'rubric',           count(*)::int FROM rubric
    UNION ALL SELECT 'rubric_theme',     count(*)::int FROM rubric_theme
    UNION ALL SELECT 'rubric_parameter', count(*)::int FROM rubric_parameter
    UNION ALL SELECT 'id_registry',      count(*)::int FROM id_registry
    UNION ALL SELECT 'sync_outbox',      count(*)::int FROM sync_outbox
    UNION ALL SELECT 'audit_log',        count(*)::int FROM audit_log
    ORDER BY tbl`);

  // Tables with no production writer today -- an empty count is expected, not
  // a failure, and saying so here stops it being reported as a bug.
  const NO_WRITER = {
    scorecard: "wired via trySqlDomainWrite; empty until a call is scored in dual mode",
    scorecard_theme: "written per theme by upsertScorecardTheme, after the header",
    scorecard_line: "the five sub-parameter verdicts per theme",
    call_participant: "computed by postcall/participants.ts and discarded (D9) — still unwired",
    task: "no INSERT INTO task anywhere in worker/src (D8) — still unwired",
    audit_log: "writer added in migration 25; triggers fire on score/role changes",
  };
  const EXPECTED = {
    rubric: 19,
    rubric_theme: 270,
    rubric_parameter: 1350,
  };

  for (const r of counts.rows) {
    let note = "";
    if (EXPECTED[r.tbl] != null) {
      note = r.n === EXPECTED[r.tbl]
        ? `  <- loader ran correctly (${EXPECTED[r.tbl]})`
        : `  <- EXPECTED ${EXPECTED[r.tbl]}; run load-rubric-catalog.mjs`;
    } else if (r.n === 0 && NO_WRITER[r.tbl]) {
      note = `  <- empty is expected: ${NO_WRITER[r.tbl]}`;
    }
    console.log(`  ${r.tbl.padEnd(18)} ${String(r.n).padStart(6)}${note}`);
  }

  if (countsOnly) {
    await client.end();
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // Pre-call briefs
  // -------------------------------------------------------------------------
  heading(publicId ? `pre_call matching ${publicId}` : "pre_call — 10 most recent");

  const pre = await client.query(
    `SELECT p.public_id,
            p.idempotency_key,
            a.public_id                AS activity_public_id,
            a.activity_type,
            a.subject,
            a.occurred_at,
            d.public_id                AS deal_public_id,
            acc.public_id              AS account_public_id,
            acc.name                   AS account_name,
            u.email                    AS owner_email,
            a.org_unit_id,
            (p.research_brief IS NOT NULL) AS has_research_brief,
            (p.input_snapshot IS NOT NULL) AS has_input_snapshot,
            p.generated_at,
            p.created_at
       FROM pre_call p
       JOIN activity a   ON a.id = p.activity_id
       LEFT JOIN deal d  ON d.id = a.deal_id
       JOIN account acc  ON acc.id = a.account_id
       JOIN app_user u   ON u.id = a.owner_user_id
      WHERE ($1::text IS NULL OR p.public_id = $1 OR a.public_id = $1)
      ORDER BY p.created_at DESC
      LIMIT 10`,
    [publicId],
  );
  table(pre.rows);

  const deallessBriefs = await client.query(
    `SELECT count(*)::int AS n
       FROM pre_call p JOIN activity a ON a.id = p.activity_id
      WHERE a.deal_id IS NULL`);
  if (deallessBriefs.rows[0].n > 0) {
    console.log(
      `\n  !! ${deallessBriefs.rows[0].n} brief(s) have NO deal — these are invisible to the ` +
        `read path (it inner-joins deal). Migration 29 prevents new ones; these predate it.`,
    );
  }

  // -------------------------------------------------------------------------
  // Post-call analyses
  // -------------------------------------------------------------------------
  heading(publicId ? `post_call matching ${publicId}` : "post_call — 10 most recent");

  const post = await client.query(
    `SELECT pc.public_id,
            pc.idempotency_key,
            a.public_id               AS activity_public_id,
            a.activity_type,
            a.subject,
            a.occurred_at,
            d.public_id               AS deal_public_id,
            acc.name                  AS account_name,
            u.email                   AS owner_email,
            a.org_unit_id,
            pc.pipeline_state,
            pc.se_motion,
            pc.se_motion_source,
            pc.call_type,
            pc.transcript_ref,
            pc.analysis_shape_version,
            pc.detail_shape_version,
            (pc.analysis IS NOT NULL)  AS has_analysis,
            (pc.detail IS NOT NULL)    AS has_detail,
            pc.analysis #>> '{qualityCoach,overallScore}' AS qip_score_in_analysis,
            pc.created_at,
            pc.updated_at
       FROM post_call pc
       JOIN activity a   ON a.id = pc.activity_id
       LEFT JOIN deal d  ON d.id = a.deal_id
       JOIN account acc  ON acc.id = a.account_id
       JOIN app_user u   ON u.id = a.owner_user_id
      WHERE ($1::text IS NULL OR pc.public_id = $1 OR a.public_id = $1)
      ORDER BY pc.created_at DESC
      LIMIT 10`,
    [publicId],
  );
  table(post.rows);

  // Which detail arrays actually arrived, and how many items in each.
  if (post.rows.length > 0) {
    heading("post_call.detail — projected arrays, per record");
    const detail = await client.query(
      `SELECT pc.public_id, k.key, jsonb_array_length(pc.detail -> k.key) AS items
         FROM post_call pc
         CROSS JOIN LATERAL jsonb_object_keys(pc.detail) AS k(key)
        WHERE pc.detail IS NOT NULL
          AND jsonb_typeof(pc.detail -> k.key) = 'array'
          AND ($1::text IS NULL OR pc.public_id = $1)
        ORDER BY pc.public_id, k.key`,
      [publicId],
    );
    if (detail.rows.length === 0) {
      console.log("  (detail has no array-valued keys)");
    } else {
      let current = null;
      for (const r of detail.rows) {
        if (r.public_id !== current) {
          current = r.public_id;
          console.log(`\n  ${current}`);
        }
        console.log(`    ${r.key.padEnd(28)} ${String(r.items).padStart(4)} item(s)`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Motion provenance — the thing that silently went wrong before
  // -------------------------------------------------------------------------
  heading("Motion provenance");

  const motion = await client.query(
    `SELECT COALESCE(se_motion_source, '(null — writer did not set it)') AS source,
            se_motion,
            count(*)::int AS n
       FROM post_call
      GROUP BY 1, 2 ORDER BY 1, 2`);
  table(motion.rows);
  console.log(
    "\n  se_motion_source null means the write path has not been updated to record HOW the\n" +
      "  motion was decided. Until it does, a resolved motion is indistinguishable from the\n" +
      "  old silent new_business fallback. See docs/datamodel/FIELD_MAP.md section 5.",
  );

  // What the org tree WOULD resolve for each post-call's owner, so you can
  // compare it against what actually got stamped.
  const drift = await client.query(
    `SELECT pc.public_id,
            u.email                              AS owner,
            pc.se_motion                         AS stamped,
            resolve_se_motion(u.org_unit_id)     AS resolved_from_org_tree
       FROM post_call pc
       JOIN activity a ON a.id = pc.activity_id
       JOIN app_user u ON u.id = a.owner_user_id
      WHERE pc.se_motion IS DISTINCT FROM resolve_se_motion(u.org_unit_id)
      LIMIT 10`);
  if (drift.rows.length > 0) {
    console.log(
      `\n  !! ${drift.rows.length} post_call row(s) stamped a motion that disagrees with the org tree:`,
    );
    table(drift.rows);
    console.log(
      "  Either default_se_motion is not set on the segment rows yet, or the motion was\n" +
        "  overridden, or the silent fallback fired. se_motion_source is what tells them apart.",
    );
  }

  // -------------------------------------------------------------------------
  // Dual-write projection back to Firestore
  // -------------------------------------------------------------------------
  heading("sync_outbox — projection to Firestore (dual mode)");

  const outbox = await client.query(
    `SELECT status, count(*)::int AS n, max(created_at) AS latest
       FROM sync_outbox GROUP BY status ORDER BY status`);
  table(outbox.rows);
  console.log(
    "\n  In dual mode every SQL write also enqueues an outbox row that projects to Firestore.\n" +
      "  Rows stuck in 'pending' or 'failed' mean SQL and Firestore have drifted apart.",
  );

  // -------------------------------------------------------------------------
  // id_registry — the public_id <-> bigint bridge every FK resolution uses
  // -------------------------------------------------------------------------
  heading("id_registry — mappings by entity type");
  const reg = await client.query(
    `SELECT entity_type, count(*)::int AS n
       FROM id_registry GROUP BY entity_type ORDER BY entity_type`);
  table(reg.rows);
  console.log(
    "\n  A missing mapping is why a write fails with \"no mapping for deal/…\" — the parent\n" +
      "  has to exist in Postgres before a child row can reference it.",
  );

  if (asApp) {
    heading("RLS note");
    console.log(
      "  Connected as janus_app with no session variables set. 17_rls_role_defaults.sql\n" +
        "  sets fail-closed defaults, so RLS-protected tables should have returned ZERO rows\n" +
        "  above. If you saw rows, RLS is not doing its job. To read as a real user, the app\n" +
        "  sets these inside a transaction:\n\n" +
        "    BEGIN;\n" +
        "    SELECT set_config('app.user_id', '<app_user.id>', true),\n" +
        "           set_config('app.org_unit_path', '<org_unit.path>', true),\n" +
        "           set_config('app.is_admin', 'false', true);\n" +
        "    -- your SELECT here\n" +
        "    COMMIT;",
    );
  }
} catch (err) {
  console.error(`\nQuery failed: ${err.message}`);
  if (/does not exist/.test(err.message)) {
    console.error(
      "\nA relation or column is missing. Has the schema been applied?\n" +
        "  node worker/scripts/apply-janus-schema.mjs --dry-run\n" +
        "  node worker/scripts/apply-janus-schema.mjs",
    );
  }
  process.exitCode = 1;
} finally {
  await client.end();
}
