-- ============================================================================
-- Janus Data Model - Phase A Extension: ID Registry
-- Design A: every Firestore FK is a string id (deal_*, usr_*, ...); every SQL
-- FK is bigint with the string parked in public_id. id_registry is the
-- transactional bridge used by dual-write and backfill to resolve
-- public_id <-> internal bigint id in the same transaction as the row insert.
-- ============================================================================

CREATE TABLE IF NOT EXISTS id_registry (
    entity_type text NOT NULL,   -- 'org_unit' | 'app_user' | 'account' | 'contact' | 'deal' | 'activity' | ...
    public_id text NOT NULL,     -- Firestore-era string id, e.g. 'deal_abc123'
    internal_id bigint NOT NULL, -- SQL identity PK of the row
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (entity_type, public_id),
    CONSTRAINT uq_id_registry_internal UNIQUE (entity_type, internal_id)
);

CREATE INDEX IF NOT EXISTS idx_id_registry_internal
    ON id_registry(entity_type, internal_id);

-- Resolve a public_id to an internal id. Returns NULL when unmapped; callers
-- must treat NULL as "entity not yet migrated" and fail loudly, never guess.
CREATE OR REPLACE FUNCTION resolve_internal_id(p_entity_type text, p_public_id text)
RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT internal_id FROM id_registry
    WHERE entity_type = p_entity_type AND public_id = p_public_id;
$$;

-- Register a mapping. Idempotent: re-running a backfill is a no-op.
CREATE OR REPLACE FUNCTION register_id(p_entity_type text, p_public_id text, p_internal_id bigint)
RETURNS void
LANGUAGE sql AS $$
    INSERT INTO id_registry (entity_type, public_id, internal_id)
    VALUES (p_entity_type, p_public_id, p_internal_id)
    ON CONFLICT (entity_type, public_id) DO NOTHING;
$$;
