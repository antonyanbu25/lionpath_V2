-- ----------------------------------------------------------------------------
-- 39 — stop janus_app (and PUBLIC) from executing redact_pii() (J-036)
--
-- Found while wiring P11. 06_phase6_outbox_integrations_pii.sql ends with
--
--     GRANT EXECUTE ON FUNCTION redact_pii() TO janus_redactor;
--
-- which reads as "only the redactor role may run this". It is decorative.
-- Measured on a from-zero database, the actual grants on redact_pii() are:
--
--     PUBLIC | janus_app | janus_redactor | postgres
--
-- Two things put them there, and neither is visible at the call site:
--   1. PostgreSQL grants EXECUTE on a new function to PUBLIC by default.
--   2. 07_grants.sql:22 does GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public
--      TO janus_app, and :33 sets the same as a DEFAULT PRIVILEGE. Both run
--      AFTER 06, so they re-widen what 06 appears to have narrowed.
--
-- Why this matters more than an unused grant:
--
--   - redact_pii() is SECURITY DEFINER owned by postgres, so it executes with
--     superuser rights and bypasses RLS entirely.
--   - It is irreversible. It NULLs post_call.analysis and post_call.detail for
--     every post-call on a lost deal closed more than 12 months ago — the
--     transcript-derived analysis, MEDDPICC, ARR, objections and commitments —
--     and tombstones soft-deleted app_user/contact rows.
--   - janus_app is the role the web worker connects as. So any SQL injection
--     that reaches a query, or any leak of the janus_app credential, can
--     destroy call analysis with a single SELECT redact_pii() and no audit
--     trail. Compare 18_ai_run_rls.sql, which REVOKEs UPDATE/DELETE on ai_run
--     to protect COST data; the same care was not taken for a routine that
--     deletes the most sensitive content in the system.
--
-- Nothing in the product calls redact_pii(): the only references in the repo
-- are its own definition, this file, and 07_grants.sql's comment. So revoking
-- it from janus_app removes a capability that is used by nothing.
--
-- This does NOT schedule retention. Enforcing retention still needs a
-- janus_redactor credential and, more importantly, an owner for the decision
-- of what to destroy and when. Scheduling an irreversible job is a
-- data-retention policy call, not a wiring task. See P11 notes.
--
-- Idempotent: REVOKE on an absent grant is a no-op, and the GRANT is the same
-- one 06 already makes.
-- ----------------------------------------------------------------------------

-- PUBLIC first: leaving it would make the janus_app revoke pointless, since
-- janus_app is a member of PUBLIC.
REVOKE EXECUTE ON FUNCTION redact_pii() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION redact_pii() FROM janus_app;

-- Restated so this file is self-contained: the one role that SHOULD hold it.
GRANT EXECUTE ON FUNCTION redact_pii() TO janus_redactor;

-- Guard against 07_grants.sql-style re-widening happening again by accident.
-- A future "GRANT EXECUTE ON ALL FUNCTIONS ... TO janus_app" would silently
-- undo the revoke above, so fail loudly here instead of shipping a false
-- restriction a second time.
DO $$
BEGIN
    IF has_function_privilege('janus_app', 'redact_pii()', 'EXECUTE') THEN
        RAISE EXCEPTION
            'janus_app still holds EXECUTE on redact_pii() after the revoke — '
            'a later blanket GRANT EXECUTE ON ALL FUNCTIONS has re-widened it. '
            'Move that grant before this migration, or exclude redact_pii().';
    END IF;
    IF NOT has_function_privilege('janus_redactor', 'redact_pii()', 'EXECUTE') THEN
        RAISE EXCEPTION 'janus_redactor lost EXECUTE on redact_pii()';
    END IF;
END
$$;
