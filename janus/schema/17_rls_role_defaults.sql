-- ============================================================================
-- Janus Data Model - Phase G Extension: RLS session-var role defaults
-- H1 fix from security review: anyone with the janus_app DATABASE_URL can
-- connect directly and run `SELECT set_config('app.is_admin', 'true', true)`
-- to bypass all RLS. The worker sets session vars via SET LOCAL inside a
-- transaction (session-context.ts), which overrides role defaults — but a
-- direct connection that does NOT run SET LOCAL gets the role defaults.
--
-- Setting role-level defaults to fail-closed values means a direct
-- janus_app connection that doesn't explicitly SET LOCAL app.is_admin=true
-- (which only the worker does, inside a transaction) gets is_admin=false,
-- user_id=NULL (cast to '' via NULLIF), and org_unit_path=NULL — so RLS
-- policies deny all rows, exactly as if the session vars were never set.
--
-- The worker's withSessionContext uses set_config(..., true) (is_local=true),
-- which overrides the role default for the current transaction only. So
-- legitimate worker writes are unaffected.
--
-- Idempotent: ALTER ROLE SET is a no-op on re-run (it just re-sets the same
-- default). Safe to run multiple times.
-- ============================================================================

-- Managed PostgreSQL (Cloud SQL, RDS) does not grant real superuser: its
-- `postgres` role is cloudsqlsuperuser with rolsuper = false. Setting a
-- CUSTOM (placeholder) parameter via ALTER ROLE requires true superuser,
-- because Postgres cannot validate an unknown GUC. So this file cannot be
-- applied there and fails with:
--
--   permission denied to set parameter "app.is_admin"
--
-- That is survivable, and worth being precise about why. This file is
-- defence-in-depth, not the primary control. The helpers in
-- 00_phase0_infra_and_org.sql / 08_rls_hardening.sql ALREADY fail closed on
-- their own for a connection that never runs SET LOCAL:
--
--   current_user_id()   NULLIF(...)::bigint  -> NULL
--   current_org_path()  NULLIF(...)          -> NULL   (08 hardening)
--   is_admin()          COALESCE(..., false) -> false
--
-- and every policy is written to deny on NULL. The role defaults only make
-- that explicit at the role level. So warn loudly and continue rather than
-- aborting the whole schema apply on a platform that structurally cannot
-- support it. Verify the fallback with janus/tests/rls_fails_closed.test.mjs,
-- which is the actual gate.
DO $$
BEGIN
    ALTER ROLE janus_app SET app.is_admin = 'false';
    ALTER ROLE janus_app SET app.user_id = '';
    ALTER ROLE janus_app SET app.org_unit_path = '';
    RAISE NOTICE 'janus_app role defaults set.';
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING
        'Could not set janus_app role defaults (%). Expected on managed Postgres, where the admin role is not a true superuser. RLS still fails closed via current_user_id() / current_org_path() / is_admin(); confirm with janus/tests/rls_fails_closed.test.mjs.',
        SQLERRM;
END
$$;