-- ============================================================================
-- Janus Data Model - Phase 2: Activity Ingestion & Call Data Shell
-- DDL-ready PostgreSQL schema
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: activity
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    idempotency_key text,
    deal_id bigint REFERENCES deal(id) ON DELETE SET NULL,
    account_id bigint NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
    owner_user_id bigint NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    org_unit_id text NOT NULL REFERENCES org_unit(id) ON DELETE RESTRICT,
    activity_type activity_type_enum NOT NULL,
    subject text,
    description text,
    occurred_at timestamptz NOT NULL,
    duration_minutes int,
    source_integration_id bigint, -- FK added in Phase 6 when integration table exists
    external_ref text,
    sync_state sync_state_enum NOT NULL DEFAULT 'pending',
    last_synced_at timestamptz,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_idempotency ON activity(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_external_ref ON activity(external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_deal_occurred ON activity(deal_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_owner_occurred ON activity(owner_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_account ON activity(account_id);
CREATE INDEX IF NOT EXISTS idx_activity_org ON activity(org_unit_id);
CREATE INDEX IF NOT EXISTS idx_activity_type_occurred ON activity(activity_type, occurred_at);

-- RLS for activity
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_team_read ON activity;
CREATE POLICY activity_team_read ON activity
    FOR SELECT
    USING (
        is_admin() OR
        EXISTS (
            SELECT 1 FROM org_unit ou
            WHERE ou.id = activity.org_unit_id
              AND ou.path LIKE current_org_path() || '%'
        )
    );

DROP POLICY IF EXISTS activity_owner_write ON activity;
CREATE POLICY activity_owner_write ON activity
    FOR ALL
    USING (
        is_admin() OR
        owner_user_id = current_user_id()
    )
    WITH CHECK (
        is_admin() OR
        owner_user_id = current_user_id()
    );

-- ----------------------------------------------------------------------------
-- Table: pre_call
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pre_call (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    idempotency_key text,
    activity_id bigint NOT NULL UNIQUE REFERENCES activity(id) ON DELETE CASCADE,
    research_brief jsonb,
    input_snapshot jsonb,
    generated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pre_call_idempotency ON pre_call(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Table: post_call
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS post_call (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    idempotency_key text,
    activity_id bigint NOT NULL UNIQUE REFERENCES activity(id) ON DELETE CASCADE,
    transcript_ref text,
    analysis jsonb,
    detail jsonb,
    pipeline_state pipeline_state_enum NOT NULL DEFAULT 'ingested',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_call_idempotency ON post_call(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_post_call_failed ON post_call(pipeline_state) WHERE pipeline_state = 'failed';

-- ----------------------------------------------------------------------------
-- Table: call_participant
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_participant (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activity_id bigint NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
    contact_id bigint REFERENCES contact(id) ON DELETE SET NULL,
    participant_name text,
    participant_email text,
    participant_role text CHECK (participant_role IN ('attendee', 'presenter', 'observer')),
    created_at timestamptz NOT NULL DEFAULT now(),
    
    CONSTRAINT chk_call_participant_has_identity CHECK (
        contact_id IS NOT NULL OR participant_email IS NOT NULL OR participant_name IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_cp_activity_id ON call_participant(activity_id);
CREATE INDEX IF NOT EXISTS idx_cp_contact_id ON call_participant(contact_id);

-- ----------------------------------------------------------------------------
-- Table: task
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    activity_id bigint REFERENCES activity(id) ON DELETE SET NULL,
    deal_id bigint REFERENCES deal(id) ON DELETE SET NULL,
    owner_user_id bigint NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    title text NOT NULL,
    description text,
    status task_status_enum NOT NULL DEFAULT 'open',
    due_date date,
    source text NOT NULL CHECK (source IN ('ai_generated', 'manual')),
    task_key text,
    external_ref text,
    sync_state sync_state_enum NOT NULL DEFAULT 'pending',
    last_synced_at timestamptz,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_task_ai_key CHECK (source <> 'ai_generated' OR task_key IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_task_ai_dedup ON task(activity_id, task_key) WHERE source = 'ai_generated' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_external_ref ON task(external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_owner_status_due ON task(owner_user_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_task_deal_status ON task(deal_id, status);
