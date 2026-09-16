-- ============================================================================
-- Janus Data Model - Phase H: Scoring reshape
--
-- The scoring tables do not model the coded scoring domain. This migration
-- makes them model it. Three things happen here:
--
--   1. The rubric hierarchy is inverted. Today rubric_theme is the PARENT of
--      rubric (one theme per rubric); a QIP profile contains 11-16 themes.
--      Profiles cannot be stored at all until this is fixed, and D16 requires
--      them stored -- so this is not a preference.
--
--   2. The score scale is corrected. composite_score was CHECK 0..2 while a
--      theme grade is the sum of five 0-2 sub-scores and the leadership cap
--      sits at 8.0, i.e. overall is 0-10. Every insert above 2 was rejected
--      outright. This was the single blocking defect for D3.
--
--   3. N/A becomes expressible. The launch branch makes "not applicable" a
--      first-class, rule-driven state (discovery objections/comp_pitch/
--      case_study when the incident never occurred). It was inexpressible in
--      three places, all NOT NULL CHECK 0..2.
--
-- Postgres starts empty (D6). No score data is migrated; the rubric catalog
-- is loaded by janus/scripts/load-rubric-catalog.mjs (D17), which is the only
-- write path for profiles.
--
-- Idempotent. Run after 21_identity_relationships.sql.
-- Rationale and field derivation: docs/datamodel/BUILD_PLAN.md sections 4-6
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Shared domain vocabulary, as data rather than repeated CHECK lists
--
-- 12 call types x 2 motions = 24 combinations, of which only 19 are valid.
-- A call_type CHECK plus an se_motion CHECK admits all 24 -- nothing would
-- stop a row claiming (demo, expansion), which has no profile and therefore
-- no themes to score against. The valid set is enforced by the rubric table
-- (one row per valid triple) with scorecard.rubric_id as a NOT NULL FK; an
-- invalid pair fails because the parent row does not exist.
--
-- These CHECK lists therefore constrain the *vocabulary*, not the matrix.
-- ----------------------------------------------------------------------------

-- ============================================================================
-- 1. rubric: one row per valid (call_type, se_motion, version)
-- ============================================================================

ALTER TABLE rubric ADD COLUMN IF NOT EXISTS call_type     text;
ALTER TABLE rubric ADD COLUMN IF NOT EXISTS se_motion     text;
ALTER TABLE rubric ADD COLUMN IF NOT EXISTS total_credits int;
ALTER TABLE rubric ADD COLUMN IF NOT EXISTS provisional   boolean NOT NULL DEFAULT true;
ALTER TABLE rubric ADD COLUMN IF NOT EXISTS active        boolean NOT NULL DEFAULT true;

ALTER TABLE rubric DROP CONSTRAINT IF EXISTS chk_rubric_call_type;
ALTER TABLE rubric
    ADD CONSTRAINT chk_rubric_call_type CHECK (call_type IN (
        -- shared across both motions
        'discovery', 'technical_deep_dive', 'reverse_demo', 'use_case_discussion',
        'trial_setup', 'troubleshooting', 'qa_session',
        -- new_business only
        'demo',
        -- expansion only
        'demo_plan_upgrade', 'demo_cross_sell', 'churn_mitigation', 'ai_vision_demo'
    ));

ALTER TABLE rubric DROP CONSTRAINT IF EXISTS chk_rubric_se_motion;
ALTER TABLE rubric
    ADD CONSTRAINT chk_rubric_se_motion
        CHECK (se_motion IN ('new_business', 'expansion'));

ALTER TABLE rubric DROP CONSTRAINT IF EXISTS chk_rubric_total_credits;
ALTER TABLE rubric
    ADD CONSTRAINT chk_rubric_total_credits CHECK (total_credits > 0);

-- effective_from is date NOT NULL with no default and nothing supplied it.
-- The loader now does (D18); a default here would let a rubric slip in
-- undated and break version history.
ALTER TABLE rubric DROP CONSTRAINT IF EXISTS chk_rubric_effective_range;
ALTER TABLE rubric
    ADD CONSTRAINT chk_rubric_effective_range
        CHECK (effective_to IS NULL OR effective_to >= effective_from);

-- The profile identity. Three explicit columns, not a parsed id: rubricIdFor
-- encodes new_business as the ABSENCE of a token, which does not survive a
-- third motion. rubric.id keeps the string form for compatibility with
-- rubricIdFor(), but nothing reads meaning out of it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rubric_identity
    ON rubric(call_type, se_motion, version);

-- Lets scorecard carry call_type/se_motion as real columns (D26) while a
-- composite FK guarantees they agree with the rubric actually referenced.
-- Without this, a scorecard could claim (demo, expansion) and point at the
-- (discovery, new_business) rubric.
--
-- A named UNIQUE CONSTRAINT rather than a unique index: a foreign key must
-- reference one, and constraints have no IF NOT EXISTS form.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_rubric_id_identity'
    ) THEN
        ALTER TABLE rubric
            ADD CONSTRAINT uq_rubric_id_identity UNIQUE (id, call_type, se_motion);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_rubric_active
    ON rubric(call_type, se_motion) WHERE active AND effective_to IS NULL;

