-- ============================================================================
-- Janus Data Model - Phase G Extension: SE motion on post_call / scorecard
-- QIP v2.1 catalogs are keyed by (callType, seMotion). Deal.type stays CRM
-- routing; this column is the acting-SE motion used to pick the catalog.
-- Shared keys (discovery, etc.) must never blend across new_business vs
-- expansion, so motion cannot live only as a dropped Firestore top-level
-- field or as a new post_call.analysis v1 key (that shape is frozen).
-- ============================================================================

ALTER TABLE post_call
    ADD COLUMN IF NOT EXISTS se_motion text NOT NULL DEFAULT 'new_business';

ALTER TABLE post_call
    DROP CONSTRAINT IF EXISTS chk_post_call_se_motion,
    ADD CONSTRAINT chk_post_call_se_motion
        CHECK (se_motion IN ('new_business', 'expansion'));

COMMENT ON COLUMN post_call.se_motion IS
    'QIP catalog motion (new_business | expansion). Distinct from deal.type.';

ALTER TABLE scorecard
    ADD COLUMN IF NOT EXISTS se_motion text NOT NULL DEFAULT 'new_business';

ALTER TABLE scorecard
    DROP CONSTRAINT IF EXISTS chk_scorecard_se_motion,
    ADD CONSTRAINT chk_scorecard_se_motion
        CHECK (se_motion IN ('new_business', 'expansion'));

COMMENT ON COLUMN scorecard.se_motion IS
    'QIP catalog motion stamped on the scorecard (new_business | expansion).';
