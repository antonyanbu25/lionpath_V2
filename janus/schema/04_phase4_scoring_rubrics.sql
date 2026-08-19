-- ============================================================================
-- Janus Data Model - Phase 4: Scoring Engine, Rubric Catalog & Overrides
-- DDL-ready PostgreSQL schema
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: rubric_theme
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rubric_theme (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text,
    display_order int NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Table: rubric
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rubric (
    id text PRIMARY KEY,
    rubric_theme_id text NOT NULL REFERENCES rubric_theme(id) ON DELETE RESTRICT,
    name text NOT NULL,
    description text,
    version text NOT NULL,
    display_order int,
    effective_from date NOT NULL,
    effective_to date,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rubric_theme_id ON rubric(rubric_theme_id);

-- ----------------------------------------------------------------------------
-- Table: rubric_parameter
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rubric_parameter (
    id text PRIMARY KEY,
    rubric_id text NOT NULL REFERENCES rubric(id) ON DELETE RESTRICT,
    name text NOT NULL,
    description text,
    weight numeric NOT NULL,
    is_locked boolean NOT NULL DEFAULT false,
    display_order int,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rubric_parameter_rubric_id ON rubric_parameter(rubric_id);

-- ----------------------------------------------------------------------------
-- Table: scorecard
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scorecard (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    activity_id bigint NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
    rubric_id text NOT NULL REFERENCES rubric(id) ON DELETE RESTRICT,
    is_current boolean NOT NULL DEFAULT true,
    owner_user_id bigint REFERENCES app_user(id) ON DELETE NO ACTION,
    org_unit_id text NOT NULL REFERENCES org_unit(id) ON DELETE RESTRICT,
    composite_score numeric CHECK (composite_score BETWEEN 0 AND 2),
    se_camera text CHECK (se_camera IN ('yes', 'no', 'partially')),
    customer_camera text CHECK (customer_camera IN ('yes', 'no', 'partially')),
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_scorecard_activity_rubric UNIQUE (activity_id, rubric_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scorecard_activity_current ON scorecard(activity_id) WHERE is_current = true;
CREATE INDEX IF NOT EXISTS idx_scorecard_owner_created ON scorecard(owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_scorecard_org_unit ON scorecard(org_unit_id);
CREATE INDEX IF NOT EXISTS idx_scorecard_rubric_id ON scorecard(rubric_id);

-- RLS for scorecard
ALTER TABLE scorecard ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecard FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scorecard_team_read ON scorecard;
CREATE POLICY scorecard_team_read ON scorecard
    FOR SELECT
    USING (
        is_admin() OR
        EXISTS (
            SELECT 1 FROM org_unit ou
            WHERE ou.id = scorecard.org_unit_id
              AND ou.path LIKE current_org_path() || '%'
        )
    );

DROP POLICY IF EXISTS scorecard_owner_write ON scorecard;
CREATE POLICY scorecard_owner_write ON scorecard
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
-- Table: scorecard_line
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scorecard_line (
    id bigint GENERATED ALWAYS AS IDENTITY,
    created_at timestamptz NOT NULL DEFAULT now(),
    scorecard_id bigint NOT NULL,
    rubric_parameter_id text NOT NULL REFERENCES rubric_parameter(id) ON DELETE RESTRICT,
    rubric_theme_id text NOT NULL REFERENCES rubric_theme(id) ON DELETE RESTRICT,
    score smallint NOT NULL CHECK (score BETWEEN 0 AND 2),
    param_name_snapshot text NOT NULL,
    param_weight_snapshot numeric NOT NULL,
    evidence text,

    PRIMARY KEY (id, created_at),
    CONSTRAINT fk_scl_scorecard FOREIGN KEY (scorecard_id) REFERENCES scorecard(id) ON DELETE CASCADE,
    CONSTRAINT uq_scl_scorecard_param UNIQUE (scorecard_id, rubric_parameter_id)
);

CREATE INDEX IF NOT EXISTS idx_scl_scorecard_id ON scorecard_line(scorecard_id);
CREATE INDEX IF NOT EXISTS idx_scl_param_id ON scorecard_line(rubric_parameter_id);
CREATE INDEX IF NOT EXISTS idx_scl_theme_id ON scorecard_line(rubric_theme_id);

-- RLS for scorecard_line
ALTER TABLE scorecard_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecard_line FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scorecard_line_read ON scorecard_line;
CREATE POLICY scorecard_line_read ON scorecard_line
    FOR SELECT
    USING (
        is_admin() OR
        EXISTS (
            SELECT 1 FROM scorecard s
            JOIN org_unit ou ON ou.id = s.org_unit_id
            WHERE s.id = scorecard_line.scorecard_id
              AND ou.path LIKE current_org_path() || '%'
        )
    );

DROP POLICY IF EXISTS scorecard_line_write ON scorecard_line;
CREATE POLICY scorecard_line_write ON scorecard_line
    FOR ALL
    USING (
        is_admin() OR
        EXISTS (
            SELECT 1 FROM scorecard s
            WHERE s.id = scorecard_line.scorecard_id
              AND s.owner_user_id = current_user_id()
        )
    );

-- ----------------------------------------------------------------------------
-- Table: score_override
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS score_override (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scorecard_line_id bigint NOT NULL,
    scorecard_line_created_at timestamptz NOT NULL,
    previous_score smallint NOT NULL CHECK (previous_score BETWEEN 0 AND 2),
    new_score smallint NOT NULL CHECK (new_score BETWEEN 0 AND 2),
    reason text NOT NULL,
    created_by bigint REFERENCES app_user(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT fk_score_override_line FOREIGN KEY (scorecard_line_id, scorecard_line_created_at) 
        REFERENCES scorecard_line(id, created_at) ON DELETE CASCADE
);

REVOKE UPDATE, DELETE ON score_override FROM janus_app;
