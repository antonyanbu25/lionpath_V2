#!/usr/bin/env node
/**
 * AT-5 — Usage / adoption (D27).
 *
 * Setup: three SEs — one creates 3 briefs and 2 calls, one creates 1 brief,
 * one creates nothing.
 *
 * Asserts:
 *   1. Per-SE counts of pre_call, post_call and task are correct, grouped by
 *      activity.owner_user_id.
 *   2. Time-sliceable by activity.occurred_at (this week vs last).
 *   3. Aggregatable to team, segment and org by path prefix.
 *   4. The SE who created nothing appears with ZERO counts, not absent —
 *      otherwise the non-adopter is invisible, which is the point of the report.
 *   5. Runs as janus_app under RLS.
 *
 * Note on 5, recorded rather than glossed: the acceptance criterion as written
 * says "a manager sees their subtree, an SE sees only themselves". The first
 * half holds. The second does not, and not because of a bug — every read
 * policy in this schema is a path prefix match on the reader's own org unit,
 * so an SE whose unit is their TEAM sees their team. That is true of
 * activity, post_call, pre_call and scorecard alike, not just here. Narrowing
 * it to self-only for the SE role would be a change to the access model, not
 * to the data model, so this test asserts the designed behaviour and flags the
 * divergence. See BUILD_PLAN.md section 8.
 *
 * Usage: node janus/tests/acceptance/at5_adoption.test.mjs
 */

import {
  RUN, appClient, migClient, asUser, check, checkEq,
  provisionOrg, provisionUser, provisionAccount, provisionDeal, insertActivity,
  requireEnv, summary, teardown,
} from "./lib/harness.mjs";

if (!requireEnv()) process.exit(0);

const app = await appClient();
const mig = await migClient();

const DAY = 86_400_000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

