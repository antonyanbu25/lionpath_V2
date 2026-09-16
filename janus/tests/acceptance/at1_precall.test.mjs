#!/usr/bin/env node
/**
 * AT-1 — Pre-call briefs.
 *
 * Setup: two SEs on different teams. SE-A creates two prep briefs on deal D1,
 * SE-B creates one on deal D2. Then attempt a third brief for SE-A with NO
 * dealId.
 *
 * Asserts:
 *   1. The deal-less attempt fails loudly and writes no pre_call row (D24).
 *   2. Briefs for D1 return exactly 2, newest first, with research_brief and
 *      input_snapshot populated.
 *   3. As SE-B, a read scoped to D1 returns 0 rows (RLS).
 *   4. pre_call row count equals the meeting activities the flow created.
 *
 * Usage: node janus/tests/acceptance/at1_precall.test.mjs
 */

import {
  RUN, appClient, migClient, asUser, asUserExpectingError, check, checkEq,
  provisionOrg, provisionUser, provisionAccount, provisionDeal, insertActivity,
  requireEnv, summary, teardown,
} from "./lib/harness.mjs";

if (!requireEnv()) process.exit(0);

const app = await appClient();
const mig = await migClient();

try {
  const org = await provisionOrg(mig);
  const seA = await provisionUser(mig, { slug: "a", orgUnitId: org.teamA, orgPath: org.paths[org.teamA] });
  const seB = await provisionUser(mig, { slug: "b", orgUnitId: org.teamB, orgPath: org.paths[org.teamB] });

  const accA = await provisionAccount(mig, { slug: "a", seUserIds: [seA.id] });
  const accB = await provisionAccount(mig, { slug: "b", seUserIds: [seB.id] });
  const d1 = await provisionDeal(mig, { slug: "d1", accountId: accA.id, ownerUserId: seA.id, orgUnitId: org.teamA });
  const d2 = await provisionDeal(mig, { slug: "d2", accountId: accB.id, ownerUserId: seB.id, orgUnitId: org.teamB });

  // -------------------------------------------------------------------------
  // Two briefs on D1, as SE-A. Each brief mints its own activity, which is
  // exactly the behaviour assertion 4 measures.
  // -------------------------------------------------------------------------
  await asUser(app, seA, async (c) => {
    for (const [i, slug] of ["p1", "p2"].entries()) {
      const act = await insertActivity(c, {
        slug, dealId: d1.id, accountId: accA.id, ownerUserId: seA.id,
        orgUnitId: org.teamA, type: "meeting",
        occurredAt: new Date(Date.now() - (2 - i) * 3600_000).toISOString(),
      });
      await c.query(
        `INSERT INTO pre_call (public_id, idempotency_key, activity_id,
                               research_brief, input_snapshot, generated_at)
         VALUES ($1, $1, $2, $3, $4, now())`,
        [`${RUN}_pre_${slug}`, act.id,
         JSON.stringify({ company: "Northwind", summary: `brief ${slug}` }),
         JSON.stringify({ domain: "northwind.test", additionalContext: null })],
      );
    }
  });

  // One brief on D2, as SE-B.
  await asUser(app, seB, async (c) => {
    const act = await insertActivity(c, {
      slug: "p3", dealId: d2.id, accountId: accB.id, ownerUserId: seB.id,
      orgUnitId: org.teamB, type: "meeting",
    });
    await c.query(
      `INSERT INTO pre_call (public_id, idempotency_key, activity_id,
                             research_brief, input_snapshot, generated_at)
       VALUES ($1, $1, $2, '{"company":"Contoso"}'::jsonb, '{}'::jsonb, now())`,
      [`${RUN}_pre_p3`, act.id],
    );
  });

  // -------------------------------------------------------------------------
  // 1. A brief with no deal must fail loudly and leave nothing behind.
  //
  // Enforced by trg_pre_call_deal_required (29_precall_deal_required.sql).
  // Before that trigger the insert SUCCEEDED and produced a row the only read
  // path could never return, because it inner-joins deal.
  // -------------------------------------------------------------------------
  const err = await asUserExpectingError(app, seA, async (c) => {
    const act = await insertActivity(c, {
      slug: "nodeal", dealId: null, accountId: accA.id, ownerUserId: seA.id,
      orgUnitId: org.teamA, type: "meeting",
    });
    await c.query(
      `INSERT INTO pre_call (public_id, idempotency_key, activity_id, research_brief)
       VALUES ($1, $1, $2, '{"company":"Ghost"}'::jsonb)`,
      [`${RUN}_pre_nodeal`, act.id],
    );
  });

  check("AT-1.1a deal-less brief is rejected", err !== null,
        err ? `${err.code}: ${err.message.split("\n")[0].slice(0, 90)}` : "insert succeeded");

  const orphan = await mig.query(
    `SELECT count(*)::int AS n FROM pre_call WHERE public_id = $1`, [`${RUN}_pre_nodeal`]);
  checkEq("AT-1.1b no pre_call row was written", orphan.rows[0].n, 0);

  // -------------------------------------------------------------------------
  // 2. Briefs for D1: exactly two, newest first, payloads intact.
  // -------------------------------------------------------------------------
  const listed = await asUser(app, seA, async (c) => {
    const r = await c.query(
      `SELECT public_id, research_brief, input_snapshot, occurred_at
         FROM v_pre_call_brief
        WHERE deal_public_id = $1
        ORDER BY occurred_at DESC`,
      [d1.publicId],
    );
    return r.rows;
  });

  checkEq("AT-1.2a exactly 2 briefs for D1", listed.length, 2);
  check("AT-1.2b newest first",
        listed.length === 2 && listed[0].public_id === `${RUN}_pre_p2`,
        listed.map((r) => r.public_id).join(" -> "));
  check("AT-1.2c research_brief and input_snapshot populated",
        listed.every((r) => r.research_brief && r.input_snapshot &&
                            typeof r.research_brief.company === "string"),
        listed.map((r) => JSON.stringify(r.research_brief).slice(0, 30)).join(", "));

  // -------------------------------------------------------------------------
  // 3. RLS: SE-B, on a different team, sees none of D1's briefs.
  //
  // The path prefix is what does this: /org/seg_nb/team_a/ does not start
  // with /org/seg_nurture/team_b/.
  // -------------------------------------------------------------------------
  const crossTeam = await asUser(app, seB, async (c) => {
    const r = await c.query(
      `SELECT count(*)::int AS n FROM v_pre_call_brief WHERE deal_public_id = $1`,
      [d1.publicId],
    );
    return r.rows[0].n;
  });
  checkEq("AT-1.3 SE-B reads 0 of SE-A's briefs (RLS)", crossTeam, 0);

  // A session with no org path set must also see nothing -- the fail-closed
  // behaviour 08_rls_hardening.sql exists to guarantee.
  const noContext = await app.query(
    `SELECT count(*)::int AS n FROM v_pre_call_brief WHERE deal_public_id = $1`,
    [d1.publicId],
  );
  checkEq("AT-1.3b session with no org path sees 0 rows (fail-closed)", noContext.rows[0].n, 0);

  // -------------------------------------------------------------------------
  // 4. pre_call count equals the meeting activities the flow created.
  //
  // This passes and is a warning, not a reassurance: it passes BECAUSE each
  // brief mints its own meeting activity, so any meetings-held metric counts
  // prep. Recorded on pre_call.activity_id in 29_precall_deal_required.sql.
  // -------------------------------------------------------------------------
  const counts = await mig.query(
    `SELECT (SELECT count(*)::int FROM pre_call WHERE public_id LIKE $1)     AS briefs,
            (SELECT count(*)::int FROM activity
              WHERE public_id LIKE $1 AND activity_type = 'meeting'
                AND deal_id IS NOT NULL)                                     AS meetings`,
    [`${RUN}\\_%`],
  );
  checkEq("AT-1.4 pre_call count equals meeting activities created",
          counts.rows[0].briefs, counts.rows[0].meetings,
          `${counts.rows[0].briefs} briefs / ${counts.rows[0].meetings} meetings — inflation confirmed by design`);

  // Owner-only write, recorded because it is a live open question: a manager
  // cannot create or edit a brief for an SE; only admin can.
  const mgr = await provisionUser(mig, {
    slug: "mgr", orgUnitId: org.segNb, orgPath: org.paths[org.segNb],
    role: "manager", jobTitle: "Senior Manager - Solution Engineering",
  });
  const mgrErr = await asUserExpectingError(app, mgr, async (c) => {
    await insertActivity(c, {
      slug: "mgrbrief", dealId: d1.id, accountId: accA.id,
      ownerUserId: seA.id, orgUnitId: org.teamA, type: "meeting",
    });
  });
  check("AT-1.5 manager cannot create a brief for an SE (owner-only write)",
        mgrErr !== null,
        mgrErr ? "confirmed — 14_rls_owner_write_calls.sql, open question 3" : "manager write SUCCEEDED");

  const level = await mig.query(
    `SELECT job_level FROM app_user WHERE public_id = $1`, [mgr.publicId]);
  checkEq("AT-1.6 job_level derived from title, not defaulted to IC",
          level.rows[0].job_level, "manager");

  process.exitCode = summary("AT-1 pre-call") ? 0 : 1;
} finally {
  await teardown(mig);
  await app.end();
  await mig.end();
}
