#!/usr/bin/env node
/**
 * AT-2 — Post-call.
 *
 * Setup: SE-A analyses one call on D1 with a full detail payload, then
 * re-analyses it.
 *
 * Asserts:
 *   1. Exactly one post_call row (idempotent on idempotency_key), detail intact.
 *   2. post_call.se_motion equals the SE's RESOLVED motion, not the
 *      new_business default -- and a defaulted row is distinguishable from a
 *      determined one.
 *   3. All 10 projected detail arrays round-trip with the content written.
 *   4. A detail payload with an unknown key fails loudly. (Application guard
 *      -- see the note at that assertion.)
 *
 * Usage: node janus/tests/acceptance/at2_postcall.test.mjs
 */

import {
  RUN, appClient, migClient, asUser, check, checkEq, pending,
  provisionOrg, provisionUser, provisionAccount, provisionDeal, insertActivity,
  requireEnv, summary, teardown,
} from "./lib/harness.mjs";

if (!requireEnv()) process.exit(0);

const app = await appClient();
const mig = await migClient();

/** The ten arrays the detail pass projects. */
const DETAIL_ARRAYS = [
  "objections", "commitments", "nextSteps", "risks", "stakeholders",
  "competitors", "productGaps", "useCases", "technicalRequirements", "decisionCriteria",
];

function buildDetail() {
  const d = {};
  for (const [i, k] of DETAIL_ARRAYS.entries()) {
    d[k] = [{ id: `${k}_1`, text: `${k} item one`, atS: 60 + i },
            { id: `${k}_2`, text: `${k} item two`, atS: 120 + i }];
  }
  return d;
}

