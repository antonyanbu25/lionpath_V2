-- ============================================================================
-- Janus Data Model - Phase 33: Daily user usage rollups
--
-- Login events are recorded in user_usage_logins, not audit_log. audit_log's
-- enum is deliberately left untouched.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_usage_daily (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usage_date date NOT NULL,
    user_id bigint NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    email text NOT NULL,
    post_calls int NOT NULL DEFAULT 0,
    pre_calls int NOT NULL DEFAULT 0,
    ai_runs int NOT NULL DEFAULT 0,
    input_tokens bigint NOT NULL DEFAULT 0,
    output_tokens bigint NOT NULL DEFAULT 0,
    cost_usd numeric(12,6) NOT NULL DEFAULT 0,
    avg_score numeric(4,2),
    logins int NOT NULL DEFAULT 0,
    first_login_at timestamptz,
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_usage_daily_date_user UNIQUE (usage_date, user_id),
    CONSTRAINT user_usage_daily_email_not_blank CHECK (btrim(email) <> '')
);

CREATE INDEX IF NOT EXISTS idx_user_usage_daily_date ON user_usage_daily(usage_date);
CREATE INDEX IF NOT EXISTS idx_user_usage_daily_email_date ON user_usage_daily(email, usage_date DESC);
CREATE INDEX IF NOT EXISTS idx_user_usage_daily_user_date ON user_usage_daily(user_id, usage_date DESC);

ALTER TABLE user_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_usage_daily FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_usage_daily_owner_read ON user_usage_daily;
CREATE POLICY user_usage_daily_owner_read ON user_usage_daily
    FOR SELECT
    USING (
        is_admin() OR
        email = NULLIF(current_setting('app.email', true), '')
    );

DROP POLICY IF EXISTS user_usage_daily_owner_write ON user_usage_daily;
CREATE POLICY user_usage_daily_owner_write ON user_usage_daily
    FOR ALL
    USING (
        is_admin() OR
        email = NULLIF(current_setting('app.email', true), '')
    )
    WITH CHECK (
        is_admin() OR
        email = NULLIF(current_setting('app.email', true), '')
    );

CREATE TABLE IF NOT EXISTS user_usage_logins (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint REFERENCES app_user(id) ON DELETE SET NULL,
    email text,
    logged_in_at timestamptz NOT NULL DEFAULT now(),
    source text NOT NULL DEFAULT 'web',
    CONSTRAINT user_usage_logins_email_not_blank CHECK (email IS NULL OR btrim(email) <> ''),
    CONSTRAINT user_usage_logins_source_not_blank CHECK (btrim(source) <> '')
);

CREATE INDEX IF NOT EXISTS idx_user_usage_logins_user_logged_in
    ON user_usage_logins(user_id, logged_in_at);
CREATE INDEX IF NOT EXISTS idx_user_usage_logins_email_logged_in
    ON user_usage_logins(email, logged_in_at DESC);

ALTER TABLE user_usage_logins ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_usage_logins FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_usage_logins_owner_read ON user_usage_logins;
CREATE POLICY user_usage_logins_owner_read ON user_usage_logins
    FOR SELECT
    USING (
        is_admin() OR
        email = NULLIF(current_setting('app.email', true), '')
    );

DROP POLICY IF EXISTS user_usage_logins_owner_write ON user_usage_logins;
CREATE POLICY user_usage_logins_owner_write ON user_usage_logins
    FOR ALL
    USING (
        is_admin() OR
        email = NULLIF(current_setting('app.email', true), '')
    )
    WITH CHECK (
        is_admin() OR
        email = NULLIF(current_setting('app.email', true), '')
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON user_usage_daily TO janus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_usage_logins TO janus_app;
GRANT SELECT ON user_usage_daily TO janus_readonly;
GRANT SELECT ON user_usage_logins TO janus_readonly;
