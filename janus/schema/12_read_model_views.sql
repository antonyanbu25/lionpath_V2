-- ============================================================================
-- Janus Data Model - Phase D Extension: Read-model views
-- ADR-007 section 5: teamMetrics / orgMetrics / dealTraction / accountRollup /
-- seLaunchpad were write-time Firestore rollups maintained by
-- worker/src/data/read-models/. In SQL they become views over the typed
-- tables. Start as plain views; promote to materialized views with scheduled
-- refresh only if dashboard latency demands it.
-- ============================================================================

-- Team metrics: per-org-unit activity + score aggregates (replaces teamMetrics)
CREATE OR REPLACE VIEW v_team_metrics WITH (security_invoker = true) AS
SELECT
    d.org_unit_id,
    count(DISTINCT d.id) FILTER (WHERE d.status = 'active') AS active_deals,
    count(DISTINCT d.id) FILTER (WHERE d.status = 'won') AS won_deals,
    count(DISTINCT a.id) FILTER (WHERE a.activity_type = 'call') AS calls,
    count(DISTINCT a.id) FILTER (WHERE a.activity_type = 'meeting') AS meetings,
    avg(s.composite_score) FILTER (WHERE s.is_current) AS avg_composite_score,
    max(a.occurred_at) AS last_activity_at
FROM deal d
LEFT JOIN activity a ON a.org_unit_id = d.org_unit_id AND a.deleted_at IS NULL
LEFT JOIN scorecard s ON s.activity_id = a.id
WHERE d.deleted_at IS NULL
GROUP BY d.org_unit_id;

-- Org rollup: team metrics rolled up the org_unit hierarchy (replaces orgMetrics)
CREATE OR REPLACE VIEW v_org_metrics WITH (security_invoker = true) AS
SELECT
    ou.id AS org_unit_id,
    ou.name,
    ou.unit_type,
    count(DISTINCT d.id) FILTER (WHERE d.status = 'active') AS active_deals,
    coalesce(sum(d.amount) FILTER (WHERE d.status = 'active'), 0) AS pipeline_amount,
    count(DISTINCT a.id) AS activities
FROM org_unit ou
LEFT JOIN deal d ON d.org_unit_id = ou.id AND d.deleted_at IS NULL
LEFT JOIN activity a ON a.org_unit_id = ou.id AND a.deleted_at IS NULL
GROUP BY ou.id, ou.name, ou.unit_type;

-- Deal traction: per-deal engagement signals (replaces dealTraction)
CREATE OR REPLACE VIEW v_deal_traction WITH (security_invoker = true) AS
SELECT
    d.id AS deal_id,
    d.public_id AS deal_public_id,
    d.org_unit_id,
    d.stage,
    d.status,
    count(a.id) FILTER (WHERE a.activity_type = 'call') AS call_count,
    count(a.id) FILTER (WHERE a.activity_type = 'meeting') AS meeting_count,
    max(a.occurred_at) AS last_activity_at,
    (SELECT s.composite_score FROM scorecard s
      WHERE s.activity_id IN (SELECT id FROM activity WHERE deal_id = d.id)
        AND s.is_current
      ORDER BY s.created_at DESC LIMIT 1) AS latest_quality_score,
    (SELECT count(*) FROM deal_stage_history h WHERE h.deal_id = d.id) AS stage_changes
FROM deal d
LEFT JOIN activity a ON a.deal_id = d.id AND a.deleted_at IS NULL
WHERE d.deleted_at IS NULL
GROUP BY d.id, d.public_id, d.org_unit_id, d.stage, d.status;

-- Account rollup: per-account aggregates (replaces accountRollup)
CREATE OR REPLACE VIEW v_account_rollup WITH (security_invoker = true) AS
SELECT
    acc.id AS account_id,
    acc.public_id AS account_public_id,
    acc.name,
    count(DISTINCT d.id) FILTER (WHERE d.status = 'active') AS active_deals,
    count(DISTINCT d.id) AS total_deals,
    coalesce(sum(d.amount) FILTER (WHERE d.status = 'active'), 0) AS open_pipeline,
    count(DISTINCT c.id) AS contacts,
    max(a.occurred_at) AS last_activity_at
FROM account acc
LEFT JOIN deal d ON d.account_id = acc.id AND d.deleted_at IS NULL
LEFT JOIN contact c ON c.account_id = acc.id AND c.deleted_at IS NULL
LEFT JOIN activity a ON a.account_id = acc.id AND a.deleted_at IS NULL
WHERE acc.deleted_at IS NULL
GROUP BY acc.id, acc.public_id, acc.name;

-- SE launchpad: per-SE personal metrics (replaces seLaunchpad)
CREATE OR REPLACE VIEW v_se_launchpad WITH (security_invoker = true) AS
SELECT
    u.id AS user_id,
    u.public_id AS user_public_id,
    u.org_unit_id,
    count(DISTINCT d.id) FILTER (WHERE d.status = 'active') AS my_active_deals,
    count(DISTINCT a.id) FILTER (
        WHERE a.occurred_at >= now() - interval '7 days'
    ) AS activities_last_7d,
    avg(s.composite_score) FILTER (
        WHERE s.is_current AND s.created_at >= now() - interval '30 days'
    ) AS avg_score_last_30d,
    (SELECT count(*) FROM coaching_focus cf
      WHERE cf.se_user_id = u.id AND cf.status = 'active' AND cf.deleted_at IS NULL
    ) AS active_coaching_focus
FROM app_user u
LEFT JOIN deal d ON d.owner_user_id = u.id AND d.deleted_at IS NULL
LEFT JOIN activity a ON a.owner_user_id = u.id AND a.deleted_at IS NULL
LEFT JOIN scorecard s ON s.owner_user_id = u.id
WHERE u.status = 'active' AND u.deleted_at IS NULL
GROUP BY u.id, u.public_id, u.org_unit_id;

-- Views are readable by the app role (RLS on base tables still applies per-user).
GRANT SELECT ON v_team_metrics TO janus_app, janus_readonly;
GRANT SELECT ON v_org_metrics TO janus_app, janus_readonly;
GRANT SELECT ON v_deal_traction TO janus_app, janus_readonly;
GRANT SELECT ON v_account_rollup TO janus_app, janus_readonly;
GRANT SELECT ON v_se_launchpad TO janus_app, janus_readonly;
