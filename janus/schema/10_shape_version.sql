-- ============================================================================
-- Janus Data Model - Phase A Extension: JSONB Shape Versioning
-- Design C: v9.3 has no shape_version marker on JSONB columns. Without one,
-- post_call.analysis / detail become untyped blobs that cannot evolve safely.
-- Every JSONB write must carry a shape version; the worker validator rejects
-- unknown top-level keys for the declared version.
-- ============================================================================

ALTER TABLE post_call
    ADD COLUMN IF NOT EXISTS analysis_shape_version text NOT NULL DEFAULT '1',
    ADD COLUMN IF NOT EXISTS detail_shape_version text NOT NULL DEFAULT '1';

ALTER TABLE pre_call
    ADD COLUMN IF NOT EXISTS research_brief_shape_version text NOT NULL DEFAULT '1',
    ADD COLUMN IF NOT EXISTS input_snapshot_shape_version text NOT NULL DEFAULT '1';

-- Guard: JSONB payloads must be objects (or NULL), never scalars/arrays.
ALTER TABLE post_call
    DROP CONSTRAINT IF EXISTS chk_post_call_analysis_object,
    ADD CONSTRAINT chk_post_call_analysis_object
        CHECK (analysis IS NULL OR jsonb_typeof(analysis) = 'object'),
    DROP CONSTRAINT IF EXISTS chk_post_call_detail_object,
    ADD CONSTRAINT chk_post_call_detail_object
        CHECK (detail IS NULL OR jsonb_typeof(detail) = 'object');

ALTER TABLE pre_call
    DROP CONSTRAINT IF EXISTS chk_pre_call_brief_object,
    ADD CONSTRAINT chk_pre_call_brief_object
        CHECK (research_brief IS NULL OR jsonb_typeof(research_brief) = 'object'),
    DROP CONSTRAINT IF EXISTS chk_pre_call_snapshot_object,
    ADD CONSTRAINT chk_pre_call_snapshot_object
        CHECK (input_snapshot IS NULL OR jsonb_typeof(input_snapshot) = 'object');
