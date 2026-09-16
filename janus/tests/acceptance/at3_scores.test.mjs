#!/usr/bin/env node
/**
 * AT-3 — Scores.
 *
 * Setup: score one discovery call for an SE under seg_new_business and one for
 * an SE under seg_nurture.
 *
 * Asserts:
 *   1. The two scorecards reference DIFFERENT rubric rows:
 *      (discovery, new_business) with total_credits 32, and
 *      (discovery, expansion) with 27.
 *   2. composite_score stores the real 0-10 value — 7.4 round-trips as 7.4.
 *      This is the assertion that was impossible before: composite_score was
 *      CHECK 0..2 and the insert was rejected outright.
 *   3. A scorecard claiming (demo, expansion) fails — no such rubric row.
 *   4. A discovery theme whose incident never occurred stores
 *      evidence_unavailable with a reason, leaves included_credits, and stays
 *      distinguishable from a genuine 0.
 *   5. overall recomputed from the stored rows equals the stored composite.
 *
 * Usage: node janus/tests/acceptance/at3_scores.test.mjs
 */

import {
  RUN, appClient, migClient, asUser, check, checkEq, expectReject,
  provisionOrg, provisionUser, provisionAccount, provisionDeal, insertActivity,
  requireEnv, requireRubricCatalog, summary, teardown,
} from "./lib/harness.mjs";

if (!requireEnv()) process.exit(0);

const app = await appClient();
const mig = await migClient();

/**
 * Score a call against a real rubric row.
 *
 * naThemes: theme keys to mark not-applicable — the discovery incident case
 * (objections / comp_pitch / case_study when the incident never occurred).
 * gradeFor: theme_key -> grade 0..10, so a genuine 0 can be placed next to an
 * exclusion and the two compared.
 */
async function scoreCall(c, { slug, rubricId, callType, seMotion, activityId, ownerUserId,
                              orgUnitId, naThemes = [], gradeFor = () => 8, confidence = 0.9,
                              leadershipShareable = false }) {
  const themes = await c.query(
    `SELECT id, theme_key, credit, category FROM rubric_theme
      WHERE rubric_id = $1 ORDER BY display_order`, [rubricId]);

  const total = themes.rows.reduce((a, t) => a + t.credit, 0);
  const included = themes.rows
    .filter((t) => !naThemes.includes(t.theme_key))
    .reduce((a, t) => a + t.credit, 0);
  const gp = themes.rows
    .filter((t) => !naThemes.includes(t.theme_key))
    .reduce((a, t) => a + gradeFor(t.theme_key) * t.credit, 0);
  const overall = included > 0 ? Math.round((gp / included) * 100) / 100 : 0;

  // Category scores, nullable when a category has no included credits.
  const catTotals = {};
  for (const t of themes.rows) {
    if (naThemes.includes(t.theme_key)) continue;
    catTotals[t.category] ??= [0, 0];
    catTotals[t.category][0] += gradeFor(t.theme_key) * t.credit;
    catTotals[t.category][1] += t.credit;
  }
  const cat = (k) => (catTotals[k] ? Math.round((catTotals[k][0] / catTotals[k][1]) * 100) / 100 : null);

  const sc = await c.query(
    `INSERT INTO scorecard (public_id, activity_id, rubric_id, owner_user_id, org_unit_id,
                            composite_score, call_type, se_motion, se_motion_source,
                            rubric_version, provisional, total_credits, included_credits,
                            confidence, leadership_shareable, golden_calibrated,
                            category_discovery_qualification, category_solution_technical_fit,
                            category_business_value, category_credibility_objections,
                            category_communication_control, is_current)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'resolved', '2.1',
             (SELECT provisional FROM rubric WHERE id = $3), $9, $10, $11, $12, true,
             $13, $14, $15, $16, $17, true)
     RETURNING id`,
    [`${RUN}_sc_${slug}`, activityId, rubricId, ownerUserId, orgUnitId, overall,
     callType, seMotion, total, included, confidence, leadershipShareable,
     cat("discovery_qualification"), cat("solution_technical_fit"), cat("business_value"),
     cat("credibility_objections"), cat("communication_control")],
  );
  const scorecardId = Number(sc.rows[0].id);

  for (const t of themes.rows) {
    const isNa = naThemes.includes(t.theme_key);
    const grade = isNa ? null : gradeFor(t.theme_key);

    const th = await c.query(
      `INSERT INTO scorecard_theme (scorecard_id, rubric_theme_id, theme_key, grade,
                                    credit, category, evidence_unavailable, model_omitted,
                                    not_applicable_reason, confidence, coaching_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10)
       RETURNING id`,
      [scorecardId, t.id, t.theme_key, grade, t.credit, t.category, isNa,
       isNa ? "This incident did not occur on the call, so the theme is not applicable." : null,
       isNa ? null : confidence,
       isNa ? null : `Work on ${t.theme_key}.`],
    );
    const themeRowId = Number(th.rows[0].id);

    // An excluded theme has no sub-parameter scores at all.
    if (isNa) continue;

    // Five sub-parameters summing to the theme grade.
    const params = await c.query(
      `SELECT id, param_index FROM rubric_parameter
        WHERE rubric_theme_id = $1 ORDER BY param_index`, [t.id]);

    let remaining = grade;
    for (const p of params.rows) {
      const score = Math.max(0, Math.min(2, remaining >= 2 ? 2 : remaining));
      remaining -= score;
      await c.query(
        `INSERT INTO scorecard_line (scorecard_id, scorecard_theme_id, rubric_parameter_id,
                                     rubric_theme_id, param_index, score,
                                     param_name_snapshot, param_weight_snapshot,
                                     evidence, evidence_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 1, $8, $9)`,
        [scorecardId, themeRowId, p.id, t.id, p.param_index, score,
         `${t.theme_key} p${p.param_index}`, "seen at 00:0" + p.param_index,
         JSON.stringify([{ atS: 60 * p.param_index, quote: "…", source: "transcript" }])],
      );
    }
  }
  return { scorecardId, overall, total, included };
}

