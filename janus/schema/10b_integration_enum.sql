-- ============================================================================
-- Janus Data Model - Phase B Extension: integration enum value
-- Postgres forbids using a new enum value in the same transaction that added
-- it. apply-janus-schema.mjs runs each file as one implicit transaction, so
-- this ADD VALUE must live in its own file, applied before 11_deal_contact.sql.
-- ============================================================================

ALTER TYPE integration_provider_enum ADD VALUE IF NOT EXISTS 'firestore_projection';
