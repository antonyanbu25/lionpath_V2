-- ============================================================================
-- Janus Data Model - Phase I: Firestore-fallback telemetry
--
-- The problem this solves: trySqlDomainWrite has 26 places that return
-- { handled: false }, and every one of them silently sends the write to
-- Firestore instead of Postgres. No error, no metric, nothing in the log that
-- distinguishes "this landed in Postgres" from "this quietly did not".
--
-- That is precisely the blind spot that made the earlier audits necessary, and
-- it is unworkable for a cutover: you cannot switch Firestore off until you can
-- prove nothing is still falling back to it.
--
-- So every fallback is recorded here with a reason. The coverage report
-- (janus/scripts/coverage-report.mjs) reads this table and answers one
-- question: which methods are still not reaching Postgres, and why.
--
-- Deliberately NOT partitioned and NOT RLS-scoped: it is operational
-- telemetry about the system, not user data, and it must be readable in
-- aggregate by whoever is running the cutover.
--
-- Idempotent. Run after 29_precall_deal_required.sql.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sql_fallback_log (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    occurred_at timestamptz NOT NULL DEFAULT now(),

    -- The domain-write method that fell back, e.g. 'createPrepBrief'.
    method      text NOT NULL,
    -- Why. A stable code, so the report can group and so a fix can be
    -- verified by the code disappearing rather than by counting.
    reason      text NOT NULL,
    -- Free text: the id that could not resolve, the shape key that failed.
    detail      text,

    -- Who and where, when known. Nullable because some fallbacks happen
    -- BEFORE the session is resolved -- which is itself a reason.
    user_public_id text,
    entity_public_id text,

    -- 'firestore' | 'dual' | 'sql'. A fallback in sql mode is a LOST WRITE,
    -- not a fallback, because there is no Firestore to catch it.
    persistence_mode text,

    CONSTRAINT chk_sfl_reason CHECK (reason IN (
        'postgres_not_configured',   -- no DATABASE_URL / port unavailable
        'no_verified_user',          -- request had no authenticated user
        'no_sql_session',            -- user has no app_user/user_identity row
        'not_authorized',            -- app-layer check refused the SQL path
        'missing_required_field',    -- the doc lacked an id/owner/account
        'shape_validation_failed',   -- jsonb shape rejected
        'unmapped_parent',           -- id_registry could not resolve a parent
        'no_deal_or_lifecycle',      -- prep brief with nothing to tie to
        'deal_provision_failed',     -- placeholder deal could not be created
        'method_not_implemented',    -- no SQL path written for this method yet
        'write_error'                -- the SQL write threw
    ))
);

CREATE INDEX IF NOT EXISTS idx_sfl_method_time
    ON sql_fallback_log(method, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sfl_reason
    ON sql_fallback_log(reason, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_sfl_recent
    ON sql_fallback_log(occurred_at DESC);

COMMENT ON TABLE sql_fallback_log IS
    'One row per write that did NOT reach Postgres, with the reason. Read by '
    'janus/scripts/coverage-report.mjs. The cutover gate is simple: this table '
    'stops gaining rows for a method before that method is considered wired.';

COMMENT ON COLUMN sql_fallback_log.reason IS
    'A stable code, not a message. A fix is verified by the code no longer '
    'appearing, which is checkable; a message is not.';

COMMENT ON COLUMN sql_fallback_log.persistence_mode IS
    'A fallback logged while mode = sql is a LOST WRITE -- Firestore is not '
    'there to catch it. The report escalates those.';

GRANT SELECT, INSERT ON sql_fallback_log TO janus_app;
GRANT SELECT ON sql_fallback_log TO janus_readonly;

-- Append-only: telemetry that can be edited is not evidence.
REVOKE UPDATE, DELETE ON sql_fallback_log FROM janus_app;

-- ----------------------------------------------------------------------------
-- The writer.
--
-- SECURITY DEFINER and its own autonomous insert: a fallback is logged from
-- inside a request that is ABOUT to abandon the SQL path, and often after a
-- failed transaction. It must never depend on the caller's transaction
-- succeeding, and it must never itself be the thing that fails the request.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_sql_fallback(
    p_method   text,
    p_reason   text,
    p_detail   text DEFAULT NULL,
    p_user     text DEFAULT NULL,
    p_entity   text DEFAULT NULL,
    p_mode     text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO sql_fallback_log
        (method, reason, detail, user_public_id, entity_public_id, persistence_mode)
    VALUES (p_method, p_reason, p_detail, p_user, p_entity, p_mode);
EXCEPTION WHEN OTHERS THEN
    -- Telemetry must never break the request it is describing.
    RAISE WARNING 'log_sql_fallback failed for %/%: %', p_method, p_reason, SQLERRM;
END
$$;

-- ----------------------------------------------------------------------------
-- The coverage view: per method, is it reaching Postgres?
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_sql_coverage WITH (security_invoker = true) AS
SELECT method,
       count(*)::int                                            AS fallbacks,
       count(*) FILTER (WHERE occurred_at > now() - interval '24 hours')::int AS last_24h,
       count(*) FILTER (WHERE persistence_mode = 'sql')::int     AS lost_writes,
       array_agg(DISTINCT reason ORDER BY reason)                AS reasons,
       max(occurred_at)                                          AS most_recent
FROM sql_fallback_log
GROUP BY method
ORDER BY count(*) FILTER (WHERE occurred_at > now() - interval '24 hours') DESC,
         count(*) DESC;

COMMENT ON VIEW v_sql_coverage IS
    'Per method: how often it failed to reach Postgres, why, and whether any '
    'of those were LOST (mode = sql, so Firestore did not catch them). '
    'last_24h going to zero for a method is the signal it is genuinely wired.';

GRANT SELECT ON v_sql_coverage TO janus_app, janus_readonly;
