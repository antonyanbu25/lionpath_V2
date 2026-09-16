-- ============================================================================
-- Janus Data Model - Phase H: Roadmap-table gaps
--
-- D10 and D22 keep every roadmap table in the model with no work attached.
-- Keeping a table is not the same as keeping it correct, though, and three
-- things need closing here:
--
--   1. The rubric inversion in 22_scoring_reshape.sql changed what
--      rubric_theme.id MEANS, which silently broke the coaching tables'
--      foreign keys. This is a consequence of a decided change, not new work.
--   2. signal_cluster is day-one (D20), and it cannot hold what the
--      clustering code already produces.
--   3. prompt_template and feature_flag are carried as roadmap for stated
--      reasons; each is missing the one column that reason depends on.
--
-- Idempotent. Run after 27_pricing_books.sql.
-- ============================================================================

-- ============================================================================
-- 1. Coaching: a theme CONCEPT, not a theme instance
--
-- This is a real consequence of the inversion and worth stating plainly.
--
-- Before 22, rubric_theme.id was global -- one row per theme, shared across
-- rubrics -- so coaching_focus.rubric_theme_id meant "this SE is working on
-- questioning". After 22, rubric_theme is scoped to one rubric, so there are
-- 19 separate "questions" rows and the same FK now means "this SE is working
-- on questioning, but only as it appears in the expansion churn_mitigation
-- profile". That is not what coaching means.
--
-- Coaching is about the concept across profiles. So it keys on theme_key, and
-- rubric_theme_id becomes an optional pointer for the case where a
-- recommendation really did come from one profile's scoring.
-- ============================================================================

ALTER TABLE coaching_focus          ADD COLUMN IF NOT EXISTS theme_key text;
ALTER TABLE coaching_recommendation ADD COLUMN IF NOT EXISTS theme_key text;

-- Nullable, because the concept is now the identity and the instance is the
-- optional detail. ON DELETE RESTRICT stays: a rubric version cannot be
-- dropped while a coaching row still cites one of its themes.
ALTER TABLE coaching_focus          ALTER COLUMN rubric_theme_id DROP NOT NULL;
ALTER TABLE coaching_recommendation ALTER COLUMN rubric_theme_id DROP NOT NULL;

-- One of the two must be present, or the row says nothing about what is
-- being coached.
ALTER TABLE coaching_focus DROP CONSTRAINT IF EXISTS chk_cf_theme_identified;
ALTER TABLE coaching_focus
    ADD CONSTRAINT chk_cf_theme_identified
        CHECK (theme_key IS NOT NULL OR rubric_theme_id IS NOT NULL);