COMMENT ON TABLE rubric IS
    'A QIP scoring profile: one row per valid (call_type, se_motion, version). '
    '19 valid rows at v2.1 out of 24 possible combinations -- the sparse '
    'matrix is enforced here, not by CHECK constraints (D16). Only the loader '
    'writes this table (D17); an edit produces a new version (D18).';

COMMENT ON COLUMN rubric.provisional IS
    'Shadow mode -- scores store but stay out of aggregates until calibrated. '
    '17 of the 19 v2.1 profiles are provisional; only demo/new_business and '
    'discovery/new_business are live. Ranking must respect this (D25).';

COMMENT ON COLUMN rubric.total_credits IS
    'Sum of this profile''s theme credits -- the fixed denominator before '
    'evidence_unavailable exclusions. Verified by validate_rubric_catalog().';

-- ============================================================================
-- 2. rubric_theme: now a CHILD of rubric
-- ============================================================================

ALTER TABLE rubric_theme ADD COLUMN IF NOT EXISTS rubric_id     text
    REFERENCES rubric(id) ON DELETE CASCADE;
ALTER TABLE rubric_theme ADD COLUMN IF NOT EXISTS theme_key     text;
ALTER TABLE rubric_theme ADD COLUMN IF NOT EXISTS credit        smallint;
ALTER TABLE rubric_theme ADD COLUMN IF NOT EXISTS category      text;
ALTER TABLE rubric_theme ADD COLUMN IF NOT EXISTS requires_video boolean NOT NULL DEFAULT false;

ALTER TABLE rubric_theme DROP CONSTRAINT IF EXISTS chk_rubric_theme_credit;
ALTER TABLE rubric_theme
    ADD CONSTRAINT chk_rubric_theme_credit CHECK (credit BETWEEN 1 AND 3);

ALTER TABLE rubric_theme DROP CONSTRAINT IF EXISTS chk_rubric_theme_category;
ALTER TABLE rubric_theme
    ADD CONSTRAINT chk_rubric_theme_category CHECK (category IN (
        'discovery_qualification',
        'solution_technical_fit',
        'business_value',
        'credibility_objections',
        'communication_control'
    ));

-- A theme key is unique within a profile, not globally: 'discovery' has a
-- 'research' theme in both motions with different credits.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rubric_theme_key
    ON rubric_theme(rubric_id, theme_key);

CREATE INDEX IF NOT EXISTS idx_rubric_theme_rubric ON rubric_theme(rubric_id);

-- The inversion. rubric.rubric_theme_id made a theme the parent of a rubric;
-- it cannot be retained alongside the correct direction without permitting a
-- cycle. Dropped rather than left nullable so no reader can follow it.
ALTER TABLE rubric DROP CONSTRAINT IF EXISTS rubric_rubric_theme_id_fkey;
DROP INDEX IF EXISTS idx_rubric_theme_id;
ALTER TABLE rubric DROP COLUMN IF EXISTS rubric_theme_id;

COMMENT ON TABLE rubric_theme IS
    'A theme within a profile -- 11 to 16 per rubric, 270 rows across the 19 '
    'v2.1 profiles. Was the parent of rubric before 22_scoring_reshape.sql.';

COMMENT ON COLUMN rubric_theme.requires_video IS
    'Scored from visual evidence only. With no video the theme goes N/A '
    '(evidence_unavailable) and leaves the denominator -- it is never a 0.';

-- ============================================================================
-- 3. rubric_parameter: the five sub-parameters under a theme
-- ============================================================================

ALTER TABLE rubric_parameter ADD COLUMN IF NOT EXISTS rubric_theme_id text
    REFERENCES rubric_theme(id) ON DELETE CASCADE;
ALTER TABLE rubric_parameter ADD COLUMN IF NOT EXISTS param_index smallint;

-- weight is NOT NULL with no default, but QIP sub-parameters are unweighted:
-- a theme grade is the plain sum of five 0-2 scores (quality-score.ts:126).
-- Default 1 so the loader does not have to assert a weight the domain does
-- not have, and param_weight_snapshot on the line stays meaningful.
ALTER TABLE rubric_parameter ALTER COLUMN weight SET DEFAULT 1;

ALTER TABLE rubric_parameter DROP CONSTRAINT IF EXISTS chk_rubric_parameter_index;
ALTER TABLE rubric_parameter
    ADD CONSTRAINT chk_rubric_parameter_index CHECK (param_index BETWEEN 1 AND 5);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rubric_parameter_slot
    ON rubric_parameter(rubric_theme_id, param_index);

CREATE INDEX IF NOT EXISTS idx_rubric_parameter_theme
    ON rubric_parameter(rubric_theme_id);

-- Replaces the auto-minting at postgres-repository.ts:430-434, which exists
-- only because the real structure had no home.
ALTER TABLE rubric_parameter DROP CONSTRAINT IF EXISTS rubric_parameter_rubric_id_fkey;
DROP INDEX IF EXISTS idx_rubric_parameter_rubric_id;
ALTER TABLE rubric_parameter DROP COLUMN IF EXISTS rubric_id;

COMMENT ON TABLE rubric_parameter IS
    'Exactly five sub-parameters per theme, ordered by param_index. 1350 rows '
    'across the 19 v2.1 profiles. The model scores these 0/1/2; the theme '
    'grade (0-10) is their sum, computed in code, never by the model.';

