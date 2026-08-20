-- ============================================================================
-- Janus Data Model - Phase 3: Multi-Pass AI Pipeline Engine & Platform Infrastructure
-- DDL-ready PostgreSQL schema
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: prompt_template
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prompt_template (
    id text PRIMARY KEY,
    name text NOT NULL,
    version text NOT NULL,
    body text NOT NULL,
    variables jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_template_active_name ON prompt_template(name) WHERE is_active = true;

-- ----------------------------------------------------------------------------
-- Table: feature_flag
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feature_flag (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key text NOT NULL,
    value jsonb,
    scope_type text,
    scope_id text,
    is_active boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_feature_flag_scope CHECK (
        (scope_type IS NULL AND scope_id IS NULL) OR (scope_type IS NOT NULL AND scope_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_flag_key_scope ON feature_flag (
    key, 
    COALESCE(scope_type, '__global__'), 
    COALESCE(scope_id, '__none__')
);

-- ----------------------------------------------------------------------------
-- Table: ai_run
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_run (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activity_id bigint REFERENCES activity(id) ON DELETE CASCADE,
    prompt_template_id text REFERENCES prompt_template(id) ON DELETE RESTRICT,
    run_type run_type_enum NOT NULL,
    model text NOT NULL,
    input_tokens int,
    output_tokens int,
    cost_usd numeric,
    latency_ms int,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_run_activity_created ON ai_run(activity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_run_created_model ON ai_run(created_at, model);

-- ----------------------------------------------------------------------------
-- Table: audit_log (PARTITIONED BY RANGE (created_at) at launch)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id bigint GENERATED ALWAYS AS IDENTITY,
    created_at timestamptz NOT NULL DEFAULT now(),
    user_id bigint REFERENCES app_user(id) ON DELETE NO ACTION,
    entity_type text NOT NULL,
    entity_id text NOT NULL, -- public_id
    action audit_action_enum NOT NULL,
    payload jsonb,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create default initial partitions for audit_log
CREATE TABLE IF NOT EXISTS audit_log_2026_08 PARTITION OF audit_log
    FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS audit_log_2026_09 PARTITION OF audit_log
    FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS audit_log_default PARTITION OF audit_log DEFAULT;

CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id, created_at);

-- Permissions
REVOKE UPDATE, DELETE ON audit_log FROM janus_app;
GRANT SELECT, UPDATE(payload) ON audit_log TO janus_redactor;
