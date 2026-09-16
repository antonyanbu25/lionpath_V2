-- ============================================================================
-- Janus Data Model - Phase 1: CRM Core & Deal Stage History
-- DDL-ready PostgreSQL schema
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: account
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    name text NOT NULL,
    domain text,
    slug text,
    industry text,
    health_data jsonb,
    external_ref text,
    sync_state sync_state_enum NOT NULL DEFAULT 'pending',
    last_synced_at timestamptz,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_slug_active ON account(slug) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_external_ref ON account(external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_account_health_risk ON account((health_data->>'risk_level'));
CREATE INDEX IF NOT EXISTS idx_account_health_score ON account(((health_data->>'health_score')::numeric));

-- ----------------------------------------------------------------------------
-- Table: contact
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    account_id bigint NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
    email text NOT NULL,
    name text,
    title text,
    role text,
    external_ref text,
    sync_state sync_state_enum NOT NULL DEFAULT 'pending',
    last_synced_at timestamptz,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_account_email_active ON contact(account_id, email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_external_ref ON contact(external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_account_id ON contact(account_id);

-- ----------------------------------------------------------------------------
-- Table: deal
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    account_id bigint NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
    owner_user_id bigint NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    ae_user_id bigint REFERENCES app_user(id) ON DELETE SET NULL,
    csm_user_id bigint REFERENCES app_user(id) ON DELETE SET NULL,
    champion_contact_id bigint REFERENCES contact(id) ON DELETE SET NULL,
    economic_buyer_contact_id bigint REFERENCES contact(id) ON DELETE SET NULL,
    org_unit_id text NOT NULL REFERENCES org_unit(id) ON DELETE RESTRICT,
    name text NOT NULL,
    stage deal_stage_enum NOT NULL,
    status deal_status_enum NOT NULL DEFAULT 'active',
    close_date date,
    amount numeric,
    currency_code text NOT NULL DEFAULT 'USD',
    amount_usd numeric,
    fx_rate numeric,
    fx_rate_at timestamptz,
    tc_incumbent text,
    tc_competitor text,
    tc_status text CHECK (tc_status IN ('pending', 'committed', 'unchanged')),
    tc_detail jsonb,
    
    -- MEDDPICC Fields
    metrics_value text,
    metrics_surfaced_at timestamptz,
    metrics_surfaced boolean GENERATED ALWAYS AS (metrics_surfaced_at IS NOT NULL) STORED,
    
    economic_buyer_value text,
    economic_buyer_surfaced_at timestamptz,
    economic_buyer_surfaced boolean GENERATED ALWAYS AS (economic_buyer_surfaced_at IS NOT NULL) STORED,
    
    decision_criteria_value text,
    decision_criteria_surfaced_at timestamptz,
    decision_criteria_surfaced boolean GENERATED ALWAYS AS (decision_criteria_surfaced_at IS NOT NULL) STORED,
    
    decision_process_value text,
    decision_process_surfaced_at timestamptz,
    decision_process_surfaced boolean GENERATED ALWAYS AS (decision_process_surfaced_at IS NOT NULL) STORED,
    
    paper_process_value text,
    paper_process_surfaced_at timestamptz,
    paper_process_surfaced boolean GENERATED ALWAYS AS (paper_process_surfaced_at IS NOT NULL) STORED,
    
    identify_pain_value text,
    identify_pain_surfaced_at timestamptz,
    identify_pain_surfaced boolean GENERATED ALWAYS AS (identify_pain_surfaced_at IS NOT NULL) STORED,
    
    champion_value text,
    champion_surfaced_at timestamptz,
    champion_surfaced boolean GENERATED ALWAYS AS (champion_surfaced_at IS NOT NULL) STORED,
    
    competition_value text,
    competition_surfaced_at timestamptz,
    competition_surfaced boolean GENERATED ALWAYS AS (competition_surfaced_at IS NOT NULL) STORED,
    
    ai_agent boolean DEFAULT false,
    copilot boolean DEFAULT false,
    freshcaller boolean DEFAULT false,
    other_addons text,
    
    external_ref text,
    sync_state sync_state_enum NOT NULL DEFAULT 'pending',
    last_synced_at timestamptz,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_deal_stage_status CHECK (
        (stage = 'closed_won' AND status = 'won') OR
        (stage = 'closed_lost' AND status = 'lost') OR
        (stage NOT IN ('closed_won', 'closed_lost') AND status IN ('active', 'nurture'))
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_external_ref ON deal(external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_owner_stage ON deal(owner_user_id, stage);
CREATE INDEX IF NOT EXISTS idx_deal_account_id ON deal(account_id);
CREATE INDEX IF NOT EXISTS idx_deal_org_status ON deal(org_unit_id, status);
CREATE INDEX IF NOT EXISTS idx_deal_close_status ON deal(close_date, status);
CREATE INDEX IF NOT EXISTS idx_deal_champion ON deal(champion_contact_id);
CREATE INDEX IF NOT EXISTS idx_deal_econ_buyer ON deal(economic_buyer_contact_id);
CREATE INDEX IF NOT EXISTS idx_deal_tc_incumbent ON deal(tc_incumbent) WHERE tc_incumbent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_tc_competitor ON deal(tc_competitor) WHERE tc_competitor IS NOT NULL;

-- MEDDPICC partial indexes
CREATE INDEX IF NOT EXISTS idx_deal_champion_surfaced ON deal(champion_surfaced_at) WHERE champion_surfaced = true;
CREATE INDEX IF NOT EXISTS idx_deal_econ_buyer_surfaced ON deal(economic_buyer_surfaced_at) WHERE economic_buyer_surfaced = true;

-- ----------------------------------------------------------------------------
-- Table: deal_stage_history
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_stage_history (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    deal_id bigint NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
    from_stage deal_stage_enum,
    to_stage deal_stage_enum NOT NULL,
    from_status deal_status_enum,
    to_status deal_status_enum NOT NULL,
    changed_by bigint REFERENCES app_user(id) ON DELETE SET NULL,
    changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dsh_deal_changed ON deal_stage_history(deal_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_dsh_changed_by ON deal_stage_history(changed_by);

-- Trigger Function for deal_stage_history
CREATE OR REPLACE FUNCTION trg_fn_deal_stage_history()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        INSERT INTO deal_stage_history (
            deal_id, from_stage, to_stage, from_status, to_status, changed_by, changed_at
        ) VALUES (
            NEW.id, NULL, NEW.stage, NULL, NEW.status, current_user_id(), now()
        );
    ELSIF (TG_OP = 'UPDATE') THEN
        IF (OLD.stage IS DISTINCT FROM NEW.stage OR OLD.status IS DISTINCT FROM NEW.status) THEN
            INSERT INTO deal_stage_history (
                deal_id, from_stage, to_stage, from_status, to_status, changed_by, changed_at
            ) VALUES (
                NEW.id, OLD.stage, NEW.stage, OLD.status, NEW.status, current_user_id(), now()
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deal_stage_history ON deal;
CREATE TRIGGER trg_deal_stage_history
    AFTER INSERT OR UPDATE OF stage, status ON deal
    FOR EACH ROW EXECUTE FUNCTION trg_fn_deal_stage_history();

-- Lock App Permissions on Audit/History table
REVOKE UPDATE, DELETE ON deal_stage_history FROM janus_app;

-- ----------------------------------------------------------------------------
-- Row Level Security for deal
-- ----------------------------------------------------------------------------
ALTER TABLE deal ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_team_read ON deal;
CREATE POLICY deal_team_read ON deal
    FOR SELECT
    USING (
        is_admin() OR
        EXISTS (
            SELECT 1 FROM org_unit ou
            WHERE ou.id = deal.org_unit_id
              AND ou.path LIKE current_org_path() || '%'
        )
    );

DROP POLICY IF EXISTS deal_owner_write ON deal;
CREATE POLICY deal_owner_write ON deal
    FOR ALL
    USING (
        is_admin() OR
        owner_user_id = current_user_id()
    )
    WITH CHECK (
        is_admin() OR
        owner_user_id = current_user_id()
    );
