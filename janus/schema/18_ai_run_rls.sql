-- ============================================================================
-- Janus Data Model - Phase G Extension: ai_run RLS + encryption posture docs
-- H3 fix from security review: ai_run had no RLS, so any janus_app query
-- could read every user's token usage and cost data. This adds owner-scoped
-- RLS: a user sees only their own ai_run rows; admin sees all; sentinel
-- (user_id IS NULL) rows are admin-only.
--
-- Encryption posture (documented per H3):
--   - Cloud SQL: encryption at rest is automatic (Google-managed keys).
--     CMEK is available but not currently configured — see
--     docs/SECURITY_REVIEW_RESOLUTION.md for the upgrade path.
--   - post_call.analysis / detail JSONB: stored in plaintext at the column
--     level. Contains call transcripts (the most sensitive PII in the
--     system). Disk-level encryption protects against physical theft but
--     not against H1 (direct connection with janus_app creds + set_config
--     bypass). Column-level encryption (pgcrypto) or GCS-only transcript
--     storage with CMEK is the production target.
--   - GCS call-payload bucket (se-singha-paathi-call-payloads): no KMS/CMEK
--     configured in call-payload-storage.ts. Production should enable
--     CMEK on the bucket.
-- ============================================================================

ALTER TABLE ai_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_run FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_run_owner_read ON ai_run;
CREATE POLICY ai_run_owner_read ON ai_run
    FOR SELECT
    USING (
        is_admin() OR
        user_id = current_user_id() OR
        (user_id IS NULL AND is_admin())
    );

-- Writes go through the system context (insertAiRun runs as the sentinel
-- with is_admin=true), so a FOR ALL policy that allows admin writes is
-- sufficient. Normal users never INSERT/UPDATE/DELETE ai_run directly.
DROP POLICY IF EXISTS ai_run_admin_write ON ai_run;
CREATE POLICY ai_run_admin_write ON ai_run
    FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- Append-only: re-revoke UPDATE/DELETE (07_grants.sql broad-grants DML,
-- this keeps ai_run immutable).
REVOKE UPDATE, DELETE ON ai_run FROM janus_app;