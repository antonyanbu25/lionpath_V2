-- ============================================================================
-- Janus Data Model - Phase H Extension: audit + notification enum values
-- Postgres forbids using a new enum value in the same transaction that added
-- it. apply-janus-schema.mjs runs each file as one implicit transaction, so
-- these ADD VALUE statements live in their own file, applied before
-- 25_audit_and_notifications.sql -- which references them in trigger bodies.
-- Same pattern as 10b_integration_enum.sql and 10c_run_type_enum_widen.sql.
--
-- audit_action_enum had create/update/delete/anonymize/override/merge. D7
-- requires impersonations and role changes logged, and neither is an update
-- or an override: an impersonation changes no row, and a role grant is a new
-- temporal row rather than a modification.
--
-- notification_type_enum had scorecard_ready/signal_assigned/sync_error/
-- coaching_assigned. The live notification path is manager dispute email
-- (notify-email.ts), which had no type to be filed under (D19).
-- ============================================================================

ALTER TYPE audit_action_enum ADD VALUE IF NOT EXISTS 'impersonate';
ALTER TYPE audit_action_enum ADD VALUE IF NOT EXISTS 'grant';
ALTER TYPE audit_action_enum ADD VALUE IF NOT EXISTS 'revoke';

ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'score_dispute';
ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'dispute_ruling';
