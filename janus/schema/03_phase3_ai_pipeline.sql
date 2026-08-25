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
-- Cost-modelling telemetry for every LLM call. Populated by the worker's
-- recordLlmUsage chokepoint (worker/src/data/llm-usage.ts) via insertAiRun
-- (worker/src/data/persistence/ai-run.ts), which runs in its own short
-- system-context transaction. run_type is nullable + a free-text pass_name is
-- kept alongside it because the real pass set (~15 values) is wider than
-- run_type_enum and best-effort mapping must never violate the enum.
--
-- Telemetry columns (cached_tokens, grounding_queries, cache_hit, retry_count,
-- user_id) mirror the Firestore llmUsage doc so the SQL stream does not
-- regress the legacy one; cost_usd is computed at write time from cost-rates.ts
-- (cached tokens priced at the cached rate).
CREATE TABLE IF NOT EXISTS ai_run (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activity_id bigint REFERENCES activity(id) ON DELETE CASCADE,
    prompt_template_id text REFERENCES prompt_template(id) ON DELETE RESTRICT,
    run_type run_type_enum,                       -- best-effort enum; NULL when no clean mapping
    pass_name text,                               -- free-text pipeline pass label (superset of run_type)
    model text NOT NULL,
    input_tokens int,
    output_tokens int,
    cached_tokens int NOT NULL DEFAULT 0,
    grounding_queries int NOT NULL DEFAULT 0,
    cache_hit boolean NOT NULL DEFAULT false,
    retry_count int NOT NULL DEFAULT 0,
    user_id bigint REFERENCES app_user(id) ON DELETE SET NULL, -- NULL for system/sentinel calls
    cost_usd numeric,                             -- USD computed at write time from cost-rates.ts
    latency_ms int,
    error_code error_code_enum,                   -- NULL on success; set on failed/billed runs
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_run_activity_created ON ai_run(activity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_run_created_model ON ai_run(created_at, model);
CREATE INDEX IF NOT EXISTS idx_ai_run_user_created ON ai_run(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_run_run_type_created ON ai_run(run_type, created_at) WHERE run_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_run_model_created ON ai_run(model, created_at);

-- Append-only cost telemetry: the app role may INSERT and SELECT, never
-- UPDATE or DELETE. (Grants in 07_grants.sql apply broad DML then re-revoke
-- UPDATE/DELETE on immutable tables; mirror that here for ai_run.)
REVOKE UPDATE, DELETE ON ai_run FROM janus_app;

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