ALTER TABLE coaching_recommendation DROP CONSTRAINT IF EXISTS chk_crec_theme_identified;
ALTER TABLE coaching_recommendation
    ADD CONSTRAINT chk_crec_theme_identified
        CHECK (theme_key IS NOT NULL OR rubric_theme_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_cf_theme_key   ON coaching_focus(theme_key);
CREATE INDEX IF NOT EXISTS idx_crec_theme_key ON coaching_recommendation(theme_key);

COMMENT ON COLUMN coaching_focus.theme_key IS
    'The theme concept ("questions", "objections"), stable across profiles '
    'and versions. Coaching follows the concept; rubric_theme_id follows one '
    'profile''s instance of it and is optional detail.';

COMMENT ON COLUMN coaching_recommendation.theme_key IS
    'See coaching_focus.theme_key. aggregate-coaching.ts builds the queue '
    'from high-confidence scorecards below the threshold, grouped by theme -- '
    'that grouping is by concept, not by profile instance.';

-- ============================================================================
-- 2. signal_cluster: what the clustering code actually produces (D20)
--
-- Gap clustering works today (domain-model/gap-cluster.ts, embeddings.ts) and
-- writes to Firestore gapClusters. GapCluster carries a centroid, deal and
-- ARR rollups, a taxonomy version and supersession -- none of which have
-- columns. Wiring product signals without clusters would leave
-- product_signal.cluster_id null and the clustering view empty, so this is
-- day-one, not roadmap.
-- ============================================================================

-- Mean of member verbatim embeddings, L2-normalised. real[] rather than
-- pgvector: the extension is not installed and adding it is an
-- infrastructure decision, not a modelling one. Cosine similarity over a
-- few hundred clusters is a sequential scan and fine; if the cluster count
-- grows past a few thousand, install pgvector and change the column type --
-- nothing else in the model depends on the representation.
ALTER TABLE signal_cluster ADD COLUMN IF NOT EXISTS centroid real[];
ALTER TABLE signal_cluster ADD COLUMN IF NOT EXISTS centroid_dim int;
ALTER TABLE signal_cluster ADD COLUMN IF NOT EXISTS deal_count int NOT NULL DEFAULT 0;
ALTER TABLE signal_cluster ADD COLUMN IF NOT EXISTS arr_total numeric NOT NULL DEFAULT 0;
ALTER TABLE signal_cluster ADD COLUMN IF NOT EXISTS taxonomy_version text;
ALTER TABLE signal_cluster ADD COLUMN IF NOT EXISTS product_area text;
ALTER TABLE signal_cluster ADD COLUMN IF NOT EXISTS cross_cutting_tags text[];
ALTER TABLE signal_cluster ADD COLUMN IF NOT EXISTS superseded_by text[];
ALTER TABLE signal_cluster ADD COLUMN IF NOT EXISTS published_at timestamptz;

ALTER TABLE signal_cluster DROP CONSTRAINT IF EXISTS chk_signal_cluster_centroid;
ALTER TABLE signal_cluster
    ADD CONSTRAINT chk_signal_cluster_centroid
        CHECK ((centroid IS NULL AND centroid_dim IS NULL)
               OR array_length(centroid, 1) = centroid_dim);

ALTER TABLE signal_cluster DROP CONSTRAINT IF EXISTS chk_signal_cluster_rollups;
ALTER TABLE signal_cluster
    ADD CONSTRAINT chk_signal_cluster_rollups
        CHECK (deal_count >= 0 AND arr_total >= 0);

-- GapClusterStatus is draft | published | archived; the table had only the
-- first two, so a cluster archived by a split, merge or taxonomy bump had
-- nowhere to go.
ALTER TABLE signal_cluster DROP CONSTRAINT IF EXISTS signal_cluster_status_check;
ALTER TABLE signal_cluster DROP CONSTRAINT IF EXISTS chk_signal_cluster_status;
ALTER TABLE signal_cluster
    ADD CONSTRAINT chk_signal_cluster_status
        CHECK (status IN ('draft', 'published', 'archived'));

-- A published cluster freezes its taxonomy version at label time; an
-- archived one must say what replaced it, or the trail dead-ends.
ALTER TABLE signal_cluster DROP CONSTRAINT IF EXISTS chk_signal_cluster_lifecycle;
ALTER TABLE signal_cluster
    ADD CONSTRAINT chk_signal_cluster_lifecycle CHECK (
        (status <> 'published' OR (published_at IS NOT NULL AND taxonomy_version IS NOT NULL)) AND
        (status <> 'archived'  OR superseded_by IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_signal_cluster_status
    ON signal_cluster(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_cluster_area
    ON signal_cluster(product_area) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_signal_cluster_tags
    ON signal_cluster USING gin(cross_cutting_tags);

COMMENT ON COLUMN signal_cluster.centroid IS
    'Mean of member verbatim embeddings, L2-normalised (GapCluster.centroid). '
    'real[] because pgvector is not installed -- swap the type if the cluster '
    'count outgrows a sequential scan.';

COMMENT ON COLUMN signal_cluster.signal_count IS
    'Maintained by trg_signal_cluster_count (05_phase5_product_coaching.sql). '
    'Do not write it directly.';

-- Clustering run state. ClusteringState in gap-cluster.ts is a singleton
-- document; the incremental clusterer needs it to know what is pending, and
-- `running` is the lock that stops two passes overlapping.
CREATE TABLE IF NOT EXISTS clustering_state (
    id                   text PRIMARY KEY DEFAULT 'singleton',
    pending_gap_count    int NOT NULL DEFAULT 0,
    last_incremental_at  timestamptz,
    last_full_run_at     timestamptz,
    running              boolean NOT NULL DEFAULT false,
    running_since        timestamptz,
    updated_at           timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_clustering_state_singleton CHECK (id = 'singleton'),
    CONSTRAINT chk_clustering_state_pending CHECK (pending_gap_count >= 0),
    -- A run that claims to be in progress must say since when, so a crashed
    -- pass can be detected and the lock released instead of wedging forever.
    CONSTRAINT chk_clustering_state_running CHECK (NOT running OR running_since IS NOT NULL)
);

INSERT INTO clustering_state (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE clustering_state IS
    'Single-row clustering coordinator (ClusteringState). running is an '
    'advisory lock with a timestamp so a crashed pass is recoverable.';

GRANT SELECT, INSERT, UPDATE, DELETE ON clustering_state TO janus_app;
GRANT SELECT ON clustering_state TO janus_readonly;

-- ============================================================================
-- 3. prompt_template: the pairing that justifies keeping it (D22)
--
-- The recorded reason for keeping this table is that a prompt is paired with
-- the code that parses the model's response, so an untested prompt change
-- breaks scoring silently. Nothing in the table records that pairing.
-- ============================================================================

ALTER TABLE prompt_template ADD COLUMN IF NOT EXISTS pass_name text;
ALTER TABLE prompt_template ADD COLUMN IF NOT EXISTS parser_ref text;
ALTER TABLE prompt_template ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE prompt_template ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS idx_prompt_template_pass ON prompt_template(pass_name);

COMMENT ON COLUMN prompt_template.parser_ref IS
    'The module that parses this prompt''s response, e.g. '
    '"postcall/scorecard.ts". The pairing is the whole reason this table is '
    'kept (D22): editing a prompt without its parser breaks scoring silently.';

COMMENT ON COLUMN prompt_template.pass_name IS
    'Pipeline pass this prompt belongs to -- the same wider vocabulary '
    'ai_run.pass_name uses, not the narrower run_type_enum.';

-- ============================================================================
-- 4. feature_flag: cutover switches must not be casually flippable (D22)
--
-- The recorded reason for keeping this table alongside env vars is that three
-- of the flags are cutover switches. If they end up in a table anyone can
-- UPDATE, the reason evaporates -- so the distinction becomes a column, and
-- cutover flags are protected by a trigger rather than by convention.
-- ============================================================================

ALTER TABLE feature_flag ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE feature_flag ADD COLUMN IF NOT EXISTS is_cutover boolean NOT NULL DEFAULT false;
ALTER TABLE feature_flag ADD COLUMN IF NOT EXISTS updated_by bigint
    REFERENCES app_user(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION trg_feature_flag_cutover_guard()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.is_cutover AND NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        RAISE EXCEPTION
            'feature_flag %: cutover flags cannot be toggled through the application. Change it as the migration role, with a change record.',
            OLD.key
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_ff_cutover_guard ON feature_flag;
CREATE TRIGGER trg_ff_cutover_guard
    BEFORE UPDATE ON feature_flag
    FOR EACH ROW EXECUTE FUNCTION trg_feature_flag_cutover_guard();

COMMENT ON COLUMN feature_flag.is_cutover IS
    'PERSISTENCE_MODE and the other cutover switches. Toggling one is a '
    'deliberate operational act, not a product toggle -- enforced by '
    'trg_ff_cutover_guard, which refuses the change for any non-superuser. '
    'Note the circularity that kept these in env vars too: storing "which '
    'database do we use" in the database cannot be the only copy.';

-- ============================================================================
-- 5. The remaining roadmap tables, deliberately untouched
--
-- coaching_reflection      -- shape is correct; SE-private RLS already right
-- integration_token        -- CRM deferred (D21); no second external system yet
-- sync_job / sync_error /
-- sync_conflict / webhook_event
--                          -- the outbox substrate. Correct as designed and
--                             exercised by sync_outbox, which IS live.
--
-- Adding speculative columns to these would be inventing requirements. They
-- stay as they are.
-- ============================================================================
