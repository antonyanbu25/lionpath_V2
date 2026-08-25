-- ============================================================================
-- Janus Data Model - Phase F Extension: ai_run telemetry columns
-- Adds the columns that let ai_run replace the Firestore llmUsage stream for
-- cost modelling without regressing it: cached_tokens (Gemini cached-content
-- pricing), grounding_queries, cache_hit, retry_count, user_id, pass_name
-- (free-text superset of run_type_enum), and error_code for failed/billed
-- runs. Also makes run_type nullable (best-effort enum mapping must never
-- violate the constraint) and adds the cost-query indexes.
--
-- Fresh installs get these columns from 03_phase3_ai_pipeline.sql directly;
-- this file is the idempotent ALTER for existing installs. Run after
-- 10c_run_type_enum_widen.sql (error_code_enum is created in 00).
-- ============================================================================

-- run_type: was NOT NULL — make nullable so best-effort passName->enum
-- mapping can leave it NULL instead of forcing a wrong value.
ALTER TABLE ai_run ALTER COLUMN run_type DROP NOT NULL;

-- Telemetry columns (mirror the Firestore llmUsage doc shape).
ALTER TABLE ai_run ADD COLUMN IF NOT EXISTS pass_name text;
ALTER TABLE ai_run ADD COLUMN IF NOT EXISTS cached_tokens int NOT NULL DEFAULT 0;
ALTER TABLE ai_run ADD COLUMN IF NOT EXISTS grounding_queries int NOT NULL DEFAULT 0;
ALTER TABLE ai_run ADD COLUMN IF NOT EXISTS cache_hit boolean NOT NULL DEFAULT false;
ALTER TABLE ai_run ADD COLUMN IF NOT EXISTS retry_count int NOT NULL DEFAULT 0;
ALTER TABLE ai_run ADD COLUMN IF NOT EXISTS user_id bigint REFERENCES app_user(id) ON DELETE SET NULL;
ALTER TABLE ai_run ADD COLUMN IF NOT EXISTS error_code error_code_enum;

-- Cost-query indexes (idx_ai_run_activity_created / idx_ai_run_created_model
-- already exist from 03; these add per-user, per-run-type, and per-model cuts).
CREATE INDEX IF NOT EXISTS idx_ai_run_user_created ON ai_run(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_run_run_type_created ON ai_run(run_type, created_at) WHERE run_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_run_model_created ON ai_run(model, created_at);

-- Append-only: the app role may INSERT/SELECT, never UPDATE/DELETE.
-- (07_grants.sql broad-grants DML; re-revoke here to keep ai_run immutable.)
REVOKE UPDATE, DELETE ON ai_run FROM janus_app;