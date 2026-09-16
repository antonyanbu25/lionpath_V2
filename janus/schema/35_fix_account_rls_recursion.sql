-- ============================================================================
-- Janus Data Model - fix account / account_se_team RLS self-recursion
--
-- account_se_team_owner_write (on account) and account_se_team_write (on
-- account_se_team) were both declared FOR ALL, which -- unlike its name
-- suggests -- also governs SELECT, not just writes. Each policy's USING
-- clause calls account_writable_by_current_user(), which queries the OTHER
-- table to check membership. That table's own FOR ALL policy then calls the
-- same function again, for the same account_id, and so on: a plain
-- `SELECT * FROM account` for a non-admin session recurses through both
-- tables' policies until Postgres's C-stack overflows ("stack depth limit
-- exceeded"), taking down every /api/accounts read and every /api/domain-write
-- that touches account or account_se_team with it.
--
-- Admin-mode sessions never saw this: is_admin() OR (...) short-circuits
-- before the recursive branch runs. Every real SE/manager session (is_admin
-- = false) hit it on every account read or write.
--
-- SECURITY DEFINER is not an escape here: this is managed Cloud SQL, and no
-- role (including the schema owner) carries rolbypassrls (see the same note
-- in 15_id_registry_backfill.sql, verify-call-storage.mjs, and
-- coverage-report.mjs) -- FORCE ROW LEVEL SECURITY on both tables means even
-- a SECURITY DEFINER function's owner is still subject to RLS on its own
-- queries. There is no privileged role to fall back to on this platform.
--
-- The real fix is structural: SELECT already has its own correct, cheap,
-- non-recursive policy on each table (account_read / account_se_team_read).
-- The membership check only needs to gate INSERT/UPDATE/DELETE. Splitting
-- FOR ALL into the three write commands removes it from SELECT's policy set
-- entirely, breaking the cycle without changing write semantics at all.
--
-- Idempotent. Run after 34_usage_and_leaderboard_views.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- account: replace the FOR ALL owner-write policy with INSERT/UPDATE/DELETE
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS account_se_team_owner_write ON account;
DROP POLICY IF EXISTS account_se_team_owner_write_ins ON account;
DROP POLICY IF EXISTS account_se_team_owner_write_upd ON account;
DROP POLICY IF EXISTS account_se_team_owner_write_del ON account;

CREATE POLICY account_se_team_owner_write_ins ON account
    FOR INSERT
    WITH CHECK (
        is_admin() OR (current_user_id() IS NOT NULL
                       AND account_writable_by_current_user(account.id))
    );

CREATE POLICY account_se_team_owner_write_upd ON account
    FOR UPDATE
    USING (
        is_admin() OR (current_user_id() IS NOT NULL
                       AND account_writable_by_current_user(account.id))
    )
    WITH CHECK (
        is_admin() OR (current_user_id() IS NOT NULL
                       AND account_writable_by_current_user(account.id))
    );

CREATE POLICY account_se_team_owner_write_del ON account
    FOR DELETE
    USING (
        is_admin() OR (current_user_id() IS NOT NULL
                       AND account_writable_by_current_user(account.id))
    );

-- ----------------------------------------------------------------------------
-- account_se_team: same split, same reason.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS account_se_team_write ON account_se_team;
DROP POLICY IF EXISTS account_se_team_write_ins ON account_se_team;
DROP POLICY IF EXISTS account_se_team_write_upd ON account_se_team;
DROP POLICY IF EXISTS account_se_team_write_del ON account_se_team;

CREATE POLICY account_se_team_write_ins ON account_se_team
    FOR INSERT
    WITH CHECK (
        is_admin() OR (current_user_id() IS NOT NULL
                       AND account_writable_by_current_user(account_se_team.account_id))
    );

CREATE POLICY account_se_team_write_upd ON account_se_team
    FOR UPDATE
    USING (
        is_admin() OR (current_user_id() IS NOT NULL
                       AND account_writable_by_current_user(account_se_team.account_id))
    )
    WITH CHECK (
        is_admin() OR (current_user_id() IS NOT NULL
                       AND account_writable_by_current_user(account_se_team.account_id))
    );

CREATE POLICY account_se_team_write_del ON account_se_team
    FOR DELETE
    USING (
        is_admin() OR (current_user_id() IS NOT NULL
                       AND account_writable_by_current_user(account_se_team.account_id))
    );
