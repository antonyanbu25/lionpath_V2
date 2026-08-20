-- ============================================================================
-- Janus Data Model - Phase 6: Sync Outbox, Integrations, CDC & PII Governance
-- DDL-ready PostgreSQL schema
-- ============================================================================

-- Add deferred Foreign Key from activity to integration
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_activity_source_integration'
    ) THEN
        -- Created below after integration table
    END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- Table: integration
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    provider integration_provider_enum NOT NULL,
    display_name text,
    auth_type text NOT NULL CHECK (auth_type IN ('oauth2', 'api_key')),
    credentials_ref text NOT NULL,
    config jsonb,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disconnected', 'error')),
    last_healthy_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Add deferred FK to activity
ALTER TABLE activity
    DROP CONSTRAINT IF EXISTS fk_activity_source_integration,
    ADD CONSTRAINT fk_activity_source_integration 
    FOREIGN KEY (source_integration_id) REFERENCES integration(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- Table: integration_token
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_token (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    integration_id bigint NOT NULL REFERENCES integration(id) ON DELETE CASCADE,
    access_token_ref text NOT NULL,
    refresh_token_ref text,
    token_type text NOT NULL DEFAULT 'bearer',
    scopes text,
    expires_at timestamptz NOT NULL,
    refreshed_at timestamptz,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_itk_integration_id ON integration_token(integration_id);

-- ----------------------------------------------------------------------------
-- Table: sync_job
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_job (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    integration_id bigint NOT NULL REFERENCES integration(id) ON DELETE CASCADE,
    direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    entity_type text NOT NULL CHECK (entity_type IN ('app_user', 'account', 'contact', 'deal', 'activity', 'task', 'health_score')),
    status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'partial')),
    records_processed int NOT NULL DEFAULT 0,
    records_failed int NOT NULL DEFAULT 0,
    error_summary text,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sj_integration_started ON sync_job(integration_id, started_at DESC);

-- ----------------------------------------------------------------------------
-- Table: sync_error
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_error (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sync_job_id bigint NOT NULL REFERENCES sync_job(id) ON DELETE CASCADE,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    external_ref text,
    error_code error_code_enum NOT NULL,
    error_detail text,
    retryable boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_se_sync_job_id ON sync_error(sync_job_id);

-- ----------------------------------------------------------------------------
-- Table: sync_conflict
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_conflict (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    integration_id bigint NOT NULL REFERENCES integration(id) ON DELETE CASCADE,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    field_name text NOT NULL,
    local_value text,
    remote_value text,
    remote_modified_at timestamptz,
    resolution text NOT NULL DEFAULT 'pending' CHECK (resolution IN ('pending', 'use_local', 'use_remote', 'manual')),
    resolved_by bigint REFERENCES app_user(id) ON DELETE SET NULL,
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_sync_conflict_resolution CHECK ((resolution = 'pending') = (resolved_at IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_scf_entity ON sync_conflict(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_scf_integration_created ON sync_conflict(integration_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scf_pending ON sync_conflict(resolution, created_at) WHERE resolution = 'pending';

-- ----------------------------------------------------------------------------
-- Table: sync_outbox
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_outbox (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    integration_id bigint NOT NULL REFERENCES integration(id) ON DELETE CASCADE,
    operation text NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
    payload jsonb NOT NULL,
    status sync_outbox_status_enum NOT NULL DEFAULT 'pending',
    attempts int NOT NULL DEFAULT 0,
    last_attempted_at timestamptz,
    next_retry_at timestamptz DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sob_status_retry ON sync_outbox(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_sob_integration_id ON sync_outbox(integration_id);

-- Outbox Claims Helper Procedure using FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION claim_outbox_batch(p_limit int DEFAULT 20)
RETURNS TABLE (
    outbox_id bigint,
    entity_type text,
    entity_id text,
    integration_id bigint,
    operation text,
    payload jsonb,
    attempts int
) LANGUAGE plpgsql AS $$
BEGIN
    -- QA #8: requeue rows stranded in 'processing' by a crashed worker.
    UPDATE sync_outbox
    SET status = 'pending'
    WHERE status = 'processing'
      AND last_attempted_at < now() - interval '10 minutes';

    RETURN QUERY
    WITH claimed AS (
        SELECT sob.id
        FROM sync_outbox sob
        WHERE sob.status = 'pending'
          AND sob.next_retry_at <= now()
        ORDER BY sob.id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT p_limit
    )
    UPDATE sync_outbox sob
    SET status = 'processing',
        attempts = sob.attempts + 1,
        last_attempted_at = now()
    FROM claimed
    WHERE sob.id = claimed.id
    RETURNING
        sob.id,
        sob.entity_type,
        sob.entity_id,
        sob.integration_id,
        sob.operation,
        sob.payload,
        sob.attempts;
END;
$$;

-- ----------------------------------------------------------------------------
-- Table: webhook_event (PARTITIONED BY RANGE (received_at))
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_event (
    id bigint GENERATED ALWAYS AS IDENTITY,
    received_at timestamptz NOT NULL DEFAULT now(),
    integration_id bigint NOT NULL REFERENCES integration(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    external_event_id text,
    payload jsonb NOT NULL,
    processing_status text NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received', 'processing', 'completed', 'failed')),
    linked_entity_type text,
    linked_entity_id text,
    processed_at timestamptz,
    PRIMARY KEY (id, received_at)
) PARTITION BY RANGE (received_at);

CREATE TABLE IF NOT EXISTS webhook_event_2026_w34 PARTITION OF webhook_event
    FOR VALUES FROM ('2026-08-17 00:00:00+00') TO ('2026-08-24 00:00:00+00');

CREATE TABLE IF NOT EXISTS webhook_event_2026_w35 PARTITION OF webhook_event
    FOR VALUES FROM ('2026-08-24 00:00:00+00') TO ('2026-08-31 00:00:00+00');

CREATE TABLE IF NOT EXISTS webhook_event_default PARTITION OF webhook_event DEFAULT;

CREATE INDEX IF NOT EXISTS idx_wh_status_received ON webhook_event(processing_status, received_at);
CREATE INDEX IF NOT EXISTS idx_wh_linked_entity ON webhook_event(linked_entity_type, linked_entity_id, received_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wh_dedup ON webhook_event(integration_id, external_event_id, received_at) WHERE external_event_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Table: notification
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    user_id bigint NOT NULL REFERENCES app_user(id) ON DELETE NO ACTION,
    type notification_type_enum NOT NULL,
    entity_type text,
    entity_id text,
    title text NOT NULL,
    body text,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ntf_unread ON notification(user_id, created_at) WHERE read_at IS NULL;

-- ----------------------------------------------------------------------------
-- Table: contact_merge_log
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_merge_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_contact_id bigint NOT NULL REFERENCES contact(id) ON DELETE NO ACTION,
    target_contact_id bigint NOT NULL REFERENCES contact(id) ON DELETE NO ACTION,
    merged_by bigint REFERENCES app_user(id) ON DELETE NO ACTION,
    merged_at timestamptz NOT NULL DEFAULT now()
);

REVOKE UPDATE, DELETE ON contact_merge_log FROM janus_app;
CREATE INDEX IF NOT EXISTS idx_cml_source ON contact_merge_log(source_contact_id);
CREATE INDEX IF NOT EXISTS idx_cml_target ON contact_merge_log(target_contact_id);

-- ----------------------------------------------------------------------------
-- PII Anonymization Procedure (janus_redactor)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION redact_pii()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_redacted_count int := 0;
BEGIN
    -- 1. Anonymize post_call for lost deals older than 12 months
    WITH lost_deals AS (
        SELECT d.id FROM deal d 
        WHERE d.status = 'lost' 
          AND d.close_date < (now() - INTERVAL '12 months')::date
    ),
    target_posts AS (
        SELECT pc.id 
        FROM post_call pc
        JOIN activity a ON a.id = pc.activity_id
        JOIN lost_deals ld ON ld.id = a.deal_id
    )
    UPDATE post_call pc
    SET analysis = jsonb_set(
            jsonb_set(pc.analysis, '{callNotes}', '"[REDACTED]"'::jsonb),
            '{artifacts,suggestedFollowUpEmail}', '"[REDACTED]"'::jsonb, true
        ),
        updated_at = now()
    FROM target_posts tp
    WHERE pc.id = tp.id;

    GET DIAGNOSTICS v_redacted_count = ROW_COUNT;

    -- 2. Tombstone soft-deleted users/contacts older than 30 days
    UPDATE app_user
    SET email = 'redacted+' || id::text || '@invalid',
        display_name = '[REDACTED]',
        job_title = NULL,
        updated_at = now()
    WHERE deleted_at < now() - INTERVAL '30 days'
      AND email NOT LIKE 'redacted+%';

    UPDATE contact
    SET email = 'redacted+' || id::text || '@invalid',
        name = '[REDACTED]',
        title = NULL,
        updated_at = now()
    WHERE deleted_at < now() - INTERVAL '30 days'
      AND email NOT LIKE 'redacted+%';

    RETURN v_redacted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION redact_pii() TO janus_redactor;