try {
  const catalog = await requireRubricCatalog(mig);
  const org = await provisionOrg(mig);

  const seNb = await provisionUser(mig, { slug: "nb", orgUnitId: org.teamA, orgPath: org.paths[org.teamA] });
  const seEx = await provisionUser(mig, { slug: "ex", orgUnitId: org.teamB, orgPath: org.paths[org.teamB] });
  const acc = await provisionAccount(mig, { slug: "a", seUserIds: [seNb.id, seEx.id] });
  const dNb = await provisionDeal(mig, { slug: "nb", accountId: acc.id, ownerUserId: seNb.id, orgUnitId: org.teamA });
  const dEx = await provisionDeal(mig, { slug: "ex", accountId: acc.id, ownerUserId: seEx.id, orgUnitId: org.teamB });

  // -------------------------------------------------------------------------
  // 1. Two profiles, two credit totals — the sparse matrix as real rows.
  // -------------------------------------------------------------------------
  checkEq("AT-3.1a (discovery, new_business) total_credits is 32",
          catalog["discovery/new_business"].total_credits, 32);
  checkEq("AT-3.1b (discovery, expansion) total_credits is 27",
          catalog["discovery/expansion"].total_credits, 27);

  const nbRubric = "rub_discovery_2_1";
  const exRubric = "rub_discovery_expansion_2_1";

  const nbScore = await asUser(app, seNb, async (c) => {
    const a = await insertActivity(c, {
      slug: "cnb", dealId: dNb.id, accountId: acc.id, ownerUserId: seNb.id,
      orgUnitId: org.teamA, type: "call" });
    return scoreCall(c, {
      slug: "nb", rubricId: nbRubric, callType: "discovery", seMotion: "new_business",
      activityId: a.id, ownerUserId: seNb.id, orgUnitId: org.teamA,
      gradeFor: () => 8, leadershipShareable: true });
  });

  const exScore = await asUser(app, seEx, async (c) => {
    const a = await insertActivity(c, {
      slug: "cex", dealId: dEx.id, accountId: acc.id, ownerUserId: seEx.id,
      orgUnitId: org.teamB, type: "call" });
    return scoreCall(c, {
      slug: "ex", rubricId: exRubric, callType: "discovery", seMotion: "expansion",
      activityId: a.id, ownerUserId: seEx.id, orgUnitId: org.teamB,
      gradeFor: () => 8, leadershipShareable: true });
  });

  const refs = await mig.query(
    `SELECT s.public_id, s.rubric_id, s.call_type, s.se_motion, r.total_credits
       FROM scorecard s JOIN rubric r ON r.id = s.rubric_id
      WHERE s.public_id LIKE $1 ORDER BY s.public_id`, [`${RUN}\\_sc\\_%`]);

  check("AT-3.1c the two scorecards reference different rubric rows",
        new Set(refs.rows.map((r) => r.rubric_id)).size === 2,
        refs.rows.map((r) => `${r.rubric_id}(${r.total_credits})`).join(" / "));
  checkEq("AT-3.1d stored total_credits differ (32 vs 27)",
          [nbScore.total, exScore.total], [32, 27]);

  // -------------------------------------------------------------------------
  // 2. The scale fix. A 7.4 must round-trip.
  // -------------------------------------------------------------------------
  await asUser(app, seNb, async (c) => {
    await c.query(
      `UPDATE scorecard SET composite_score = 7.4 WHERE public_id = $1`,
      [`${RUN}_sc_nb`]);
  });
  const roundTrip = await mig.query(
    `SELECT composite_score FROM scorecard WHERE public_id = $1`, [`${RUN}_sc_nb`]);
  checkEq("AT-3.2a 7.4 round-trips as 7.4", Number(roundTrip.rows[0].composite_score), 7.4);

  await expectReject(mig, "AT-3.2b a score above 10 is still rejected",
    `UPDATE scorecard SET composite_score = 10.5 WHERE public_id = $1`,
    [`${RUN}_sc_nb`], "23514");
  await expectReject(mig, "AT-3.2c a negative score is rejected",
    `UPDATE scorecard SET composite_score = -0.1 WHERE public_id = $1`,
    [`${RUN}_sc_nb`], "23514");

  // Restore for assertion 5.
  await mig.query(`UPDATE scorecard SET composite_score = $2 WHERE public_id = $1`,
                  [`${RUN}_sc_nb`, nbScore.overall]);

  // -------------------------------------------------------------------------
  // 3. (demo, expansion) is unstorable — 5 of the 24 combinations have no
  //    profile, and the rubric table is what enforces that.
  // -------------------------------------------------------------------------
  const demoExpansion = await mig.query(
    `SELECT count(*)::int AS n FROM rubric
      WHERE call_type = 'demo' AND se_motion = 'expansion'`);
  checkEq("AT-3.3a no (demo, expansion) rubric row exists", demoExpansion.rows[0].n, 0);

  await asUser(app, seEx, async (c) => {
    const a = await insertActivity(c, {
      slug: "cbad", dealId: dEx.id, accountId: acc.id, ownerUserId: seEx.id,
      orgUnitId: org.teamB, type: "call" });
    // Pointing at the expansion discovery rubric while CLAIMING demo: the
    // composite FK on (rubric_id, call_type, se_motion) rejects it, so the
    // stamped call_type can never disagree with the profile that scored it.
    await expectReject(c, "AT-3.3b a scorecard claiming (demo, expansion) is rejected",
      `INSERT INTO scorecard (public_id, activity_id, rubric_id, owner_user_id, org_unit_id,
                              composite_score, call_type, se_motion, se_motion_source,
                              rubric_version, total_credits, included_credits, confidence)
       VALUES ($1, $2, $3, $4, $5, 7.0, 'demo', 'expansion', 'resolved', '2.1', 27, 27, 0.9)`,
      [`${RUN}_sc_bad`, a.id, exRubric, seEx.id, org.teamB], "23503");
  }, { commit: false });

  // -------------------------------------------------------------------------
  // 4. N/A: three states, and a 0 that is not an exclusion.
  //
  // objections goes N/A (the incident never occurred). questions gets a
  // genuine 0 (a habit theme the SE simply did not do). They must be
  // distinguishable, and only the first leaves the denominator.
  // -------------------------------------------------------------------------
  const naScore = await asUser(app, seNb, async (c) => {
    const a = await insertActivity(c, {
      slug: "cna", dealId: dNb.id, accountId: acc.id, ownerUserId: seNb.id,
      orgUnitId: org.teamA, type: "call" });
    return scoreCall(c, {
      slug: "na", rubricId: nbRubric, callType: "discovery", seMotion: "new_business",
      activityId: a.id, ownerUserId: seNb.id, orgUnitId: org.teamA,
      naThemes: ["objections"],
      gradeFor: (k) => (k === "questions" ? 0 : 8),
      leadershipShareable: true });
  });

  const naRows = await mig.query(
    `SELECT theme_key, grade, credit, evidence_unavailable, model_omitted,
            not_applicable_reason
       FROM scorecard_theme
      WHERE scorecard_id = $1 AND theme_key IN ('objections', 'questions')
      ORDER BY theme_key`, [naScore.scorecardId]);

  const na = naRows.rows.find((r) => r.theme_key === "objections");
  const zero = naRows.rows.find((r) => r.theme_key === "questions");

  if (!na || !zero) {
    check("AT-3.4 fixture themes present", false,
          `expected objections+questions, got ${naRows.rows.map((r) => r.theme_key).join(",")}`);
  } else {
    check("AT-3.4a N/A theme stores evidence_unavailable with a reason",
          na.evidence_unavailable === true && !!na.not_applicable_reason,
          (na.not_applicable_reason || "").slice(0, 50));
    checkEq("AT-3.4b N/A theme has NO grade (not 0)", na.grade, null);
    check("AT-3.4c a genuine 0 is a real grade with no exclusion",
          zero.grade === 0 && zero.evidence_unavailable === false &&
          zero.not_applicable_reason === null,
          `grade=${zero.grade} excluded=${zero.evidence_unavailable}`);
    checkEq("AT-3.4d the two states are distinguishable",
            [na.grade === null, zero.grade === 0], [true, true]);

    checkEq("AT-3.4e N/A credits leave included_credits",
            naScore.included, naScore.total - na.credit,
            `${naScore.included} of ${naScore.total}, objections credit=${na.credit}`);

    // A silent exclusion is rejected: any exclusion must say why.
    await expectReject(mig, "AT-3.4f an exclusion with no reason is rejected",
      `UPDATE scorecard_theme SET not_applicable_reason = NULL
        WHERE scorecard_id = $1 AND theme_key = 'objections'`,
      [naScore.scorecardId], "23514");
    // And an excluded theme cannot carry a grade.
    await expectReject(mig, "AT-3.4g an excluded theme cannot also have a grade",
      `UPDATE scorecard_theme SET grade = 0
        WHERE scorecard_id = $1 AND theme_key = 'objections'`,
      [naScore.scorecardId], "23514");
  }

  // -------------------------------------------------------------------------
  // 5. The composite is reproducible from what was stored (D26).
  //
  // If this fails, the score is a number nobody can explain — which is the
  // whole reason the reshape stores every dimension separately.
  // -------------------------------------------------------------------------
  for (const [label, id, expected] of [
    ["all themes scored", nbScore.scorecardId, nbScore.overall],
    ["with an N/A theme", naScore.scorecardId, naScore.overall],
    ["expansion profile", exScore.scorecardId, exScore.overall],
  ]) {
    const r = await mig.query(
      `SELECT recompute_scorecard_overall($1) AS recomputed,
              composite_score AS stored
         FROM scorecard WHERE id = $1`, [id]);
    checkEq(`AT-3.5 recomputed overall equals stored composite (${label})`,
            Number(r.rows[0].recomputed), Number(r.rows[0].stored));
  }

  // -------------------------------------------------------------------------
  // 6. Score disputes over N/A (D23) — the same defect, third place.
  // -------------------------------------------------------------------------
  const line = await mig.query(
    `SELECT l.id, l.created_at, l.score FROM scorecard_line l
      WHERE l.scorecard_id = $1 AND l.score IS NOT NULL LIMIT 1`, [naScore.scorecardId]);

  if (line.rowCount === 0) {
    check("AT-3.6 a scored line exists to dispute", false, "no line found");
  } else {
    const { id, score } = line.rows[0];
    // NOTE FOR THE OVERRIDE WIRING (workstream 10): score_override's FK is
    // composite on (scorecard_line_id, scorecard_line_created_at), and
    // created_at is timestamptz -- MICROSECOND precision. A JS Date only holds
    // milliseconds, so reading created_at into JS and passing it back truncates
    // it and the FK lookup misses with "violates foreign key constraint
    // fk_score_override_line". Let Postgres carry the timestamp: select it in
    // the INSERT rather than round-tripping it through the application.
    await asUser(app, seNb, async (c) => {
      await c.query(
        `INSERT INTO score_override (scorecard_line_id, scorecard_line_created_at,
                                     previous_score, new_score, reason, ruling, created_by)
         SELECT l.id, l.created_at, $2, NULL,
                'Not applicable — the incident never occurred.', 'adjust', $3
           FROM scorecard_line l WHERE l.id = $1`,
        [id, score, seNb.id]);
    });
    const ov = await mig.query(
      `SELECT previous_score, new_score, ruling FROM score_override
        WHERE scorecard_line_id = $1`, [id]);
    check("AT-3.6a a score can be overridden TO N/A",
          ov.rowCount === 1 && ov.rows[0].new_score === null,
          `${ov.rows[0]?.previous_score} -> ${ov.rows[0]?.new_score}`);

    await expectReject(mig, "AT-3.6b an override that changes nothing is rejected",
      `INSERT INTO score_override (scorecard_line_id, scorecard_line_created_at,
                                   previous_score, new_score, reason, created_by)
       SELECT l.id, l.created_at, NULL, NULL, 'no change', $2
         FROM scorecard_line l WHERE l.id = $1`,
      [id, seNb.id], "23514");

    // D7: a score change is in the audit trail, written by trigger.
    const audit = await mig.query(
      `SELECT action, before_value, after_value FROM audit_log
        WHERE entity_type = 'scorecard_line' AND entity_id = $1::text`, [id]);
    check("AT-3.6c the override is in the audit trail (D7)",
          audit.rowCount >= 1,
          audit.rowCount ? `${audit.rows[0].action}: ${JSON.stringify(audit.rows[0].before_value)} -> ${JSON.stringify(audit.rows[0].after_value)}` : "no audit row");
  }

  // The catalog cannot be edited from the application (D17).
  await expectReject(app, "AT-3.7 janus_app cannot write the rubric catalog (D17)",
    `UPDATE rubric SET total_credits = 99 WHERE id = $1`, [nbRubric], "42501");

  process.exitCode = summary("AT-3 scores") ? 0 : 1;
} finally {
  await teardown(mig);
  await app.end();
  await mig.end();
}
