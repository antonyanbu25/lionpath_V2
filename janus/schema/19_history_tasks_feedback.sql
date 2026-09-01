-- ============================================================================
-- Janus Data Model - Phase 2 Extension: user history/tasks/feedback blobs
-- Faithful PostgreSQL home for the existing se_history doc-per-user KV model.
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_kv (
    email text PRIMARY KEY,
    history jsonb,
    tasks jsonb,
    feedback jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_kv_email_not_blank CHECK (btrim(email) <> '')
);

CREATE INDEX IF NOT EXISTS idx_user_kv_updated_at ON user_kv(updated_at DESC);

ALTER TABLE user_kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_kv FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_kv_owner_read ON user_kv;
CREATE POLICY user_kv_owner_read ON user_kv
    FOR SELECT
    USING (
        is_admin() OR
        email = NULLIF(current_setting('app.email', true), '')
    );

DROP POLICY IF EXISTS user_kv_owner_write ON user_kv;
CREATE POLICY user_kv_owner_write ON user_kv
    FOR ALL
    USING (
        is_admin() OR
        email = NULLIF(current_setting('app.email', true), '')
    )
    WITH CHECK (
        is_admin() OR
        email = NULLIF(current_setting('app.email', true), '')
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON user_kv TO janus_app;
GRANT SELECT ON user_kv TO janus_readonly;