-- ----------------------------------------------------------------------------
-- D17, enforced rather than documented
--
-- "Profiles live in the database for structure, versioning and query, but the
-- only write path is the loader. No admin editing surface." Left as a
-- convention, the first feature that needs a rubric tweak writes one. So
-- janus_app gets SELECT only; the loader runs as the migration role.
--
-- This also protects D18: a scorecard points at the exact rubric version it
-- was scored under, and an in-place edit would retroactively change what
-- published scores mean.
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON rubric           FROM janus_app;
REVOKE INSERT, UPDATE, DELETE ON rubric_theme     FROM janus_app;
REVOKE INSERT, UPDATE, DELETE ON rubric_parameter FROM janus_app;

GRANT SELECT ON rubric           TO janus_app, janus_readonly;
GRANT SELECT ON rubric_theme     TO janus_app, janus_readonly;
GRANT SELECT ON rubric_parameter TO janus_app, janus_readonly;

-- ----------------------------------------------------------------------------
-- Fail loudly if a pre-existing catalog cannot be re-parented.
--
-- Under the clean slate these tables are empty and the NOT NULLs apply
-- silently. On an environment that already loaded the old shape, an orphan
-- row is a real problem and must not be papered over.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_orphan_themes int;
    v_orphan_params int;
BEGIN
    SELECT count(*) INTO v_orphan_themes FROM rubric_theme WHERE rubric_id IS NULL;
    SELECT count(*) INTO v_orphan_params FROM rubric_parameter WHERE rubric_theme_id IS NULL;

    IF v_orphan_themes > 0 OR v_orphan_params > 0 THEN
        RAISE EXCEPTION
            'Cannot re-parent the rubric catalog: % rubric_theme and % rubric_parameter rows predate the inversion. The catalog is loader-owned (D17) and carries no user data -- TRUNCATE rubric_parameter, rubric_theme, rubric CASCADE and re-run janus/scripts/load-rubric-catalog.mjs.',
            v_orphan_themes, v_orphan_params;
    END IF;

    ALTER TABLE rubric_theme     ALTER COLUMN rubric_id       SET NOT NULL;
    ALTER TABLE rubric_theme     ALTER COLUMN theme_key       SET NOT NULL;
    ALTER TABLE rubric_theme     ALTER COLUMN credit          SET NOT NULL;
    ALTER TABLE rubric_theme     ALTER COLUMN category        SET NOT NULL;
    ALTER TABLE rubric_parameter ALTER COLUMN rubric_theme_id SET NOT NULL;
    ALTER TABLE rubric_parameter ALTER COLUMN param_index     SET NOT NULL;
END
$$;

DO $$
DECLARE v_undated int;
BEGIN
    SELECT count(*) INTO v_undated FROM rubric
     WHERE call_type IS NULL OR se_motion IS NULL OR total_credits IS NULL;
    IF v_undated > 0 THEN
        RAISE EXCEPTION
            'Cannot key the rubric catalog: % rubric rows have no call_type/se_motion/total_credits. TRUNCATE rubric CASCADE and re-run the loader.',
            v_undated;
    END IF;
    ALTER TABLE rubric ALTER COLUMN call_type     SET NOT NULL;
    ALTER TABLE rubric ALTER COLUMN se_motion     SET NOT NULL;
    ALTER TABLE rubric ALTER COLUMN total_credits SET NOT NULL;
END
$$;

-- ============================================================================
-- 4. scorecard: the scale fix, and full-fidelity provenance (D26)
-- ============================================================================

-- The blocking defect. A 7.4 was rejected outright.
ALTER TABLE scorecard DROP CONSTRAINT IF EXISTS scorecard_composite_score_check;
ALTER TABLE scorecard DROP CONSTRAINT IF EXISTS chk_scorecard_composite_score;
ALTER TABLE scorecard
    ADD CONSTRAINT chk_scorecard_composite_score
        CHECK (composite_score IS NULL OR composite_score BETWEEN 0 AND 10);

COMMENT ON COLUMN scorecard.composite_score IS
    'QIP overall, 0-10: SUM(grade x credit) / SUM(credit included). The RAW '
    'value always -- the 8.0 leadership cap is applied on read when '
    'leadership_shareable is false, never stored, so the true score is '
    'always recoverable (AT-4).';

-- Identity and provenance of the score.
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS call_type            text;
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS rubric_version       text;
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS se_motion_source     text;
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS provisional          boolean NOT NULL DEFAULT true;
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS total_credits        int;
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS included_credits     int;
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS confidence           numeric;
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS leadership_shareable boolean NOT NULL DEFAULT false;
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS golden_calibrated    boolean NOT NULL DEFAULT false;

-- Category scores: five nullable numerics, one per CATEGORY_KEY. A category
-- with zero included credits is NULL (UI N/A), not 0 -- which is what
-- quality-score.ts:183 already returns while the schema forced a wrong value
-- to be stored. The read-time correction can be deleted once this lands.
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS category_discovery_qualification numeric;
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS category_solution_technical_fit  numeric;
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS category_business_value          numeric;
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS category_credibility_objections  numeric;
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS category_communication_control   numeric;

