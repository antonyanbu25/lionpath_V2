-- ============================================================================
-- Janus Data Model - Phase A Extension: RLS Hardening (fail-closed)
-- Blocker 2: current_org_path() coalesces a missing app.org_unit_path setting
-- to '' which makes `ou.path LIKE '' || '%'` match EVERY org unit — a typo'd
-- or missing session variable silently grants universal read on RLS tables.
--
-- Fix: current_org_path() returns NULL when unset. `x LIKE NULL` evaluates to
-- NULL, which is not TRUE, so policy USING clauses deny the row. Policies are
-- additionally recreated with an explicit IS NOT NULL guard for clarity.
--
-- Session variable names (must match worker middleware exactly):
--   app.user_id        -> current_user_id()
--   app.org_unit_path  -> current_org_path()
--   app.is_admin       -> is_admin()
-- ============================================================================

-- Fail-closed helper: NULL when the setting is missing or empty.
CREATE OR REPLACE FUNCTION current_org_path() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT NULLIF(current_setting('app.org_unit_path', true), '');
$$;

-- current_user_id() already returns NULL when unset (NULLIF + cast), and
-- is_admin() already coalesces to false — both fail closed. No change needed.

-- ----------------------------------------------------------------------------
-- Recreate org-path read policies with explicit NULL guard.
-- (DROP + CREATE; PostgreSQL has no CREATE OR REPLACE POLICY.)
-- ----------------------------------------------------------------------------

-- deal (01_phase1_crm_core.sql)
DROP POLICY IF EXISTS deal_team_read ON deal;
CREATE POLICY deal_team_read ON deal
    FOR SELECT
    USING (
        is_admin() OR
        (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM org_unit ou
                WHERE ou.id = deal.org_unit_id
                  AND ou.path LIKE current_org_path() || '%'
            )
        )
    );

-- activity (02_phase2_activities.sql)
DROP POLICY IF EXISTS activity_team_read ON activity;
CREATE POLICY activity_team_read ON activity
    FOR SELECT
    USING (
        is_admin() OR
        (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM org_unit ou
                WHERE ou.id = activity.org_unit_id
                  AND ou.path LIKE current_org_path() || '%'
            )
        )
    );

-- scorecard (04_phase4_scoring_rubrics.sql)
DROP POLICY IF EXISTS scorecard_team_read ON scorecard;
CREATE POLICY scorecard_team_read ON scorecard
    FOR SELECT
    USING (
        is_admin() OR
        (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM org_unit ou
                WHERE ou.id = scorecard.org_unit_id
                  AND ou.path LIKE current_org_path() || '%'
            )
        )
    );

-- scorecard_line (04_phase4_scoring_rubrics.sql)
DROP POLICY IF EXISTS scorecard_line_read ON scorecard_line;
CREATE POLICY scorecard_line_read ON scorecard_line
    FOR SELECT
    USING (
        is_admin() OR
        (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM scorecard s
                JOIN org_unit ou ON ou.id = s.org_unit_id
                WHERE s.id = scorecard_line.scorecard_id
                  AND ou.path LIKE current_org_path() || '%'
            )
        )
    );

-- product_signal (05_phase5_product_coaching.sql)
DROP POLICY IF EXISTS product_signal_read ON product_signal;
CREATE POLICY product_signal_read ON product_signal
    FOR SELECT
    USING (
        is_admin() OR
        EXISTS (
            SELECT 1 FROM user_role ur
            JOIN app_role r ON r.id = ur.role_id
            WHERE ur.user_id = current_user_id() AND r.name = 'pm'
        ) OR
        (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM org_unit ou
                WHERE ou.id = product_signal.org_unit_id
                  AND ou.path LIKE current_org_path() || '%'
            )
        )
    );

-- coaching_focus (05_phase5_product_coaching.sql)
DROP POLICY IF EXISTS coaching_focus_read ON coaching_focus;
CREATE POLICY coaching_focus_read ON coaching_focus
    FOR SELECT
    USING (
        is_admin() OR
        se_user_id = current_user_id() OR
        (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM app_user u
                JOIN org_unit ou ON ou.id = u.org_unit_id
                WHERE u.id = coaching_focus.se_user_id
                  AND ou.path LIKE current_org_path() || '%'
            )
        )
    );

DROP POLICY IF EXISTS coaching_focus_write ON coaching_focus;
CREATE POLICY coaching_focus_write ON coaching_focus
    FOR ALL
    USING (
        is_admin() OR
        set_by_user_id = current_user_id() OR
        (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM app_user u
                JOIN org_unit ou ON ou.id = u.org_unit_id
                WHERE u.id = coaching_focus.se_user_id
                  AND ou.path LIKE current_org_path() || '%'
            )
        )
    );

-- coaching_recommendation (05_phase5_product_coaching.sql)
DROP POLICY IF EXISTS coaching_recommendation_read ON coaching_recommendation;
CREATE POLICY coaching_recommendation_read ON coaching_recommendation
    FOR SELECT
    USING (
        is_admin() OR
        se_user_id = current_user_id() OR
        (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM org_unit ou
                WHERE ou.id = coaching_recommendation.org_unit_id
                  AND ou.path LIKE current_org_path() || '%'
            )
        )
    );

-- coaching_reflection_se_only needs no change: it keys on
-- se_user_id = current_user_id(), and current_user_id() is NULL when unset,
-- so the predicate is never TRUE for an unscoped session (already fail-closed).
