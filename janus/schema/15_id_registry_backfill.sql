-- id_registry backfill (Phase E)
-- Ensures every seeded/migrated parent row has a public_id -> internal_id
-- mapping in id_registry. Without this, resolveInternalId() throws
-- "no mapping for <entity>/<public_id> — migrate the parent first" and the
-- worker's domain-write returns HTTP 500 instead of landing in Postgres.
-- This was the root cause of prep/post-call dual-write silently failing.
--
-- Order matters (parents before children). All inserts are idempotent.

-- app_user (parents first). NOTE: org_unit uses a text id (e.g. 'team_nikil')
-- stored directly in FK columns, NOT via id_registry — so org_unit is excluded.
INSERT INTO id_registry (entity_type, public_id, internal_id)
SELECT 'app_user', u.public_id, u.id
FROM app_user u
WHERE u.deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- Child rows
INSERT INTO id_registry (entity_type, public_id, internal_id)
SELECT 'account', a.public_id, a.id
FROM account a
ON CONFLICT DO NOTHING;

INSERT INTO id_registry (entity_type, public_id, internal_id)
SELECT 'deal', d.public_id, d.id
FROM deal d
ON CONFLICT DO NOTHING;

INSERT INTO id_registry (entity_type, public_id, internal_id)
SELECT 'contact', c.public_id, c.id
FROM contact c
ON CONFLICT DO NOTHING;

INSERT INTO id_registry (entity_type, public_id, internal_id)
SELECT 'activity', a.public_id, a.id
FROM activity a
ON CONFLICT DO NOTHING;

INSERT INTO id_registry (entity_type, public_id, internal_id)
SELECT 'pre_call', p.public_id, p.id
FROM pre_call p
ON CONFLICT DO NOTHING;

INSERT INTO id_registry (entity_type, public_id, internal_id)
SELECT 'post_call', p.public_id, p.id
FROM post_call p
ON CONFLICT DO NOTHING;

