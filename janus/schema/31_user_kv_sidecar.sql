-- ============================================================================
-- Janus Data Model - Phase I: user_kv recovery sidecars
--
-- Browser recovery upload stores non-history localStorage payloads through the
-- HistoryBackend contract. In SQL-only mode that backend is Postgres, so these
-- sidecars need a PG-native home on the existing per-user KV row.
--
-- Idempotent. Run after 30_fallback_telemetry.sql.
-- ============================================================================

ALTER TABLE user_kv ADD COLUMN IF NOT EXISTS sidecar jsonb;
