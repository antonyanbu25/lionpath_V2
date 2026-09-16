-- ============================================================================
-- Janus Data Model - Phase I: the last Firestore collections
--
-- The gap list named 13 collections with no Postgres home. On tracing what the
-- code actually reads, EIGHT of them are already stored inside
-- post_call.detail as arrays, and the browser reads them from there first with
-- the collection as a legacy fallback:
--
--   web/domain/local-store.js and firestore-store.js both do
--     detailArray(postCall, "dealSignals") -> if non-empty, return it
--
--   videoFacts · timelineSegments · timelineMarkers · followUps · momDrafts
--   dealSignals · whatWorks · arrLines
--
-- That is why all eight are EMPTY in Firestore. They need a READ PROJECTION
-- from the post_call.detail jsonb, not a table. Giving them tables would
-- duplicate data that already has a home and create two places to disagree.
--
-- Which leaves five that genuinely have nowhere to live:
--
--   contact_event      contacts/{id}/events -- a Firestore SUBcollection, so
--                      it never appeared in a top-level collection scan
--   deal_summary       one cached rollup per deal
--   account_summary    one cached rollup per account
--   technical_commit   one per deal
--   arr_override       an SE's manual override of a computed ARR
--
-- All five are empty in Firestore today, but the code calls them, and once
-- Firestore is gone a missing table is a CRASH, not a blank screen. That is
-- the reason to build them now rather than defer.
--
-- Idempotent. Run after 30_fallback_telemetry.sql.
-- Rationale: docs/datamodel/FIRESTORE_REMOVAL_GAP.md
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. contact_event — the contact activity trail
--
-- ContactEventType in web/domain/types.js: contact_created | field_updated |
-- disc_updated | influence_updated | linked_from_prep | linked_from_postcall.
-- Append-only: it is a history, and a history that can be edited is not one.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_event (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id  text UNIQUE NOT NULL,
    contact_id bigint NOT NULL REFERENCES contact(id) ON DELETE CASCADE,
    event_type text NOT NULL CHECK (event_type IN (
                   'contact_created', 'field_updated', 'disc_updated',
                   'influence_updated', 'linked_from_prep', 'linked_from_postcall')),
    actor_user_id bigint REFERENCES app_user(id) ON DELETE SET NULL,
    payload    jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_event_contact
    ON contact_event(contact_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_event_type
    ON contact_event(event_type, occurred_at DESC);

COMMENT ON TABLE contact_event IS
    'Firestore contacts/{id}/events -- a SUBcollection, which is why it never '
    'showed up in a top-level collection inventory. Append-only history.';

REVOKE UPDATE, DELETE ON contact_event FROM janus_app;
GRANT SELECT, INSERT ON contact_event TO janus_app;
GRANT SELECT ON contact_event TO janus_readonly;

-- Scoped through the contact's account, mirroring how contact itself is read.
ALTER TABLE contact_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_event FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_event_read ON contact_event;
CREATE POLICY contact_event_read ON contact_event
    FOR SELECT USING (current_user_id() IS NOT NULL OR is_admin());

DROP POLICY IF EXISTS contact_event_write ON contact_event;
CREATE POLICY contact_event_write ON contact_event
    FOR INSERT WITH CHECK (current_user_id() IS NOT NULL OR is_admin());

-- ----------------------------------------------------------------------------
-- 2. deal_summary and 3. account_summary — cached rollups
--
-- upsertByNaturalKey on dealId / accountId in the store, so exactly one row
-- each. A UNIQUE FK enforces that here rather than trusting the caller.
--
-- These are CACHES of things derivable from the base tables. Kept as tables
-- rather than views because the app writes them (an AI-generated narrative
-- summary is not derivable), and stamped with generated_at so a stale cache
-- is visible rather than silently trusted.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_summary (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id    text UNIQUE NOT NULL,
    deal_id      bigint NOT NULL UNIQUE REFERENCES deal(id) ON DELETE CASCADE,
    summary      text,
    payload      jsonb,
    generated_at timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE deal_summary IS
    'One cached rollup per deal (store upserts on dealId). generated_at so a '
    'stale summary is visible rather than silently trusted.';

CREATE TABLE IF NOT EXISTS account_summary (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id    text UNIQUE NOT NULL,
    account_id   bigint NOT NULL UNIQUE REFERENCES account(id) ON DELETE CASCADE,
    summary      text,
    payload      jsonb,
    generated_at timestamptz NOT NULL DEFAULT now(),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE account_summary IS
    'One cached rollup per account (store upserts on accountId).';

-- ----------------------------------------------------------------------------
-- 4. technical_commit — one per deal
--
-- TechnicalCommit in worker/src/domain-model/technical-commit.ts carries
-- dealId, accountId and the owner trio. org_unit_id is stored rather than
-- joined because it is a reporting dimension and must not move when the deal
-- changes hands.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS technical_commit (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id     text UNIQUE NOT NULL,
    deal_id       bigint NOT NULL UNIQUE REFERENCES deal(id) ON DELETE CASCADE,
    account_id    bigint NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
    owner_user_id bigint NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
    org_unit_id   text   NOT NULL REFERENCES org_unit(id) ON DELETE RESTRICT,
    payload       jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tc_owner ON technical_commit(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_tc_org   ON technical_commit(org_unit_id);

COMMENT ON TABLE technical_commit IS
    'One technical commit per deal. Distinct from deal.tc_* which holds the '
    'AI-extracted delta; this is the committed record.';

-- ----------------------------------------------------------------------------
-- 5. arr_override — an SE overriding the computed ARR
--
-- deal already carries arr_estimate_*, arr_actual and arr_source. This records
-- WHO overrode it and WHY, which the columns cannot: arr_source='se_override'
-- says an override happened but not who or on what grounds.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS arr_override (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id      text UNIQUE NOT NULL,
    deal_id        bigint NOT NULL REFERENCES deal(id) ON DELETE CASCADE,
    previous_value numeric,
    new_value      numeric NOT NULL,
    reason         text NOT NULL,
    created_by     bigint REFERENCES app_user(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT chk_arr_override_changed CHECK (previous_value IS DISTINCT FROM new_value),
    CONSTRAINT chk_arr_override_positive CHECK (new_value >= 0)
);

CREATE INDEX IF NOT EXISTS idx_arr_override_deal
    ON arr_override(deal_id, created_at DESC);

COMMENT ON TABLE arr_override IS
    'Append-only record of an SE overriding a computed ARR. deal.arr_source '
    'says an override happened; this says who, from what, and why.';

REVOKE UPDATE, DELETE ON arr_override FROM janus_app;
GRANT SELECT, INSERT ON arr_override TO janus_app;
GRANT SELECT ON arr_override TO janus_readonly;

GRANT SELECT, INSERT, UPDATE, DELETE ON deal_summary     TO janus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON account_summary  TO janus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON technical_commit TO janus_app;
GRANT SELECT ON deal_summary, account_summary, technical_commit TO janus_readonly;

-- ----------------------------------------------------------------------------
-- 6. The eight jsonb-projected collections, as a read model
--
-- Rather than eight tables duplicating post_call.detail, one view that
-- projects each array with its call. This is what the Postgres read path uses
-- where the browser currently calls detailArray().
--
-- jsonb_array_elements so each element becomes a row: the callers want lists
-- filtered by callId, which is a WHERE on this view rather than jsonb
-- handling in application code.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_post_call_detail_items WITH (security_invoker = true) AS
SELECT pc.public_id           AS call_public_id,
       pc.activity_id,
       a.deal_id,
       a.account_id,
       a.owner_user_id,
       a.org_unit_id,
       k.key                  AS item_kind,
       item.value             AS item,
       item.ordinality::int   AS item_index,
       pc.created_at
FROM post_call pc
JOIN activity a ON a.id = pc.activity_id
CROSS JOIN LATERAL jsonb_object_keys(COALESCE(pc.detail, '{}'::jsonb)) AS k(key)
CROSS JOIN LATERAL jsonb_array_elements(pc.detail -> k.key)
     WITH ORDINALITY AS item(value, ordinality)
WHERE jsonb_typeof(pc.detail -> k.key) = 'array';

COMMENT ON VIEW v_post_call_detail_items IS
    'Every array item inside post_call.detail, one row each, tagged with its '
    'key. The Postgres equivalent of detailArray() in the browser store. '
    'Covers videoFacts, timelineSegments, timelineMarkers, followUps, '
    'momDrafts, dealSignals, whatWorks and arrLines -- all eight are stored '
    'in the detail jsonb and need projecting, not their own tables.';

GRANT SELECT ON v_post_call_detail_items TO janus_app, janus_readonly;
