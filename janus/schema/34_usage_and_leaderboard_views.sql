-- ============================================================================
-- Janus Data Model - Phase J: score leaderboard read model
--
-- Score leaderboard by segment (new_business / expansion). Built on the
-- existing v_scorecard_rankable (22_scoring_reshape.sql) rather than
-- re-deriving its eligibility rules (current, non-provisional, confidence
-- >= 0.7, leadership cap on read).
--
-- Daily SE usage (pre_call/post_call counts, logins) is NOT duplicated here
-- -- 33_user_usage.sql already covers that more completely (real per-login
-- tracking via user_usage_logins, plus AI cost/tokens/avg_score in
-- user_usage_daily), so a competing view here would just be a second,
-- inconsistent source of truth for the same numbers.
--
-- As of this migration, v_scorecard_rankable has rows for exactly 2 calls
-- (both 2026-09-03) -- every real call since has 0 rows in `scorecard`,
-- because linkPostCallToLifecycle (web/domain/dual-write.js) has been
-- failing silently for every user. The leaderboard view will run correctly
-- but rank almost nobody until that fix lands (see logging added in this
-- same change to engagement-entities.js / dual-write.js / app.js) and real
-- calls start getting scored again.
--
-- Idempotent. Run after 33_user_usage.sql.
-- ============================================================================

CREATE OR REPLACE VIEW v_se_score_leaderboard WITH (security_invoker = true) AS
SELECT
    r.se_motion,
    r.owner_user_id                          AS user_id,
    u.public_id                              AS user_public_id,
    u.display_name,
    u.email,
    r.org_unit_id,
    r.org_path,
    count(*)                                  AS scored_calls,
    avg(r.display_score)                      AS avg_score,
    max(r.display_score)                      AS best_score,
    max(r.created_at)                         AS last_scored_at,
    rank() OVER (
        PARTITION BY r.se_motion
        ORDER BY avg(r.display_score) DESC
    )                                          AS rank_in_segment
FROM v_scorecard_rankable r
JOIN app_user u ON u.id = r.owner_user_id
GROUP BY r.se_motion, r.owner_user_id, u.public_id, u.display_name, u.email,
         r.org_unit_id, r.org_path;

COMMENT ON VIEW v_se_score_leaderboard IS
    'SE ranking within each segment (new_business / expansion), built on the '
    'existing v_scorecard_rankable eligibility rules. Slice by org_path prefix '
    'for a team/org-scoped leaderboard instead of the whole company. Consider '
    'adding a minimum scored_calls threshold (e.g. HAVING count(*) >= 3) at the '
    'call site if a single lucky score ranking someone #1 is a concern -- not '
    'baked in here since there is no existing team rule for that yet.';

GRANT SELECT ON v_se_score_leaderboard TO janus_app, janus_readonly;
