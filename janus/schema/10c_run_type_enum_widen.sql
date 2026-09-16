-- ============================================================================
-- Janus Data Model - Phase A Extension: widen run_type_enum for ai_run telemetry
-- Postgres forbids using a new enum value in the same transaction that added
-- it. apply-janus-schema.mjs runs each file as one implicit transaction, so
-- these ADD VALUE statements live in their own file. PHASE_FILES applies this
-- after 03_phase3_ai_pipeline.sql (the enum exists by then — 00 creates it
-- with the original 5 values) and before 16_ai_run_telemetry.sql. Idempotent
-- on both fresh and existing installs via ADD VALUE IF NOT EXISTS.
--
-- The original v9.3 run_type_enum had 5 values (pre_call/analysis/detail/
-- scoring/signal_extract); the real worker passName set is wider
-- (embeddings/vision/transcript_infer/cluster_label/contact_enrich/
-- research_cache/other). ai_run.run_type is now nullable + best-effort, so a
-- missing mapping never violates the enum — but widening lets cost queries
-- group by the real pass instead of collapsing to NULL.
-- ============================================================================

ALTER TYPE run_type_enum ADD VALUE IF NOT EXISTS 'embeddings';
ALTER TYPE run_type_enum ADD VALUE IF NOT EXISTS 'vision';
ALTER TYPE run_type_enum ADD VALUE IF NOT EXISTS 'transcript_infer';
ALTER TYPE run_type_enum ADD VALUE IF NOT EXISTS 'cluster_label';
ALTER TYPE run_type_enum ADD VALUE IF NOT EXISTS 'contact_enrich';
ALTER TYPE run_type_enum ADD VALUE IF NOT EXISTS 'research_cache';
ALTER TYPE run_type_enum ADD VALUE IF NOT EXISTS 'other';