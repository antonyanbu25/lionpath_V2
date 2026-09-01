-- ============================================================================
-- Janus Data Model & Integration Spec (v9.3)
-- Master DDL Migration Script - All 38 Tables
-- ============================================================================

\ir 00_phase0_infra_and_org.sql
\ir 01_phase1_crm_core.sql
\ir 02_phase2_activities.sql
\ir 03_phase3_ai_pipeline.sql
\ir 04_phase4_scoring_rubrics.sql
\ir 05_phase5_product_coaching.sql
\ir 06_phase6_outbox_integrations_pii.sql

-- Phase A extensions (migration hardening)
\ir 07_grants.sql
\ir 08_rls_hardening.sql
\ir 09_id_registry.sql
\ir 10_shape_version.sql
\ir 10b_integration_enum.sql
\ir 10c_run_type_enum_widen.sql

-- Phase B extensions
\ir 11_deal_contact.sql

-- Phase D extensions
\ir 12_read_model_views.sql

-- Phase E extensions (RLS round 2, owner-write, id_registry backfill)
\ir 13_rls_hardening_round2.sql
\ir 14_rls_owner_write_calls.sql
\ir 15_id_registry_backfill.sql
\ir 16_ai_run_telemetry.sql
\ir 17_rls_role_defaults.sql
\ir 18_ai_run_rls.sql
\ir 19_history_tasks_feedback.sql