try {
  const org = await provisionOrg(mig);

  // SE-A is on team_a under seg_new_business -> resolves to new_business.
  const seA = await provisionUser(mig, { slug: "a", orgUnitId: org.teamA, orgPath: org.paths[org.teamA] });
  // SE-E is on team_b under seg_nurture -> resolves to EXPANSION. This is the
  // SE whose motion the old silent default got wrong.
  const seE = await provisionUser(mig, { slug: "e", orgUnitId: org.teamB, orgPath: org.paths[org.teamB] });

  const acc = await provisionAccount(mig, { slug: "a", seUserIds: [seA.id, seE.id] });
  const d1 = await provisionDeal(mig, { slug: "d1", accountId: acc.id, ownerUserId: seA.id, orgUnitId: org.teamA });

  // -------------------------------------------------------------------------
  // Motion resolution happens server-side, from the SE's actual org position.
  // -------------------------------------------------------------------------
  const motions = await mig.query(
    `SELECT resolve_se_motion_for_user($1) AS a, resolve_se_motion_for_user($2) AS e`,
    [seA.id, seE.id],
  );
  checkEq("AT-2.0a SE on seg_new_business resolves to new_business", motions.rows[0].a, "new_business");
  checkEq("AT-2.0b SE on seg_nurture resolves to expansion", motions.rows[0].e, "expansion");

  // An SE under a unit with no default anywhere up the chain resolves to
  // NULL, not new_business. That NULL is what forces the caller to decide
  // rather than silently mis-scoring the call.
  await mig.query(
    `INSERT INTO org_unit (id, name, parent_id, unit_type, path)
     VALUES ($1, 'AT Orphan Team', $2, 'team', $3)
     ON CONFLICT (id) DO NOTHING`,
    [`${RUN}_team_orphan`, org.org, `/${org.org}/${RUN}_team_orphan/`],
  );
  const orphanMotion = await mig.query(`SELECT resolve_se_motion($1) AS m`, [`${RUN}_team_orphan`]);
  checkEq("AT-2.0c unit with no default anywhere resolves to NULL, not new_business",
          orphanMotion.rows[0].m, null);

  // -------------------------------------------------------------------------
  // Analyse, then re-analyse with the same idempotency key.
  // -------------------------------------------------------------------------
  const detail = buildDetail();

  const act = await asUser(app, seA, async (c) => {
    const a = await insertActivity(c, {
      slug: "call1", dealId: d1.id, accountId: acc.id, ownerUserId: seA.id,
      orgUnitId: org.teamA, type: "call",
    });
    await c.query(
      `INSERT INTO post_call (public_id, idempotency_key, activity_id, transcript_ref,
                              analysis, detail, pipeline_state,
                              se_motion, se_motion_source, call_type)
       VALUES ($1, $1, $2, 'gs://at/transcript.txt', $3, $4, 'detail_done',
               $5, 'resolved', 'discovery')`,
      [`${RUN}_post_call1`, a.id,
       JSON.stringify({ qualityCoach: { overallScore: 7.4 } }),
       JSON.stringify(detail), motions.rows[0].a],
    );
    return a;
  });

  // Re-analysis: the same idempotency key must not create a second row.
  await asUser(app, seA, async (c) => {
    await c.query(
      `INSERT INTO post_call (public_id, idempotency_key, activity_id, transcript_ref,
                              analysis, detail, pipeline_state,
                              se_motion, se_motion_source, call_type)
       VALUES ($1, $1, $2, 'gs://at/transcript.txt', $3, $4, 'scoring_done',
               $5, 'resolved', 'discovery')
       -- idx_post_call_idempotency is PARTIAL (WHERE idempotency_key IS NOT
       -- NULL), so ON CONFLICT has to repeat the predicate to infer it --
       -- exactly as upsertPostCall does in postgres-repository.ts.
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET
           analysis = EXCLUDED.analysis,
           detail = EXCLUDED.detail,
           pipeline_state = EXCLUDED.pipeline_state,
           updated_at = now()`,
      [`${RUN}_post_call1`, act.id,
       JSON.stringify({ qualityCoach: { overallScore: 7.4 }, reanalysed: true }),
       JSON.stringify(detail), motions.rows[0].a],
    );
  });

  // -------------------------------------------------------------------------
  // 1. One row, detail intact.
  // -------------------------------------------------------------------------
  const rows = await asUser(app, seA, async (c) => {
    const r = await c.query(
      `SELECT public_id, detail, analysis, se_motion, se_motion_source, call_type,
              pipeline_state
         FROM post_call WHERE public_id LIKE $1`,
      [`${RUN}\\_post\\_%`],
    );
    return r.rows;
  });

  checkEq("AT-2.1a exactly one post_call row after re-analysis", rows.length, 1);
  check("AT-2.1b re-analysis updated rather than duplicated",
        rows[0]?.analysis?.reanalysed === true && rows[0]?.pipeline_state === "scoring_done",
        `state=${rows[0]?.pipeline_state}`);

  // A second row on the same activity must be impossible regardless of key:
  // post_call.activity_id is UNIQUE.
  const dupErr = await (async () => {
    try {
      await asUser(app, seA, async (c) => {
        await c.query(
          `INSERT INTO post_call (public_id, idempotency_key, activity_id, se_motion,
                                  se_motion_source, call_type)
           VALUES ($1, $1, $2, 'new_business', 'resolved', 'discovery')`,
          [`${RUN}_post_dup`, act.id],
        );
      });
      return null;
    } catch (e) { return e; }
  })();
  check("AT-2.1c a second post_call on the same activity is rejected",
        dupErr !== null, dupErr ? dupErr.code : "insert succeeded");

  // -------------------------------------------------------------------------
  // 2. Motion provenance. This is the assertion the whole se_motion_source
  //    column exists for.
  // -------------------------------------------------------------------------
  checkEq("AT-2.2a se_motion is the resolved value", rows[0]?.se_motion, "new_business");
  checkEq("AT-2.2b se_motion_source records HOW it was arrived at",
          rows[0]?.se_motion_source, "resolved");

  // The expansion SE: motion resolved, not defaulted. Under the old model
  // this row would read new_business and be scored against the wrong profile
  // (32 credits and different themes instead of 27).
  const expRow = await asUser(app, seE, async (c) => {
    const a = await insertActivity(c, {
      slug: "call2", dealId: d1.id, accountId: acc.id, ownerUserId: seE.id,
      orgUnitId: org.teamB, type: "call",
    });
    await c.query(
      `INSERT INTO post_call (public_id, idempotency_key, activity_id,
                              se_motion, se_motion_source, call_type)
       VALUES ($1, $1, $2, $3, 'resolved', 'discovery')`,
      [`${RUN}_post_call2`, a.id, motions.rows[0].e],
    );
    const r = await c.query(
      `SELECT se_motion, se_motion_source FROM post_call WHERE public_id = $1`,
      [`${RUN}_post_call2`]);
    return r.rows[0];
  });
  checkEq("AT-2.2c expansion SE's call stamps expansion", expRow.se_motion, "expansion");

  // A defaulted row is distinguishable from a determined one.
  const defaulted = await asUser(app, seA, async (c) => {
    const a = await insertActivity(c, {
      slug: "call3", dealId: d1.id, accountId: acc.id, ownerUserId: seA.id,
      orgUnitId: org.teamA, type: "call",
    });
    await c.query(
      `INSERT INTO post_call (public_id, idempotency_key, activity_id,
                              se_motion, se_motion_source, call_type)
       VALUES ($1, $1, $2, 'new_business', 'defaulted', 'discovery')`,
      [`${RUN}_post_call3`, a.id]);
    const r = await c.query(
      `SELECT count(*)::int AS n FROM post_call
        WHERE public_id LIKE $1 AND se_motion_source = 'defaulted'`,
      [`${RUN}\\_post\\_%`]);
    return r.rows[0].n;
  });
  checkEq("AT-2.2d a defaulted motion is queryable as such", defaulted, 1);

  // And the column DEFAULT is gone, so a row cannot omit the motion silently.
  const noMotionErr = await (async () => {
    try {
      await asUser(app, seA, async (c) => {
        const a = await insertActivity(c, {
          slug: "call4", dealId: d1.id, accountId: acc.id, ownerUserId: seA.id,
          orgUnitId: org.teamA, type: "call",
        });
        await c.query(
          `INSERT INTO post_call (public_id, idempotency_key, activity_id, call_type)
           VALUES ($1, $1, $2, 'discovery')`,
          [`${RUN}_post_call4`, a.id]);
      });
      return null;
    } catch (e) { return e; }
  })();
  check("AT-2.2e omitting se_motion is now an error, not a silent new_business",
        noMotionErr !== null && noMotionErr.code === "23502",
        noMotionErr ? `${noMotionErr.code}` : "insert succeeded — the DEFAULT is still there");

  // -------------------------------------------------------------------------
  // 3. All ten projected arrays round-trip.
  // -------------------------------------------------------------------------
  const stored = rows[0]?.detail || {};
  const missing = DETAIL_ARRAYS.filter((k) => !Array.isArray(stored[k]) || stored[k].length !== 2);
  checkEq("AT-2.3a all 10 detail arrays present with their content", missing, []);
  // jsonb does NOT preserve object key order -- Postgres stores keys sorted by
  // length then bytewise -- so a raw JSON.stringify comparison fails on a
  // perfectly intact round-trip. Canonicalise before comparing.
  const canon = (v) =>
    Array.isArray(v) ? v.map(canon)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
      : v;
  check("AT-2.3b array contents identical to what was written",
        JSON.stringify(canon(stored)) === JSON.stringify(canon(detail)),
        `${Object.keys(stored).length} keys, canonicalised compare`);

  // -------------------------------------------------------------------------
  // 4. An unknown detail key.
  // -------------------------------------------------------------------------
  pending(
    "AT-2.4 unknown detail key fails loudly",
    "post_call.detail is jsonb and accepts any shape by design — the ten " +
      "projected arrays are a code contract (postcall-schema.ts), not a " +
      "column list. Constraining it in SQL would freeze the shape the branch " +
      "still changes. The write path must validate before insert.",
  );

  process.exitCode = summary("AT-2 post-call") ? 0 : 1;
} finally {
  await teardown(mig);
  await mig.query(`DELETE FROM org_unit WHERE id = $1`, [`${RUN}_team_orphan`]).catch(() => {});
  await app.end();
  await mig.end();
}
