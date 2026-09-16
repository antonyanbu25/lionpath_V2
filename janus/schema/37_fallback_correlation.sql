-- ----------------------------------------------------------------------------
-- 37 — correlation id and owner on sql_fallback_log (astra-audit P5)
--
-- P5's invariant: every requested durable write either commits to PostgreSQL or
-- produces a QUERYABLE, ATTRIBUTABLE failure. 30_fallback_telemetry.sql already
-- records method, reason, detail, actor and entity — enough to answer "which
-- methods are not reaching Postgres", which is what it was built for.
--
-- Two things it cannot answer, both of which P5 requires:
--
--   1. "which REQUEST did this failure belong to" — without a correlation id a
--      fallback row cannot be joined to the request log, so a user reporting
--      "my call did not save" cannot be traced to the row that explains why.
--      The worker already mints one per request (worker/src/request-context.ts,
--      returned as the X-Request-Id response header), so this only needs
--      somewhere to put it.
--
--   2. "whose data was lost" — user_public_id records the ACTOR. In a
--      manager/admin proxy flow the actor is not the owner, so attributing a
--      lost write to the actor mis-attributes it. owner_public_id records the
--      call owner when it is known.
--
-- Both columns are nullable and additive: existing rows keep their meaning and
-- nothing that reads this table needs to change. The function is dropped and
-- recreated rather than given more DEFAULT arguments, because keeping both a
-- 6-arg and an 8-arg overload would make the existing 6-arg call sites
-- ambiguous and fail at runtime.
--
-- Idempotent: safe to re-apply.
-- ----------------------------------------------------------------------------

ALTER TABLE sql_fallback_log
    ADD COLUMN IF NOT EXISTS correlation_id   text,
    ADD COLUMN IF NOT EXISTS owner_public_id  text;

COMMENT ON COLUMN sql_fallback_log.correlation_id IS
    'Per-request id from worker/src/request-context.ts, also returned as the '
    'X-Request-Id response header. Joins a lost write to the request that caused it.';
COMMENT ON COLUMN sql_fallback_log.owner_public_id IS
    'app_user.public_id of the call OWNER, when known. Distinct from '
    'user_public_id, which is the ACTOR — they differ in a manager proxy flow.';

-- Lets an operator pull every failure for one reported request.
CREATE INDEX IF NOT EXISTS idx_sfl_correlation
    ON sql_fallback_log (correlation_id)
    WHERE correlation_id IS NOT NULL;

-- Lets an operator answer "what has this SE silently lost".
CREATE INDEX IF NOT EXISTS idx_sfl_owner_time
    ON sql_fallback_log (owner_public_id, occurred_at DESC)
    WHERE owner_public_id IS NOT NULL;

DROP FUNCTION IF EXISTS log_sql_fallback(text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION log_sql_fallback(
    p_method        text,
    p_reason        text,
    p_detail        text DEFAULT NULL,
    p_user          text DEFAULT NULL,
    p_entity        text DEFAULT NULL,
    p_mode          text DEFAULT NULL,
    p_correlation   text DEFAULT NULL,
    p_owner         text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO sql_fallback_log
        (method, reason, detail, user_public_id, entity_public_id, persistence_mode,
         correlation_id, owner_public_id)
    VALUES (p_method, p_reason, p_detail, p_user, p_entity, p_mode,
            p_correlation, p_owner);
EXCEPTION WHEN OTHERS THEN
    -- Telemetry must never break the request it is describing.
    RAISE WARNING 'log_sql_fallback failed for %/%: %', p_method, p_reason, SQLERRM;
END
$$;

REVOKE ALL ON FUNCTION log_sql_fallback(text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_sql_fallback(text, text, text, text, text, text, text, text)
    TO janus_app;

-- v_sql_coverage keeps working unchanged: it selects named columns, so the two
-- additions do not alter its output. A per-request view is deliberately NOT
-- added here — no product surface reads one yet, and an unread view is exactly
-- the kind of object migration 34 became.
