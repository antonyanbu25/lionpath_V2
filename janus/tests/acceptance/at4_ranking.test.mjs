#!/usr/bin/env node
/**
 * AT-4 — Ranking.
 *
 * Setup: four SEs across two segments.
 *   SE-1  high, on a LIVE profile                        -> rankable
 *   SE-2  higher, but on a PROVISIONAL profile           -> excluded
 *   SE-3  mid, confidence 0.40 (no longer a rule)        -> rankable
 *   SE-4  mid, fully valid                                -> rankable
 *
 * The confidence >= 0.7 threshold that used to exclude SE-3 was removed by
 * request (rankability now depends only on is_current, non-provisional, and
 * having a score) -- see 22_scoring_reshape.sql's v_scorecard_rankable.
 *
 * Asserts:
 *   1. Ranking returns SE-1, SE-4, SE-3 (SE-2 still excluded, provisional).
 *   2. Rankable per (call_type, se_motion) AND combined, from the same rows.
 *   3. Rankable by team, segment and org via one org_unit.path prefix match.
 *   4. A score above 8.0 without leadership_shareable reports the CAPPED value
 *      where the cap applies, and the raw value stays recoverable.
 *
 * A naive ORDER BY avg(composite_score) would still be wrong on the
 * provisional-exclusion count, which is why that rule lives in
 * v_scorecard_rankable and not in each report.
 *
 * Usage: node janus/tests/acceptance/at4_ranking.test.mjs
 */

import {
  RUN, appClient, migClient, asUser, check, checkEq,
  provisionOrg, provisionUser, provisionAccount, provisionDeal, insertActivity,
  requireEnv, requireRubricCatalog, summary, teardown,
} from "./lib/harness.mjs";

if (!requireEnv()) process.exit(0);

const app = await appClient();
const mig = await migClient();

const HIGH_CONFIDENCE_THRESHOLD = 0.7;
const LEADERSHIP_CAP = 8.0;

/** Minimal scorecard — ranking reads the header, not the theme rows. */
async function putScorecard(c, { slug, activityId, rubricId, callType, seMotion, ownerUserId,
                                 orgUnitId, overall, confidence, leadershipShareable = true }) {
  const r = await c.query(
    `INSERT INTO scorecard (public_id, activity_id, rubric_id, owner_user_id, org_unit_id,
                            composite_score, call_type, se_motion, se_motion_source,
                            rubric_version, provisional, total_credits, included_credits,
                            confidence, leadership_shareable, is_current)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'resolved', '2.1',
             (SELECT provisional FROM rubric WHERE id = $3),
             (SELECT total_credits FROM rubric WHERE id = $3),
             (SELECT total_credits FROM rubric WHERE id = $3),
             $9, $10, true)
     RETURNING id, provisional`,
    [`${RUN}_sc_${slug}`, activityId, rubricId, ownerUserId, orgUnitId, overall,
     callType, seMotion, confidence, leadershipShareable],
  );
  return r.rows[0];
}