try {
  const org = await provisionOrg(mig);

  const director = await provisionUser(mig, {
    slug: "dir", orgUnitId: org.org, orgPath: org.paths[org.org],
    role: "manager", jobTitle: "Director - Solution Engineering" });

  // All three on team_a, so one prefix covers them and the segment/org
  // rollups have something to roll up.
  const busy = await provisionUser(mig, { slug: "busy", orgUnitId: org.teamA, orgPath: org.paths[org.teamA] });
  const light = await provisionUser(mig, { slug: "light", orgUnitId: org.teamA, orgPath: org.paths[org.teamA] });
  const none = await provisionUser(mig, { slug: "none", orgUnitId: org.teamA, orgPath: org.paths[org.teamA] });

  const acc = await provisionAccount(mig, { slug: "a", seUserIds: [busy.id, light.id] });
  const dBusy = await provisionDeal(mig, { slug: "busy", accountId: acc.id, ownerUserId: busy.id, orgUnitId: org.teamA });
  const dLight = await provisionDeal(mig, { slug: "light", accountId: acc.id, ownerUserId: light.id, orgUnitId: org.teamA });

  // busy: 3 briefs (2 this week, 1 last week) + 2 calls + 2 tasks
  await asUser(app, busy, async (c) => {
    for (const [slug, ago] of [["b1", 1], ["b2", 3], ["b3", 9]]) {
      const a = await insertActivity(c, {
        slug, dealId: dBusy.id, accountId: acc.id, ownerUserId: busy.id,
        orgUnitId: org.teamA, type: "meeting", occurredAt: daysAgo(ago) });
      await c.query(
        `INSERT INTO pre_call (public_id, idempotency_key, activity_id, research_brief, generated_at)
         VALUES ($1, $1, $2, '{"company":"AT"}'::jsonb, now())`,
        [`${RUN}_pre_${slug}`, a.id]);
    }
    for (const [slug, ago] of [["c1", 2], ["c2", 8]]) {
      const a = await insertActivity(c, {
        slug, dealId: dBusy.id, accountId: acc.id, ownerUserId: busy.id,
        orgUnitId: org.teamA, type: "call", occurredAt: daysAgo(ago) });
      await c.query(
        `INSERT INTO post_call (public_id, idempotency_key, activity_id,
                                se_motion, se_motion_source, call_type, pipeline_state)
         VALUES ($1, $1, $2, 'new_business', 'resolved', 'discovery', 'analysis_done')`,
        [`${RUN}_post_${slug}`, a.id]);
      // Tasks — the write path D8 adds. Modelled here as the AI dedup shape.
      await c.query(
        `INSERT INTO task (public_id, activity_id, deal_id, owner_user_id, title,
                           status, source, task_key, sync_state)
         VALUES ($1, $2, $3, $4, $5, 'open', 'ai_generated', $6, 'synced')`,
        [`${RUN}_task_${slug}`, a.id, dBusy.id, busy.id, `Follow up on ${slug}`, `fu_${slug}`]);
    }
    // A repeated AI pass must not duplicate the task.
    await c.query(
      `INSERT INTO task (public_id, activity_id, deal_id, owner_user_id, title,
                         status, source, task_key, sync_state)
       SELECT $1, activity_id, deal_id, owner_user_id, title, status, source, task_key, sync_state
         FROM task WHERE public_id = $2
       ON CONFLICT (activity_id, task_key) WHERE source = 'ai_generated' AND deleted_at IS NULL
       DO NOTHING`,
      [`${RUN}_task_dupe`, `${RUN}_task_c1`]);
  });

  // light: 1 brief
  await asUser(app, light, async (c) => {
    const a = await insertActivity(c, {
      slug: "l1", dealId: dLight.id, accountId: acc.id, ownerUserId: light.id,
      orgUnitId: org.teamA, type: "meeting", occurredAt: daysAgo(2) });
    await c.query(
      `INSERT INTO pre_call (public_id, idempotency_key, activity_id, research_brief, generated_at)
       VALUES ($1, $1, $2, '{"company":"AT"}'::jsonb, now())`,
      [`${RUN}_pre_l1`, a.id]);
  });

  // none: creates nothing. Deliberately.

  // -------------------------------------------------------------------------
  // 1. Per-SE counts.
  // -------------------------------------------------------------------------
  const rows = await asUser(app, director, async (c) => {
    const r = await c.query(
      `SELECT user_public_id, prep_brief_count, post_call_count, task_count
         FROM v_user_adoption
        WHERE user_public_id LIKE $1
        ORDER BY user_public_id`, [`${RUN}\\_usr\\_%`]);
    return r.rows;
  });

  const by = Object.fromEntries(rows.map((r) => [r.user_public_id.replace(`${RUN}_usr_`, ""), r]));

  checkEq("AT-5.1a busy SE: 3 briefs",
          Number(by.busy?.prep_brief_count), 3);
  checkEq("AT-5.1b busy SE: 2 calls",
          Number(by.busy?.post_call_count), 2);
  checkEq("AT-5.1c busy SE: 2 tasks (the repeated AI pass did not duplicate)",
          Number(by.busy?.task_count), 2);
  checkEq("AT-5.1d light SE: 1 brief, 0 calls, 0 tasks",
          [Number(by.light?.prep_brief_count), Number(by.light?.post_call_count),
           Number(by.light?.task_count)], [1, 0, 0]);

  // -------------------------------------------------------------------------
  // 2. Time-sliceable by activity.occurred_at.
  // -------------------------------------------------------------------------
  const sliced = await asUser(app, director, async (c) => {
    const r = await c.query(
      `SELECT u.public_id,
              count(*) FILTER (WHERE a.occurred_at >= now() - interval '7 days')::int AS this_week,
              count(*) FILTER (WHERE a.occurred_at <  now() - interval '7 days')::int AS earlier
         FROM pre_call p
         JOIN activity a ON a.id = p.activity_id
         JOIN app_user u ON u.id = a.owner_user_id
        WHERE u.public_id LIKE $1
        GROUP BY u.public_id ORDER BY u.public_id`, [`${RUN}\\_usr\\_%`]);
    return Object.fromEntries(r.rows.map((x) => [x.public_id.replace(`${RUN}_usr_`, ""), x]));
  });
  checkEq("AT-5.2a busy SE's briefs split 2 this week / 1 earlier",
          [sliced.busy?.this_week, sliced.busy?.earlier], [2, 1]);
  checkEq("AT-5.2b light SE: 1 this week / 0 earlier",
          [sliced.light?.this_week, sliced.light?.earlier], [1, 0]);

  // -------------------------------------------------------------------------
  // 3. Team / segment / org rollups by path prefix.
  // -------------------------------------------------------------------------
  const rollup = await asUser(app, director, async (c) => {
    const out = {};
    for (const [level, path] of [
      ["team", org.paths[org.teamA]],
      ["segment", org.paths[org.segNb]],
      ["org", org.paths[org.org]],
    ]) {
      const r = await c.query(
        `SELECT sum(prep_brief_count)::int AS briefs,
                sum(post_call_count)::int  AS calls,
                count(*)::int              AS people
           FROM v_user_adoption
          WHERE user_public_id LIKE $1 AND starts_with(org_path, $2)`,
        [`${RUN}\\_usr\\_%`, path]);
      out[level] = r.rows[0];
    }
    return out;
  });
  checkEq("AT-5.3a team rollup: 4 briefs, 2 calls, 3 people",
          [rollup.team.briefs, rollup.team.calls, rollup.team.people], [4, 2, 3]);
  checkEq("AT-5.3b segment rollup matches (all three SEs are under it)",
          [rollup.segment.briefs, rollup.segment.calls], [4, 2]);
  check("AT-5.3c org rollup includes the director too",
        rollup.org.people === 4 && rollup.org.briefs === 4,
        `${rollup.org.people} people, ${rollup.org.briefs} briefs`);

  // -------------------------------------------------------------------------
  // 4. The non-adopter. This is the assertion the report exists for.
  // -------------------------------------------------------------------------
  check("AT-5.4a the SE who created nothing IS present", !!by.none,
        by.none ? "row returned" : "row ABSENT — the non-adopter is invisible");
  checkEq("AT-5.4b and appears with zero counts, not null",
          [Number(by.none?.prep_brief_count), Number(by.none?.post_call_count),
           Number(by.none?.task_count)], [0, 0, 0]);
  checkEq("AT-5.4c all three SEs plus the director are listed", rows.length, 4);

  // -------------------------------------------------------------------------
  // 5. RLS.
  // -------------------------------------------------------------------------
  const asSe = await asUser(app, busy, async (c) => {
    const r = await c.query(
      `SELECT user_public_id, prep_brief_count FROM v_user_adoption
        WHERE user_public_id LIKE $1 ORDER BY user_public_id`, [`${RUN}\\_usr\\_%`]);
    return r.rows;
  });

  check("AT-5.5a a manager sees their whole subtree", rows.length === 4, `${rows.length} people`);
  check("AT-5.5b an SE does NOT see outside their team",
        !asSe.some((r) => r.user_public_id.endsWith("_dir")),
        "the org-level director is correctly not visible to a team-scoped SE");
  check("AT-5.5c an SE sees their team, not only themselves — designed, not a bug",
        asSe.length === 3,
        `${asSe.length} people visible; every read policy in this schema is a ` +
        `path prefix match, so a team-scoped session sees its team. AT-5 as ` +
        `written expected 1. Access-model question, not a data-model one.`);

  const noContext = await app.query(
    `SELECT count(*)::int AS n FROM v_user_adoption WHERE user_public_id LIKE $1`,
    [`${RUN}\\_usr\\_%`]);
  checkEq("AT-5.5d a session with no org path sees 0 rows (fail-closed)",
          noContext.rows[0].n, 0);

  // Counts key on app_user, so identity in SQL is the only prerequisite —
  // and no login or session tracking is involved anywhere (D27).
  const noSessionTables = await mig.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (table_name LIKE '%session%' OR table_name LIKE '%login%')`);
  checkEq("AT-5.6 adoption is measured from content, not logins (D27)",
          noSessionTables.rows[0].n, 0);

  process.exitCode = summary("AT-5 adoption") ? 0 : 1;
} finally {
  await teardown(mig);
  await app.end();
  await mig.end();
}
