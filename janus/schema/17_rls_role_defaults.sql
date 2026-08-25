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

ALTER ROLE janus_app SET app.is_admin = 'false';
ALTER ROLE janus_app SET app.user_id = '';
ALTER ROLE janus_app SET app.org_unit_path = '';