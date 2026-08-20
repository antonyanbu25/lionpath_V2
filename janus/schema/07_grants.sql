-- ============================================================================
-- Janus Data Model - Phase A Extension: Role Grants
-- Blocker 1: janus_app has zero table privileges in v9.3 DDL.
-- This file grants DML to janus_app and read-only to janus_readonly,
-- then re-applies the immutable-table REVOKEs from the phase files.
-- Run AFTER 00-06 phase files. Idempotent.
-- ============================================================================

-- Schema usage
GRANT USAGE ON SCHEMA public TO janus_app;
GRANT USAGE ON SCHEMA public TO janus_readonly;

-- App role: full DML on all application tables. Row visibility is still
-- constrained by RLS policies on RLS-enabled tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO janus_app;

-- Sequences: identity columns need sequence usage for INSERT ... DEFAULT
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO janus_app;

-- Functions: session helpers (current_user_id, current_org_path, is_admin),
-- outbox claim, triggers are invoked via table writes.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO janus_app;

-- Read-only role for reporting / BI
GRANT SELECT ON ALL TABLES IN SCHEMA public TO janus_readonly;

-- Future tables created by later migrations inherit grants
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO janus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO janus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO janus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT ON TABLES TO janus_readonly;

-- ----------------------------------------------------------------------------
-- Immutable audit/history tables: re-apply REVOKEs after the broad GRANT above.
-- These tables are append-only (written by triggers / system); janus_app must
-- never UPDATE or DELETE rows.
-- ----------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON deal_stage_history FROM janus_app;
REVOKE UPDATE, DELETE ON audit_log FROM janus_app;
REVOKE UPDATE, DELETE ON score_override FROM janus_app;
REVOKE UPDATE, DELETE ON contact_merge_log FROM janus_app;

-- janus_redactor keeps its scoped grants from 03/06 phase files
-- (SELECT, UPDATE(payload) ON audit_log; EXECUTE ON redact_pii()).