-- Audit payloads from the verifier and golden-set passes. jsonb rather than
-- columns: these are per-sub-parameter verdicts kept for explanation, not
-- dimensions anything aggregates over.
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS verifier_justifications jsonb;
ALTER TABLE scorecard ADD COLUMN IF NOT EXISTS golden_justifications   jsonb;

ALTER TABLE scorecard DROP CONSTRAINT IF EXISTS chk_scorecard_categories_range;
ALTER TABLE scorecard
    ADD CONSTRAINT chk_scorecard_categories_range CHECK (
        (category_discovery_qualification IS NULL OR category_discovery_qualification BETWEEN 0 AND 10) AND
        (category_solution_technical_fit  IS NULL OR category_solution_technical_fit  BETWEEN 0 AND 10) AND
        (category_business_value          IS NULL OR category_business_value          BETWEEN 0 AND 10) AND
        (category_credibility_objections  IS NULL OR category_credibility_objections  BETWEEN 0 AND 10) AND
        (category_communication_control   IS NULL OR category_communication_control   BETWEEN 0 AND 10)
    );

ALTER TABLE scorecard DROP CONSTRAINT IF EXISTS chk_scorecard_confidence;
ALTER TABLE scorecard
    ADD CONSTRAINT chk_scorecard_confidence
        CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1);

ALTER TABLE scorecard DROP CONSTRAINT IF EXISTS chk_scorecard_credits;
ALTER TABLE scorecard
    ADD CONSTRAINT chk_scorecard_credits CHECK (
        (total_credits    IS NULL OR total_credits > 0) AND
        (included_credits IS NULL OR included_credits >= 0) AND
        (total_credits IS NULL OR included_credits IS NULL OR included_credits <= total_credits)
    );

-- Motion provenance (D14). canonicalizeSeMotion() turns anything that is not
-- the exact string "expansion" into new_business, and 19_se_motion.sql adds a
-- column DEFAULT underneath it -- two independent silent defaults. An
-- expansion SE whose motion fails to resolve is scored against the wrong
-- profile (32 credits, different themes, instead of 27), the score is wrong,
-- and the row reads new_business as though it had been determined.
ALTER TABLE scorecard DROP CONSTRAINT IF EXISTS chk_scorecard_se_motion_source;
ALTER TABLE scorecard
    ADD CONSTRAINT chk_scorecard_se_motion_source
        CHECK (se_motion_source IN ('resolved', 'override', 'defaulted'));

-- Under a clean slate there are no rows to protect, so the insert must state
-- the motion. A missing motion is now a loud error, not a quiet new_business.
ALTER TABLE scorecard ALTER COLUMN se_motion DROP DEFAULT;

COMMENT ON COLUMN scorecard.se_motion_source IS
    'How se_motion was arrived at: resolved (walked the org chain via '
    'resolve_se_motion), override (explicit, per call -- audited by '
    'trg_scorecard_motion_override), defaulted (nothing resolved; the '
    'fallback fired and this score is suspect).';

COMMENT ON COLUMN scorecard.leadership_shareable IS
    'True once the adversarial verifier confirmed every sub-parameter still '
    'scored 2. False means a reader must clamp the DISPLAYED value at 8.0 '
    '(LEADERSHIP_CAP_THRESHOLD); composite_score stays raw either way.';

COMMENT ON COLUMN scorecard.provisional IS
    'Copied from the rubric at scoring time and frozen. A profile promoted '
    'out of shadow mode later must not retroactively pull old scores into '
    'aggregates -- that would change published numbers (D18).';

