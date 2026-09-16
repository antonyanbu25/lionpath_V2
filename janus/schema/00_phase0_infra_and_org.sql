-- ============================================================================
-- Janus Data Model - Phase 0: Database Infrastructure, Roles & Org Hierarchy
-- DDL-ready PostgreSQL schema
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Roles
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'janus_owner') THEN
        CREATE ROLE janus_owner NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'janus_app') THEN
        CREATE ROLE janus_app LOGIN PASSWORD 'janus_app_password';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'janus_redactor') THEN
        CREATE ROLE janus_redactor NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'janus_readonly') THEN
        CREATE ROLE janus_readonly NOLOGIN;
    END IF;
END
$$;

-- Global Custom Enums
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_state_enum') THEN
        CREATE TYPE sync_state_enum AS ENUM ('pending', 'synced', 'error');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'deal_stage_enum') THEN
        CREATE TYPE deal_stage_enum AS ENUM (
            'prospecting', 'discovery', 'demo_poc', 'proposal', 'closing', 'closed_won', 'closed_lost'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'deal_status_enum') THEN
        CREATE TYPE deal_status_enum AS ENUM ('active', 'nurture', 'won', 'lost');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_type_enum') THEN
        CREATE TYPE activity_type_enum AS ENUM ('call', 'meeting', 'email', 'task', 'demo');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signal_type_enum') THEN
        CREATE TYPE signal_type_enum AS ENUM ('product_gap', 'objection', 'competitor_intel', 'feature_request');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pipeline_state_enum') THEN
        CREATE TYPE pipeline_state_enum AS ENUM ('ingested', 'analysis_done', 'detail_done', 'scoring_done', 'signals_done', 'failed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'run_type_enum') THEN
        CREATE TYPE run_type_enum AS ENUM ('pre_call', 'analysis', 'detail', 'scoring', 'signal_extract');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status_enum') THEN
        CREATE TYPE task_status_enum AS ENUM ('open', 'in_progress', 'completed', 'cancelled');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_outbox_status_enum') THEN
        CREATE TYPE sync_outbox_status_enum AS ENUM ('pending', 'processing', 'completed', 'failed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_type_enum') THEN
        CREATE TYPE notification_type_enum AS ENUM ('scorecard_ready', 'signal_assigned', 'sync_error', 'coaching_assigned');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'error_code_enum') THEN
        CREATE TYPE error_code_enum AS ENUM ('auth_failure', 'validation_error', 'rate_limit', 'remote_error', 'conflict');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'integration_provider_enum') THEN
        CREATE TYPE integration_provider_enum AS ENUM ('zoom', 'kaia', 'salesforce', 'churnzero');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_action_enum') THEN
        CREATE TYPE audit_action_enum AS ENUM ('create', 'update', 'delete', 'anonymize', 'override', 'merge');
    END IF;
END
$$;

-- Session Helper Functions
CREATE OR REPLACE FUNCTION current_user_id() RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::bigint;
$$;

CREATE OR REPLACE FUNCTION current_org_path() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT COALESCE(NULLIF(current_setting('app.org_unit_path', true), ''), '');
$$;

CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT COALESCE(NULLIF(current_setting('app.is_admin', true), '')::boolean, false);
$$;

-- ----------------------------------------------------------------------------
-- Table: org_unit
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_unit (
    id text PRIMARY KEY,
    name text NOT NULL,
    parent_id text REFERENCES org_unit(id) ON DELETE RESTRICT,
    unit_type text NOT NULL CHECK (unit_type IN ('org', 'region', 'team', 'squad')),
    path text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_unit_parent_id ON org_unit(parent_id);
CREATE INDEX IF NOT EXISTS idx_org_unit_path_ops ON org_unit(path text_pattern_ops);

-- ----------------------------------------------------------------------------
-- Table: app_user
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_user (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    email text NOT NULL,
    display_name text,
    job_title text,
    job_level text CHECK (job_level IN ('IC', 'manager', 'director', 'VP')),
    org_unit_id text REFERENCES org_unit(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    external_ref text,
    sync_state sync_state_enum NOT NULL DEFAULT 'pending',
    last_synced_at timestamptz,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_email_active ON app_user(email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_external_ref ON app_user(external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_user_org_unit_id ON app_user(org_unit_id);

-- ----------------------------------------------------------------------------
-- Table: user_identity
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_identity (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    auth_provider text NOT NULL,
    auth_uid text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_user_identity_provider_uid UNIQUE (auth_provider, auth_uid)
);

CREATE INDEX IF NOT EXISTS idx_user_identity_user_id ON user_identity(user_id);

-- ----------------------------------------------------------------------------
-- Table: app_role
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_role (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text,
    role_type text NOT NULL CHECK (role_type IN ('permission', 'job_function')),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Table: user_role
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_role (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    role_id text NOT NULL REFERENCES app_role(id) ON DELETE RESTRICT,
    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    granted_by bigint REFERENCES app_user(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ex_user_role_no_overlap EXCLUDE USING gist (
        user_id WITH =,
        role_id WITH =,
        tstzrange(valid_from, COALESCE(valid_to, 'infinity')) WITH &&
    )
);

CREATE INDEX IF NOT EXISTS idx_user_role_user_id ON user_role(user_id);
CREATE INDEX IF NOT EXISTS idx_user_role_role_id ON user_role(role_id);
CREATE INDEX IF NOT EXISTS idx_user_role_granted_by ON user_role(granted_by);

-- ----------------------------------------------------------------------------
-- Seed Sentinel User for AI Pipeline
-- ----------------------------------------------------------------------------
INSERT INTO app_user (public_id, email, display_name, job_level, status, sync_state, org_unit_id)
VALUES ('usr_janus_ai', 'ai@janus.internal', 'Janus AI', 'IC', 'active', 'synced', NULL)
ON CONFLICT (public_id) DO NOTHING;
