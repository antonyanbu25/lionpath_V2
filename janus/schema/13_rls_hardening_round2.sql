-- ============================================================================
-- Janus Data Model - Phase B Extension: RLS hardening round 2
-- QA #16 + LIKE-wildcard fix.
--
-- 1. `ou.path LIKE current_org_path() || '%'` treats `_` in paths as a
--    single-char wildcard. Org paths are ltree-like ('/org_1/team_2/'), so
--    prefix matching is exact: replace with starts_with().
-- 2. post_call holds transcripts, MEDDPICC and ARR data — the most sensitive
--    blobs in the CRM — but had no RLS. Scope reads to the owning team
--    (activity's org unit) or admin, mirroring the scorecard policy.
-- ============================================================================

-- deal (replaces 08_rls_hardening.sql version)
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
                  AND starts_with(ou.path, current_org_path())
            )
        )
    );

-- activity
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
                  AND starts_with(ou.path, current_org_path())
            )
        )
    );

-- scorecard
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
                  AND starts_with(ou.path, current_org_path())
            )
        )
    );

-- scorecard_line
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
                  AND starts_with(ou.path, current_org_path())
            )
        )
    );

-- product_signal
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
                  AND starts_with(ou.path, current_org_path())
            )
        )
    );

-- coaching_focus
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
                  AND starts_with(ou.path, current_org_path())
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
                  AND starts_with(ou.path, current_org_path())
            )
        )
    );

-- coaching_recommendation
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
                  AND starts_with(ou.path, current_org_path())
            )
        )
    );

-- deal_contact (11_deal_contact.sql used LIKE; align it too)
DROP POLICY IF EXISTS deal_contact_team_read ON deal_contact;
CREATE POLICY deal_contact_team_read ON deal_contact
    FOR SELECT
    USING (
        is_admin() OR
        (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM deal d
                JOIN org_unit ou ON ou.id = d.org_unit_id
                WHERE d.id = deal_contact.deal_id
                  AND starts_with(ou.path, current_org_path())
            )
        )
    );

-- ----------------------------------------------------------------------------
-- post_call RLS (QA #16, option A): transcripts / MEDDPICC / ARR scoped to
-- the owning team. pre_call is research prep for the same call; scope it the
-- same way. Writes go through the service path (withSystemContext sets
-- app.is_admin), so SELECT policies suffice for app reads.
-- ----------------------------------------------------------------------------
ALTER TABLE post_call ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_call FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS post_call_team_read ON post_call;
CREATE POLICY post_call_team_read ON post_call
    FOR SELECT
    USING (
        is_admin() OR
        (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM activity a
                JOIN org_unit ou ON ou.id = a.org_unit_id
                WHERE a.id = post_call.activity_id
                  AND starts_with(ou.path, current_org_path())
            )
        )
    );

ALTER TABLE pre_call ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_call FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pre_call_team_read ON pre_call;
CREATE POLICY pre_call_team_read ON pre_call
    FOR SELECT
    USING (
        is_admin() OR
        (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM activity a
                JOIN org_unit ou ON ou.id = a.org_unit_id
                WHERE a.id = pre_call.activity_id
                  AND starts_with(ou.path, current_org_path())
            )
        )
    );
