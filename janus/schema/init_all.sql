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
\ir 19_se_motion.sql
\ir 20_history_tasks_feedback.sql

-- Phase H extensions (data model mapped to functionality; see
-- docs/datamodel/BUILD_PLAN.md). 24b carries the enum ADD VALUEs that
-- 25 references, and must run before it.
\ir 21_identity_relationships.sql
\ir 22_scoring_reshape.sql
\ir 23_call_participant.sql
\ir 24_task_write_path.sql
\ir 24b_audit_notification_enums.sql
\ir 25_audit_and_notifications.sql
\ir 26_account_se_team.sql
\ir 27_pricing_books.sql
\ir 28_roadmap_gaps.sql
\ir 29_precall_deal_required.sql
\ir 30_fallback_telemetry.sql
\ir 31_user_kv_sidecar.sql
\ir 31_remaining_collections.sql
\ir 32_deal_closed_won.sql
\ir 33_user_usage.sql
\ir 34_usage_and_leaderboard_views.sql
\ir 35_fix_account_rls_recursion.sql
\ir 36_add_research_deal_stage.sql
\ir 37_fallback_correlation.sql
\ir 38_ai_run_call_attribution.sql
\ir 39_revoke_redact_pii_execute.sql