-- Guarantees the stamped call_type/se_motion agree with the rubric actually
-- referenced. This, plus rubric holding only the 19 valid triples, is what
-- makes (demo, expansion) unstorable.
ALTER TABLE scorecard DROP CONSTRAINT IF EXISTS fk_scorecard_rubric_identity;
DO $$
DECLARE v_unkeyed int;
BEGIN
    SELECT count(*) INTO v_unkeyed FROM scorecard WHERE call_type IS NULL;
    IF v_unkeyed > 0 THEN
        RAISE WARNING
            '% scorecard rows have no call_type; skipping fk_scorecard_rubric_identity. Backfill call_type from rubric then re-run this migration.',
            v_unkeyed;
    ELSE
        ALTER TABLE scorecard ALTER COLUMN call_type SET NOT NULL;
        ALTER TABLE scorecard
            ADD CONSTRAINT fk_scorecard_rubric_identity
            FOREIGN KEY (rubric_id, call_type, se_motion)
            REFERENCES rubric(id, call_type, se_motion) ON DELETE RESTRICT;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_scorecard_call_type_motion
    ON scorecard(call_type, se_motion, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scorecard_rankable
    ON scorecard(owner_user_id, created_at DESC)
    WHERE is_current AND NOT provisional;

-- Deal risk log: incidents, separate from habit themes (QIP section 6). A
-- list per scorecard, so a table rather than a jsonb column -- these are
-- queried ("open claims to verify this week"), not just displayed.
CREATE TABLE IF NOT EXISTS scorecard_deal_risk (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scorecard_id bigint NOT NULL REFERENCES scorecard(id) ON DELETE CASCADE,
    category     text NOT NULL CHECK (category IN (
                     'claim_to_verify', 'commitment_outside_remit',
                     'missing_stakeholder', 'process_gap', 'legal_compliance')),
    description  text NOT NULL,
    severity     text CHECK (severity IN ('low', 'medium', 'high')),
    at_s         numeric,
    quote        text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sdr_scorecard ON scorecard_deal_risk(scorecard_id);
CREATE INDEX IF NOT EXISTS idx_sdr_category  ON scorecard_deal_risk(category, created_at DESC);

COMMENT ON TABLE scorecard_deal_risk IS
    'ScorecardDraft.dealRiskFlags. Incidents on the call that need follow-up, '
    'deliberately not folded into the score.';

ALTER TABLE scorecard_deal_risk ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecard_deal_risk FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sdr_read ON scorecard_deal_risk;
CREATE POLICY sdr_read ON scorecard_deal_risk
    FOR SELECT
    USING (
        is_admin() OR (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM scorecard s
                JOIN org_unit ou ON ou.id = s.org_unit_id
                WHERE s.id = scorecard_deal_risk.scorecard_id
                  AND starts_with(ou.path, current_org_path())
            )
        )
    );

DROP POLICY IF EXISTS sdr_write ON scorecard_deal_risk;
CREATE POLICY sdr_write ON scorecard_deal_risk
    FOR ALL
    USING (
        is_admin() OR EXISTS (
            SELECT 1 FROM scorecard s
            WHERE s.id = scorecard_deal_risk.scorecard_id
              AND s.owner_user_id = current_user_id()
        )
    )
    WITH CHECK (
        is_admin() OR EXISTS (
            SELECT 1 FROM scorecard s
            WHERE s.id = scorecard_deal_risk.scorecard_id
              AND s.owner_user_id = current_user_id()
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON scorecard_deal_risk TO janus_app;
GRANT SELECT ON scorecard_deal_risk TO janus_readonly;

-- ============================================================================
-- 5. The theme level: scorecard_theme
--
-- DEVIATION from the audit's section 4, which proposed denormalising
-- theme_key/grade/credit/category onto scorecard_line. The domain has two
-- distinct grains -- ScorecardLine is a THEME (grade 0-10, credit, category,
-- N/A state) and SubParameterLine is one of its five sub-scores (0-2) --
-- while SQL scorecard_line is at the sub-parameter grain, which is also the
-- grain score_override's FK depends on.
--
-- Denormalising would repeat one grade across five rows that could disagree,
-- and the N/A state is a property of the theme, not of a sub-parameter.
-- So the theme gets its own table and scorecard_line hangs off it:
--
--   scorecard -> scorecard_theme (11-16) -> scorecard_line (5)
--
-- score_override keeps pointing at scorecard_line and keeps working
-- unchanged at the sub-parameter grain.
-- ============================================================================

CREATE TABLE IF NOT EXISTS scorecard_theme (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    scorecard_id    bigint NOT NULL REFERENCES scorecard(id) ON DELETE CASCADE,
    rubric_theme_id text   NOT NULL REFERENCES rubric_theme(id) ON DELETE RESTRICT,
    theme_key       text   NOT NULL,
    -- Sum of five 0-2 sub-parameter scores. NULL when the theme is N/A: an
    -- excluded theme has no grade, and storing 0 would make it look scored.
    grade           smallint CHECK (grade IS NULL OR grade BETWEEN 0 AND 10),
    credit          smallint NOT NULL CHECK (credit BETWEEN 1 AND 3),
    category        text NOT NULL CHECK (category IN (
                        'discovery_qualification', 'solution_technical_fit',
                        'business_value', 'credibility_objections',
                        'communication_control')),
    -- The N/A decision. evidence_unavailable OR model_omitted excludes the
    -- theme from the denominator (quality-score.ts:150). Two booleans rather
    -- than one because the ARITHMETIC is the same and the FACT is not:
    -- "the objection never happened" and "the model omitted this theme" are
    -- different things and both must survive for audit.
    evidence_unavailable boolean NOT NULL DEFAULT false,
    model_omitted        boolean NOT NULL DEFAULT false,
    not_applicable_reason text,
    confidence      numeric CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
    coaching_note   text,
    created_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT uq_scorecard_theme UNIQUE (scorecard_id, theme_key),
    -- Lets scorecard_line reference (scorecard_theme_id, scorecard_id) so a
    -- line can never hang off a theme belonging to a different scorecard.
    CONSTRAINT uq_scorecard_theme_scoped UNIQUE (id, scorecard_id),
    -- An excluded theme carries no grade; an included one must have a grade.
    CONSTRAINT chk_scorecard_theme_na CHECK (
        CASE WHEN evidence_unavailable OR model_omitted
             THEN grade IS NULL
             ELSE grade IS NOT NULL
        END
    ),
    -- Any exclusion must say why -- for either reason. A silent exclusion is
    -- indistinguishable from a bug, and this is the column an SE reads when
    -- they ask why a theme scored nothing.
    CONSTRAINT chk_scorecard_theme_reason CHECK (
        NOT (evidence_unavailable OR model_omitted)
        OR not_applicable_reason IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_sct_scorecard ON scorecard_theme(scorecard_id);
CREATE INDEX IF NOT EXISTS idx_sct_theme     ON scorecard_theme(rubric_theme_id);
CREATE INDEX IF NOT EXISTS idx_sct_category  ON scorecard_theme(category, theme_key);
-- Team heatmap: "which themes is this segment weakest on".
CREATE INDEX IF NOT EXISTS idx_sct_included
    ON scorecard_theme(theme_key, grade)
    WHERE NOT evidence_unavailable AND NOT model_omitted;

COMMENT ON TABLE scorecard_theme IS
    'One row per theme scored on a call -- the domain ScorecardLine. Holds '
    'the theme grade (0-10), its credit, and the three-state N/A. Parent of '
    'scorecard_line, which holds the five sub-parameter scores.';

COMMENT ON COLUMN scorecard_theme.grade IS
    'Sum of five 0-2 sub-parameter scores, computed in code not by the model '
    '(quality-score.ts computeThemeGrade). NULL when the theme is excluded.';

ALTER TABLE scorecard_theme ENABLE ROW LEVEL SECURITY;
ALTER TABLE scorecard_theme FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scorecard_theme_read ON scorecard_theme;
CREATE POLICY scorecard_theme_read ON scorecard_theme
    FOR SELECT
    USING (
        is_admin() OR (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM scorecard s
                JOIN org_unit ou ON ou.id = s.org_unit_id
                WHERE s.id = scorecard_theme.scorecard_id
                  AND starts_with(ou.path, current_org_path())
            )
        )
    );

DROP POLICY IF EXISTS scorecard_theme_write ON scorecard_theme;
CREATE POLICY scorecard_theme_write ON scorecard_theme
    FOR ALL
    USING (
        is_admin() OR EXISTS (
            SELECT 1 FROM scorecard s
            WHERE s.id = scorecard_theme.scorecard_id
              AND s.owner_user_id = current_user_id()
        )
    )
    WITH CHECK (
        is_admin() OR EXISTS (
            SELECT 1 FROM scorecard s
            WHERE s.id = scorecard_theme.scorecard_id
              AND s.owner_user_id = current_user_id()
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON scorecard_theme TO janus_app;
GRANT SELECT ON scorecard_theme TO janus_readonly;

-- ============================================================================
-- 6. scorecard_line: the sub-parameter grain, N/A-capable
-- ============================================================================

ALTER TABLE scorecard_line ADD COLUMN IF NOT EXISTS scorecard_theme_id bigint;
ALTER TABLE scorecard_line ADD COLUMN IF NOT EXISTS param_index smallint;
ALTER TABLE scorecard_line ADD COLUMN IF NOT EXISTS evidence_json jsonb;

-- Composite FK, not a plain one: scorecard_line already carries scorecard_id
-- (the existing RLS policy and unique key depend on it), so without tying the
-- two together a line could point at a theme on someone else's scorecard.
DO $$
DECLARE v_unparented int;
BEGIN
    SELECT count(*) INTO v_unparented
      FROM scorecard_line WHERE scorecard_theme_id IS NULL;

    IF v_unparented > 0 THEN
        RAISE WARNING
            '% scorecard_line rows have no scorecard_theme_id; leaving the column nullable and the FK off. Truncate scorecard CASCADE (no score data survives the clean slate anyway) and re-run.',
            v_unparented;
    ELSE
        ALTER TABLE scorecard_line ALTER COLUMN scorecard_theme_id SET NOT NULL;
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'fk_scl_theme_scoped'
        ) THEN
            ALTER TABLE scorecard_line
                ADD CONSTRAINT fk_scl_theme_scoped
                FOREIGN KEY (scorecard_theme_id, scorecard_id)
                REFERENCES scorecard_theme(id, scorecard_id) ON DELETE CASCADE;
        END IF;
    END IF;
END
$$;

-- N/A, place one of three. A 0 must remain distinguishable from an exclusion.
ALTER TABLE scorecard_line ALTER COLUMN score DROP NOT NULL;
ALTER TABLE scorecard_line DROP CONSTRAINT IF EXISTS scorecard_line_score_check;
ALTER TABLE scorecard_line DROP CONSTRAINT IF EXISTS chk_scorecard_line_score;
ALTER TABLE scorecard_line
    ADD CONSTRAINT chk_scorecard_line_score
        CHECK (score IS NULL OR score BETWEEN 0 AND 2);

ALTER TABLE scorecard_line DROP CONSTRAINT IF EXISTS chk_scorecard_line_param_index;
ALTER TABLE scorecard_line
    ADD CONSTRAINT chk_scorecard_line_param_index
        CHECK (param_index IS NULL OR param_index BETWEEN 1 AND 5);

CREATE INDEX IF NOT EXISTS idx_scl_theme_row ON scorecard_line(scorecard_theme_id);

COMMENT ON COLUMN scorecard_line.score IS
    'One sub-parameter, 0/1/2. NULL when the model returned no verdict for '
    'this sub-parameter -- distinct from a scored 0, which is a real finding.';

COMMENT ON COLUMN scorecard_line.evidence_json IS
    'ScorecardEvidence[] -- timestamped transcript or video quotes. The '
    'existing evidence text column is kept for the human-readable summary.';

-- rubric_theme_id stays on the line: with rubric_theme now scoped to one
-- rubric it is precise, and it keeps the existing team-heatmap index useful
-- without a join through scorecard_theme.

-- ============================================================================
-- 7. score_override: disputes over N/A (D23)
-- ============================================================================

-- previous_score and new_score were NOT NULL CHECK 0..2, so a manager could
-- neither dispute an N/A nor override a score TO N/A. Same defect as
-- scorecard_line; same fix. The table needs no other reshape -- it already
-- works at the sub-parameter grain and is already append-only.
ALTER TABLE score_override ALTER COLUMN previous_score DROP NOT NULL;
ALTER TABLE score_override ALTER COLUMN new_score      DROP NOT NULL;

ALTER TABLE score_override DROP CONSTRAINT IF EXISTS score_override_previous_score_check;
ALTER TABLE score_override DROP CONSTRAINT IF EXISTS score_override_new_score_check;
ALTER TABLE score_override DROP CONSTRAINT IF EXISTS chk_score_override_previous;
ALTER TABLE score_override DROP CONSTRAINT IF EXISTS chk_score_override_new;
ALTER TABLE score_override
    ADD CONSTRAINT chk_score_override_previous
        CHECK (previous_score IS NULL OR previous_score BETWEEN 0 AND 2);
ALTER TABLE score_override
    ADD CONSTRAINT chk_score_override_new
        CHECK (new_score IS NULL OR new_score BETWEEN 0 AND 2);

-- An override that changes nothing is a logging bug, not a ruling. IS
-- DISTINCT FROM so NULL -> 2 and 2 -> NULL both count as changes.
ALTER TABLE score_override DROP CONSTRAINT IF EXISTS chk_score_override_changed;
ALTER TABLE score_override
    ADD CONSTRAINT chk_score_override_changed
        CHECK (previous_score IS DISTINCT FROM new_score);

-- Records the manager's verdict, not just the delta. web/score-disputes.js
-- rules uphold or adjust; only an adjustment appends a row today, but an
-- upheld dispute is also evidence and the column lets it be recorded.
ALTER TABLE score_override ADD COLUMN IF NOT EXISTS ruling text;
ALTER TABLE score_override DROP CONSTRAINT IF EXISTS chk_score_override_ruling;
ALTER TABLE score_override
    ADD CONSTRAINT chk_score_override_ruling
        CHECK (ruling IS NULL OR ruling IN ('uphold', 'adjust'));

CREATE INDEX IF NOT EXISTS idx_score_override_line
    ON score_override(scorecard_line_id, scorecard_line_created_at);
CREATE INDEX IF NOT EXISTS idx_score_override_created_by
    ON score_override(created_by, created_at DESC);

COMMENT ON TABLE score_override IS
    'Append-only manager ruling on one sub-parameter. quality-score.ts has '
    'zero override references, so the AI score REMAINS the scorecard number '
    'and this is an attributed annotation that feeds coaching forward.';

-- ============================================================================
-- 8. post_call: motion provenance, matching scorecard
-- ============================================================================

ALTER TABLE post_call ADD COLUMN IF NOT EXISTS se_motion_source text;
ALTER TABLE post_call ADD COLUMN IF NOT EXISTS call_type        text;

ALTER TABLE post_call DROP CONSTRAINT IF EXISTS chk_post_call_se_motion_source;
ALTER TABLE post_call
    ADD CONSTRAINT chk_post_call_se_motion_source
        CHECK (se_motion_source IN ('resolved', 'override', 'defaulted'));

ALTER TABLE post_call ALTER COLUMN se_motion DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_post_call_call_type
    ON post_call(call_type, se_motion);

COMMENT ON COLUMN post_call.se_motion_source IS
    'See scorecard.se_motion_source. Stamped by the same server-side '
    'resolution so the call and its score can never disagree about motion.';

COMMENT ON COLUMN post_call.call_type IS
    'Confirmed call type. Was absent from both post_call and scorecard: the '
    'call type that selected the profile could not be recovered from the row.';

-- ============================================================================
-- 9. Catalog validation, for the loader to assert against
-- ============================================================================

-- total_credits is denormalised onto rubric because it is the fixed
-- denominator and must not shift when a theme is edited (D18 -- an edit makes
-- a new version instead). Nothing can enforce the sum as a CHECK across
-- rows, so the loader calls this and refuses to finish if it returns anything.
CREATE OR REPLACE FUNCTION validate_rubric_catalog()
RETURNS TABLE (rubric_id text, problem text)
LANGUAGE sql STABLE AS $$
    -- total_credits disagrees with the sum of its themes
    SELECT r.id,
           format('total_credits=%s but themes sum to %s',
                  r.total_credits, COALESCE(sum(t.credit), 0))
    FROM rubric r
    LEFT JOIN rubric_theme t ON t.rubric_id = r.id
    GROUP BY r.id, r.total_credits
    HAVING r.total_credits <> COALESCE(sum(t.credit), 0)

    UNION ALL
    -- a theme without exactly five sub-parameters
    SELECT t.rubric_id,
           format('theme %s has %s sub-parameters, expected 5',
                  t.theme_key, count(p.id))
    FROM rubric_theme t
    LEFT JOIN rubric_parameter p ON p.rubric_theme_id = t.id
    GROUP BY t.rubric_id, t.theme_key
    HAVING count(p.id) <> 5

    UNION ALL
    -- a profile with no themes at all
    SELECT r.id, 'profile has no themes'
    FROM rubric r
    WHERE NOT EXISTS (SELECT 1 FROM rubric_theme t WHERE t.rubric_id = r.id)

    UNION ALL
    -- gaps in param_index (1..5 must all be present)
    SELECT t.rubric_id,
           format('theme %s has non-contiguous param_index', t.theme_key)
    FROM rubric_theme t
    JOIN rubric_parameter p ON p.rubric_theme_id = t.id
    GROUP BY t.rubric_id, t.theme_key
    HAVING min(p.param_index) <> 1 OR max(p.param_index) <> count(p.id);
$$;

COMMENT ON FUNCTION validate_rubric_catalog() IS
    'Structural invariants the schema cannot express as constraints. Returns '
    'zero rows for a healthy catalog. Called by load-rubric-catalog.mjs.';

-- ============================================================================
-- 10. Read models for the reporting requirements (D25, D26)
-- ============================================================================

-- Rankable scores only. A naive ORDER BY avg(composite_score) would be wrong:
-- provisional profiles are shadow-mode and deliberately out of aggregates,
-- and isEligibleForAggregate excludes low-confidence scores. Encoding the
-- rules once here keeps every report consistent with the code.
-- DROP + CREATE rather than CREATE OR REPLACE: replace cannot insert a column
-- in the middle of an existing view's column list, and leadership_shareable
-- belongs next to display_score, which it explains.
-- v_se_score_leaderboard (34_usage_and_leaderboard_views.sql) SELECTs from
-- v_scorecard_rankable, so on a RE-APPLY over a database that already has 34,
-- the DROP below fails with "cannot drop view v_scorecard_rankable because
-- other objects depend on it" and takes the whole apply down at file 22.
--
-- This was latent until 34 was added to apply-janus-schema.mjs PHASE_FILES:
-- from zero the order is fine (22 before 34), and 34 was previously applied to
-- staging by hand only, so no automated run ever re-applied 22 with 34 present.
--
-- Dropped explicitly rather than with CASCADE: CASCADE would silently remove
-- any future dependent too, which is how a view disappears without anyone
-- noticing. 34 recreates the leaderboard later in the same run.
DROP VIEW IF EXISTS v_se_score_leaderboard;
DROP VIEW IF EXISTS v_scorecard_rankable;
CREATE VIEW v_scorecard_rankable WITH (security_invoker = true) AS
SELECT s.id,
       s.public_id,
       s.activity_id,
       s.owner_user_id,
       s.org_unit_id,
       ou.path            AS org_path,
       s.rubric_id,
       s.call_type,
       s.se_motion,
       s.se_motion_source,
       s.rubric_version,
       s.composite_score,
       -- The cap is applied here, on read, and never stored.
       CASE WHEN s.leadership_shareable OR s.composite_score IS NULL
            THEN s.composite_score
            ELSE least(s.composite_score, 8.0)
       END                AS display_score,
       -- Whether display_score was capped. Without this a reader cannot tell a
       -- genuine 8.0 from a 9.3 clamped down to it.
       s.leadership_shareable,
       s.confidence,
       s.total_credits,
       s.included_credits,
       s.golden_calibrated,
       s.created_at
FROM scorecard s
JOIN org_unit ou ON ou.id = s.org_unit_id
WHERE s.is_current
  AND NOT s.provisional
  AND s.composite_score IS NOT NULL;
-- Confidence threshold (was: AND confidence IS NOT NULL AND confidence >= 0.7)
-- removed by request -- rankability now depends only on is_current,
-- non-provisional, and having a score. See at4_ranking.test.mjs for the
-- updated AT-4.1 assertions (SE-3, confidence 0.40, is now rankable).

COMMENT ON VIEW v_scorecard_rankable IS
    'Scores eligible for aggregates and ranking (D25): current, '
    'non-provisional, scored. display_score applies the 8.0 '
    'leadership cap; composite_score stays raw. Slice by org_path prefix '
    'for team/segment/org rollups -- no extra structure needed.';

GRANT SELECT ON v_scorecard_rankable TO janus_app;
GRANT SELECT ON v_scorecard_rankable TO janus_readonly;

-- Recompute overall from stored theme rows. AT-3.5 asserts this equals the
-- stored composite_score -- i.e. that full fidelity (D26) actually holds and
-- the score is not a number nobody can reproduce.
CREATE OR REPLACE FUNCTION recompute_scorecard_overall(p_scorecard_id bigint)
RETURNS numeric
LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN COALESCE(sum(t.credit), 0) = 0 THEN 0
                ELSE round(sum(t.grade * t.credit)::numeric
                           / sum(t.credit)::numeric, 2)
           END
    FROM scorecard_theme t
    WHERE t.scorecard_id = p_scorecard_id
      AND NOT t.evidence_unavailable
      AND NOT t.model_omitted;
$$;

COMMENT ON FUNCTION recompute_scorecard_overall(bigint) IS
    'SUM(grade x credit) / SUM(credit) over included themes only -- the SQL '
    'mirror of scoreCall (quality-score.ts). Excluded themes leave the '
    'denominator; they are never averaged in as a fake 0.';
