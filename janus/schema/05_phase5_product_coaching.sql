-- ============================================================================
-- Janus Data Model - Phase 5: Product Intelligence & SE Coaching Loops
-- DDL-ready PostgreSQL schema
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: signal_cluster
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS signal_cluster (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    name text NOT NULL,
    capability_area text,
    description text,
    signal_count int NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Table: product_signal
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_signal (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    activity_id bigint NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
    post_call_id bigint REFERENCES post_call(id) ON DELETE SET NULL,
    deal_id bigint REFERENCES deal(id) ON DELETE SET NULL,
    account_id bigint NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
    owner_user_id bigint NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    org_unit_id text NOT NULL REFERENCES org_unit(id) ON DELETE RESTRICT,
    source text NOT NULL CHECK (source IN ('ai_extracted', 'pm_created', 'se_created')),
    signal_type signal_type_enum NOT NULL,
    signal_key text,
    fw_product text,
    capability_area text,
    title text NOT NULL,
    description text,
    evidence text,
    deal_impact text CHECK (deal_impact IN ('blocker', 'friction', 'nice_to_have')),
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'confirmed', 'dismissed')),
    reviewed_by bigint REFERENCES app_user(id) ON DELETE SET NULL,
    cluster_id bigint REFERENCES signal_cluster(id) ON DELETE SET NULL,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_product_signal_ai_key CHECK (source <> 'ai_extracted' OR signal_key IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_psig_ai_key ON product_signal(activity_id, signal_key) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_psig_status_cap ON product_signal(status, capability_area);
CREATE INDEX IF NOT EXISTS idx_psig_prod_type ON product_signal(fw_product, signal_type);
CREATE INDEX IF NOT EXISTS idx_psig_cluster_id ON product_signal(cluster_id);
CREATE INDEX IF NOT EXISTS idx_psig_created_at ON product_signal(created_at);
CREATE INDEX IF NOT EXISTS idx_psig_org_unit ON product_signal(org_unit_id);
CREATE INDEX IF NOT EXISTS idx_psig_owner ON product_signal(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_psig_source ON product_signal(source);

-- Trigger Function to update signal_cluster.signal_count
CREATE OR REPLACE FUNCTION trg_fn_signal_cluster_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        IF (NEW.cluster_id IS NOT NULL AND NEW.deleted_at IS NULL) THEN
            UPDATE signal_cluster SET signal_count = signal_count + 1, updated_at = now() WHERE id = NEW.cluster_id;
        END IF;
    ELSIF (TG_OP = 'UPDATE') THEN
        IF (OLD.cluster_id IS DISTINCT FROM NEW.cluster_id OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at) THEN
            IF (OLD.cluster_id IS NOT NULL AND OLD.deleted_at IS NULL) THEN
                UPDATE signal_cluster SET signal_count = GREATEST(0, signal_count - 1), updated_at = now() WHERE id = OLD.cluster_id;
            END IF;
            IF (NEW.cluster_id IS NOT NULL AND NEW.deleted_at IS NULL) THEN
                UPDATE signal_cluster SET signal_count = signal_count + 1, updated_at = now() WHERE id = NEW.cluster_id;
            END IF;
        END IF;
    ELSIF (TG_OP = 'DELETE') THEN
        IF (OLD.cluster_id IS NOT NULL AND OLD.deleted_at IS NULL) THEN
            UPDATE signal_cluster SET signal_count = GREATEST(0, signal_count - 1), updated_at = now() WHERE id = OLD.cluster_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_signal_cluster_count ON product_signal;
CREATE TRIGGER trg_signal_cluster_count
    AFTER INSERT OR UPDATE OF cluster_id, deleted_at OR DELETE ON product_signal
    FOR EACH ROW EXECUTE FUNCTION trg_fn_signal_cluster_count();

-- RLS for product_signal
ALTER TABLE product_signal ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_signal FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_signal_read ON product_signal;
CREATE POLICY product_signal_read ON product_signal
    FOR SELECT
    USING (
        is_admin() OR
        EXISTS (
            SELECT 1 FROM user_role ur
            JOIN app_role r ON r.id = ur.role_id
            WHERE ur.user_id = current_user_id() AND r.name = 'pm'
        ) OR
        EXISTS (
            SELECT 1 FROM org_unit ou
            WHERE ou.id = product_signal.org_unit_id
              AND ou.path LIKE current_org_path() || '%'
        )
    );

DROP POLICY IF EXISTS product_signal_write ON product_signal;
CREATE POLICY product_signal_write ON product_signal
    FOR ALL
    USING (
        is_admin() OR
        owner_user_id = current_user_id() OR
        EXISTS (
            SELECT 1 FROM user_role ur
            JOIN app_role r ON r.id = ur.role_id
            WHERE ur.user_id = current_user_id() AND r.name = 'pm'
        )
    );

-- ----------------------------------------------------------------------------
-- Table: coaching_focus
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_focus (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    se_user_id bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    set_by_user_id bigint REFERENCES app_user(id) ON DELETE SET NULL,
    rubric_theme_id text NOT NULL REFERENCES rubric_theme(id) ON DELETE RESTRICT,
    description text,
    target text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'dropped')),
    timeframe_start date,
    timeframe_end date,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cf_se_status ON coaching_focus(se_user_id, status);
CREATE INDEX IF NOT EXISTS idx_cf_rubric_theme ON coaching_focus(rubric_theme_id);

ALTER TABLE coaching_focus ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaching_focus FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coaching_focus_read ON coaching_focus;
CREATE POLICY coaching_focus_read ON coaching_focus
    FOR SELECT
    USING (
        is_admin() OR
        se_user_id = current_user_id() OR
        EXISTS (
            SELECT 1 FROM app_user u
            JOIN org_unit ou ON ou.id = u.org_unit_id
            WHERE u.id = coaching_focus.se_user_id
              AND ou.path LIKE current_org_path() || '%'
        )
    );

DROP POLICY IF EXISTS coaching_focus_write ON coaching_focus;
CREATE POLICY coaching_focus_write ON coaching_focus
    FOR ALL
    USING (
        is_admin() OR
        set_by_user_id = current_user_id() OR
        EXISTS (
            SELECT 1 FROM app_user u
            JOIN org_unit ou ON ou.id = u.org_unit_id
            WHERE u.id = coaching_focus.se_user_id
              AND ou.path LIKE current_org_path() || '%'
        )
    );

-- ----------------------------------------------------------------------------
-- Table: coaching_reflection (STRICT SE PRIVATE RLS)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_reflection (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    se_user_id bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    coaching_focus_id bigint REFERENCES coaching_focus(id) ON DELETE SET NULL,
    activity_id bigint REFERENCES activity(id) ON DELETE SET NULL,
    reflection_text text NOT NULL,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cr_se_created ON coaching_reflection(se_user_id, created_at);

ALTER TABLE coaching_reflection ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaching_reflection FORCE ROW LEVEL SECURITY;

-- Strict policy: Managers EXPLICITLY EXCLUDED. Only the SE or Admin can read/write.
DROP POLICY IF EXISTS coaching_reflection_se_only ON coaching_reflection;
CREATE POLICY coaching_reflection_se_only ON coaching_reflection
    FOR ALL
    USING (
        is_admin() OR
        se_user_id = current_user_id()
    )
    WITH CHECK (
        is_admin() OR
        se_user_id = current_user_id()
    );

-- ----------------------------------------------------------------------------
-- Table: coaching_recommendation
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_recommendation (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    se_user_id bigint NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    rubric_theme_id text NOT NULL REFERENCES rubric_theme(id) ON DELETE RESTRICT,
    org_unit_id text NOT NULL REFERENCES org_unit(id) ON DELETE RESTRICT,
    recommendation_text text NOT NULL,
    evidence_summary text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dismissed', 'actioned')),
    generated_at timestamptz NOT NULL DEFAULT now(),
    dismissed_at timestamptz,
    actioned_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_crec_se_status ON coaching_recommendation(se_user_id, status);
CREATE INDEX IF NOT EXISTS idx_crec_org_unit ON coaching_recommendation(org_unit_id);

ALTER TABLE coaching_recommendation ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaching_recommendation FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS coaching_recommendation_read ON coaching_recommendation;
CREATE POLICY coaching_recommendation_read ON coaching_recommendation
    FOR SELECT
    USING (
        is_admin() OR
        se_user_id = current_user_id() OR
        EXISTS (
            SELECT 1 FROM org_unit ou
            WHERE ou.id = coaching_recommendation.org_unit_id
              AND ou.path LIKE current_org_path() || '%'
        )
    );

DROP POLICY IF EXISTS coaching_recommendation_write ON coaching_recommendation;
CREATE POLICY coaching_recommendation_write ON coaching_recommendation
    FOR UPDATE
    USING (
        is_admin() OR
        se_user_id = current_user_id()
    );
