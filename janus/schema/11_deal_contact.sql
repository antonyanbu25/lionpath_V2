-- ============================================================================
-- Janus Data Model - Phase B Extension: deal_contact junction + outbox seed
-- ADR-007 section 1: dealContacts is live behavior (createDealContact /
-- setPrimaryDealContact / removeDealContact in worker/src/routes.ts) and has
-- no v9.3 table. This is the Salesforce OpportunityContactRole equivalent.
--
-- Also seeds the 'firestore_projection' integration row that sync_outbox
-- requires (integration_id NOT NULL) for the dual-write projector.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Table: deal_contact
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_contact (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id text UNIQUE NOT NULL,
    deal_id bigint NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
    contact_id bigint NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
    role text,                    -- champion | economic_buyer | influencer | ...
    is_primary boolean NOT NULL DEFAULT false,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_deal_contact UNIQUE (deal_id, contact_id)
);

-- One primary contact per deal (soft-deleted rows excluded).
CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_contact_primary
    ON deal_contact(deal_id) WHERE is_primary AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_deal_contact_contact ON deal_contact(contact_id);

-- RLS mirrors deal: readable within the org subtree, writable by deal owner.
ALTER TABLE deal_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_contact FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_contact_team_read ON deal_contact;
CREATE POLICY deal_contact_team_read ON deal_contact
    FOR SELECT
    USING (
        is_admin() OR
        (
            current_org_path() IS NOT NULL AND
            EXISTS (
                SELECT 1 FROM deal d
                JOIN org_unit ou ON ou.id = d.org_unit_id
                WHERE d.id = deal_contact.deal_id
                  AND ou.path LIKE current_org_path() || '%'
            )
        )
    );

DROP POLICY IF EXISTS deal_contact_owner_write ON deal_contact;
CREATE POLICY deal_contact_owner_write ON deal_contact
    FOR ALL
    USING (
        is_admin() OR
        EXISTS (
            SELECT 1 FROM deal d
            WHERE d.id = deal_contact.deal_id
              AND d.owner_user_id = current_user_id()
        )
    )
    WITH CHECK (
        is_admin() OR
        EXISTS (
            SELECT 1 FROM deal d
            WHERE d.id = deal_contact.deal_id
              AND d.owner_user_id = current_user_id()
        )
    );

-- ----------------------------------------------------------------------------
-- Firestore projection integration (dual-write outbox target)
-- Enum value added in 10b_integration_enum.sql (separate transaction).
-- ----------------------------------------------------------------------------
INSERT INTO integration (public_id, provider, display_name, auth_type, credentials_ref, config, status)
VALUES (
    'int_firestore_projection',
    'firestore_projection',
    'Firestore legacy read projection (dual-write transition)',
    'api_key',
    'secret://firebase-service-account',
    '{"purpose":"dual-write projection; retire after cutover"}'::jsonb,
    'active'
)
ON CONFLICT (public_id) DO NOTHING;
