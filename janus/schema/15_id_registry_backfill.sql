-- id_registry backfill (Phase E)
-- Ensures every seeded/migrated parent row has a public_id -> internal_id
-- mapping in id_registry. Without this, resolveInternalId() throws
-- "no mapping for <entity>/<public_id> — migrate the parent first" and the
-- worker's domain-write returns HTTP 500 instead of landing in Postgres.
-- This was the root cause of prep/post-call dual-write silently failing.
--
-- Order matters (parents before children). All inserts are idempotent.

-- IMPORTANT: this file needs an admin session context.
--
-- account gained row-level security in 26_account_se_team.sql, and deal has
-- had it since 08. Both are declared FORCE ROW LEVEL SECURITY, which subjects
-- the table OWNER to the policies too -- and on managed Postgres the admin
-- role is not a superuser and does not carry rolbypassrls either. So a plain
-- `SELECT ... FROM account` run by the migration role returns ZERO rows, and
-- this backfill silently did nothing: no error, no mapping, and then every
-- dual-write failing with "no mapping for account/acc_...".
--
-- set_config with is_local => true scopes it to this file's implicit
-- transaction, so it resets on commit and leaks nothing.
SELECT set_config('app.is_admin', 'true', true);

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