try {
  await requireRubricCatalog(mig);
  const org = await provisionOrg(mig);

  // A director at the org level, so the ranking reader can see all four SEs.
  // Path prefix /org/ starts every subtree.
  const director = await provisionUser(mig, {
    slug: "dir", orgUnitId: org.org, orgPath: org.paths[org.org],
    role: "manager", jobTitle: "Senior Director - Solution Engineering" });

  const se1 = await provisionUser(mig, { slug: "s1", orgUnitId: org.teamA, orgPath: org.paths[org.teamA] });
  const se2 = await provisionUser(mig, { slug: "s2", orgUnitId: org.teamB, orgPath: org.paths[org.teamB] });
  const se3 = await provisionUser(mig, { slug: "s3", orgUnitId: org.teamA, orgPath: org.paths[org.teamA] });
  const se4 = await provisionUser(mig, { slug: "s4", orgUnitId: org.teamA, orgPath: org.paths[org.teamA] });

  const acc = await provisionAccount(mig, { slug: "a", seUserIds: [se1.id, se2.id] });

  const spec = [
    // slug, user,  team,       rubric,                        callType,    motion,        overall, confidence
    ["s1", se1, org.teamA, "rub_discovery_2_1",            "discovery", "new_business", 7.8, 0.92],
    ["s2", se2, org.teamB, "rub_discovery_expansion_2_1",  "discovery", "expansion",    9.1, 0.95],
    ["s3", se3, org.teamA, "rub_discovery_2_1",            "discovery", "new_business", 6.0, 0.40],
    ["s4", se4, org.teamA, "rub_demo_2_1",                 "demo",      "new_business", 6.5, 0.88],
  ];

  const created = {};
  for (const [slug, user, team, rubric, callType, motion, overall, confidence] of spec) {
    const deal = await provisionDeal(mig, {
      slug, accountId: acc.id, ownerUserId: user.id, orgUnitId: team });
    created[slug] = await asUser(app, user, async (c) => {
      const a = await insertActivity(c, {
        slug, dealId: deal.id, accountId: acc.id, ownerUserId: user.id,
        orgUnitId: team, type: "call" });
      return putScorecard(c, {
        slug, activityId: a.id, rubricId: rubric, callType, seMotion: motion,
        ownerUserId: user.id, orgUnitId: team, overall, confidence });
    });
  }

  // Sanity: provisional was copied from the rubric, not asserted by the test.
  checkEq("AT-4.0a SE-1's profile is live", created.s1.provisional, false);
  checkEq("AT-4.0b SE-2's profile is provisional (shadow mode)", created.s2.provisional, true);
  checkEq("AT-4.0c SE-4's profile is live", created.s4.provisional, false);

  // -------------------------------------------------------------------------
  // 1. SE-1 then SE-4 only.
  // -------------------------------------------------------------------------
  const ranked = await asUser(app, director, async (c) => {
    const r = await c.query(
      `SELECT u.public_id, v.composite_score, v.display_score
         FROM v_scorecard_rankable v
         JOIN app_user u ON u.id = v.owner_user_id
        WHERE u.public_id LIKE $1
        ORDER BY v.composite_score DESC`,
      [`${RUN}\\_usr\\_%`]);
    return r.rows;
  });

  checkEq("AT-4.1a ranking returns exactly 3 rows",
          ranked.length, 3, ranked.map((r) => `${r.public_id}=${r.composite_score}`).join(", "));
  checkEq("AT-4.1b order is SE-1, SE-4, SE-3",
          ranked.map((r) => r.public_id.replace(`${RUN}_usr_`, "")), ["s1", "s4", "s3"]);
  check("AT-4.1c SE-2 excluded despite the highest raw score (provisional)",
        !ranked.some((r) => r.public_id.endsWith("_s2")),
        "9.1 is the top raw score and correctly absent");
  check("AT-4.1d SE-3 IS rankable (confidence threshold removed)",
        ranked.some((r) => r.public_id.endsWith("_s3")),
        `confidence 0.40 no longer excludes -- HIGH_CONFIDENCE_THRESHOLD (${HIGH_CONFIDENCE_THRESHOLD}) is unused`);

  // The naive query, for contrast: it returns all four.
  const naive = await asUser(app, director, async (c) => {
    const r = await c.query(
      `SELECT count(*)::int AS n FROM scorecard s
         JOIN app_user u ON u.id = s.owner_user_id
        WHERE u.public_id LIKE $1`, [`${RUN}\\_usr\\_%`]);
    return r.rows[0].n;
  });
  checkEq("AT-4.1e the naive query would have returned all 4", naive, 4);

  // -------------------------------------------------------------------------
  // 2. Sliceable per (call_type, se_motion) and combined, same stored rows.
  // -------------------------------------------------------------------------
  const perProfile = await asUser(app, director, async (c) => {
    const r = await c.query(
      `SELECT call_type, se_motion, count(*)::int AS calls,
              round(avg(composite_score), 2) AS avg_score
         FROM v_scorecard_rankable v
         JOIN app_user u ON u.id = v.owner_user_id
        WHERE u.public_id LIKE $1
        GROUP BY call_type, se_motion
        ORDER BY call_type`, [`${RUN}\\_usr\\_%`]);
    return r.rows;
  });
  checkEq("AT-4.2a groups by (call_type, se_motion)",
          perProfile.map((r) => `${r.call_type}/${r.se_motion}`),
          ["demo/new_business", "discovery/new_business"]);

  const combined = await asUser(app, director, async (c) => {
    const r = await c.query(
      `SELECT count(*)::int AS calls, round(avg(composite_score), 2) AS avg_score
         FROM v_scorecard_rankable v
         JOIN app_user u ON u.id = v.owner_user_id
        WHERE u.public_id LIKE $1`, [`${RUN}\\_usr\\_%`]);
    return r.rows[0];
  });
  checkEq("AT-4.2b combined across profiles from the same rows",
          [combined.calls, Number(combined.avg_score)], [3, 6.77]);

  // -------------------------------------------------------------------------
  // 3. Team / segment / org, one path prefix each. No new structure.
  // -------------------------------------------------------------------------
  const byLevel = await asUser(app, director, async (c) => {
    const out = {};
    for (const [level, path] of [
      ["team_a", org.paths[org.teamA]],
      ["seg_nb", org.paths[org.segNb]],
      ["org", org.paths[org.org]],
    ]) {
      const r = await c.query(
        `SELECT count(*)::int AS n FROM v_scorecard_rankable v
           JOIN app_user u ON u.id = v.owner_user_id
          WHERE u.public_id LIKE $1 AND starts_with(v.org_path, $2)`,
        [`${RUN}\\_usr\\_%`, path]);
      out[level] = r.rows[0].n;
    }
    return out;
  });
  checkEq("AT-4.3a rankable by team via one prefix match", byLevel.team_a, 3);
  checkEq("AT-4.3b rankable by segment via one prefix match", byLevel.seg_nb, 3);
  checkEq("AT-4.3c rankable by org via one prefix match", byLevel.org, 3);

  // A team-scoped SE sees their own team only — the same prefix, narrower.
  const seScoped = await asUser(app, se2, async (c) => {
    const r = await c.query(
      `SELECT count(*)::int AS n FROM v_scorecard_rankable v
         JOIN app_user u ON u.id = v.owner_user_id
        WHERE u.public_id LIKE $1`, [`${RUN}\\_usr\\_%`]);
    return r.rows[0].n;
  });
  checkEq("AT-4.3d an SE on team_b sees no team_a scores (RLS)", seScoped, 0);

  // -------------------------------------------------------------------------
  // 4. The leadership cap: displayed capped, raw recoverable.
  // -------------------------------------------------------------------------
  const dealCap = await provisionDeal(mig, {
    slug: "cap", accountId: acc.id, ownerUserId: se1.id, orgUnitId: org.teamA });
  await asUser(app, se1, async (c) => {
    const a = await insertActivity(c, {
      slug: "cap", dealId: dealCap.id, accountId: acc.id, ownerUserId: se1.id,
      orgUnitId: org.teamA, type: "call" });
    // is_current is a partial unique index per activity, so this is a second
    // activity rather than a second scorecard on the same one.
    await putScorecard(c, {
      slug: "cap", activityId: a.id, rubricId: "rub_discovery_2_1",
      callType: "discovery", seMotion: "new_business", ownerUserId: se1.id,
      orgUnitId: org.teamA, overall: 9.3, confidence: 0.93,
      leadershipShareable: false });
  });

  const capped = await asUser(app, director, async (c) => {
    const r = await c.query(
      `SELECT composite_score, display_score, leadership_shareable
         FROM v_scorecard_rankable WHERE public_id = $1`, [`${RUN}_sc_cap`]);
    return r.rows[0];
  });

  check("AT-4.4a unverified score above 8.0 displays capped",
        Number(capped.display_score) === LEADERSHIP_CAP,
        `display=${capped.display_score}`);
  checkEq("AT-4.4b the raw value is still recoverable",
          Number(capped.composite_score), 9.3);
  check("AT-4.4c a verified score above 8.0 is NOT capped",
        Number((await mig.query(
          `SELECT display_score FROM v_scorecard_rankable WHERE public_id = $1`,
          [`${RUN}_sc_s1`])).rows[0].display_score) === 7.8,
        "leadership_shareable=true passes the raw value through");

  // The cap is applied on read and never stored — so raising or lowering the
  // threshold later cannot require rewriting history.
  const stored = await mig.query(
    `SELECT count(*)::int AS n FROM scorecard
      WHERE public_id LIKE $1 AND composite_score = 8.0`, [`${RUN}\\_sc\\_%`]);
  checkEq("AT-4.4d no row stores the capped 8.0 value", stored.rows[0].n, 0);

  // -------------------------------------------------------------------------
  // 5. What the launch reality is, recorded as an assertion so it cannot be
  //    forgotten: only 2 of the 19 v2.1 profiles are non-provisional.
  // -------------------------------------------------------------------------
  const live = await mig.query(
    `SELECT call_type, se_motion FROM rubric
      WHERE version = '2.1' AND NOT provisional ORDER BY call_type`);
  checkEq("AT-4.5 only demo/NB and discovery/NB are rankable at v2.1",
          live.rows.map((r) => `${r.call_type}/${r.se_motion}`),
          ["demo/new_business", "discovery/new_business"],
          "everything else is shadow mode until calibration promotes it");

  process.exitCode = summary("AT-4 ranking") ? 0 : 1;
} finally {
  await teardown(mig);
  await app.end();
  await mig.end();
}
