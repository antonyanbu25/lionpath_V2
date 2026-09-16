-- ----------------------------------------------------------------------------
-- 38 — make ai_run attributable to the call that produced it (P9 / J-019)
--
-- J-019 recorded that only 4 of 2816 ai_run rows carry an activity_id, and the
-- audit's own prompt (P-B2) inferred the cause was that the call id was not
-- available at the recordLlmUsage sites. That inference is WRONG, and this
-- migration exists because the real cause is an ordering constraint that no
-- amount of plumbing at the call sites can fix:
--
--   1. POST /api/analyze-call runs every LLM pass and calls recordLlmUsage.
--      handleAnalyzeCall writes NO activity row — it computes and returns.
--   2. The client later saves, and only THEN does POST /api/history (or
--      upsertPostCallWithSummary) create activity with public_id act_<callId>.
--
-- So insertAiRun resolves `act_${callId}` against an activity row that does not
-- exist yet, every time. It correctly returns NULL rather than failing. The 4
-- rows that did resolve are re-analyses of an already-saved call — the only
-- ordering in which the lookup can succeed.
--
-- The callId itself IS available and IS passed (postcall/*.ts set it on the
-- LlmRequest; providers/index.ts forwards req.callId). It was simply discarded
-- on the floor once activity resolution failed, because ai_run had nowhere to
-- put it. That is what this migration fixes.
--
-- WHY A COLUMN AND A VIEW RATHER THAN A BACKFILL TRIGGER
--
-- The obvious shape is a trigger on activity INSERT that back-stamps
-- activity_id onto the waiting ai_run rows. That is deliberately NOT done here:
-- 18_ai_run_rls.sql ends with
--
--     REVOKE UPDATE, DELETE ON ai_run FROM janus_app;
--
-- ai_run is append-only BY DESIGN, and the table is additionally under FORCE
-- ROW LEVEL SECURITY. Back-stamping would require either re-granting UPDATE to
-- the worker role or a SECURITY DEFINER escape hatch, and both weaken a
-- deliberate immutability guarantee on the table that holds cost data. An
-- append-only table is worth more than a denormalised FK.
--
-- Instead: record the raw call id at insert (append-only, no UPDATE ever), and
-- resolve attribution at READ time through a view. Attribution then works in
-- both orderings and needs no second write.
--
-- Additive and idempotent: the column is nullable, existing rows keep their
-- meaning, and nothing that currently reads ai_run needs to change.
-- ----------------------------------------------------------------------------

-- The post_call/pre_call public_id this run was executed for, exactly as the
-- pipeline supplied it — NOT the act_ prefixed activity public_id, and NOT a
-- foreign key. It is deliberately unconstrained: a cost row must survive the
-- call it describes never being saved, which is precisely the case J-019 hid.
ALTER TABLE ai_run
    ADD COLUMN IF NOT EXISTS call_public_id text;

COMMENT ON COLUMN ai_run.call_public_id IS
    'Raw post_call/pre_call public_id supplied by the pipeline, recorded at insert. '
    'Attribution to activity is resolved at read time via v_ai_run_attributed, '
    'because the activity row does not exist yet when the LLM passes run. '
    'Unconstrained on purpose: an abandoned analysis still costs money.';

-- Partial: the pre-migration rows are all NULL here and will never be
-- attributable, so there is no reason to index them.
CREATE INDEX IF NOT EXISTS idx_ai_run_call_public_id
    ON ai_run (call_public_id)
    WHERE call_public_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- The attribution surface.
--
-- activity_id is kept as-is and preferred when present, so a row that DID
-- resolve at insert time keeps its stored FK. Everything else resolves through
-- call_public_id. attribution_source makes it explicit which happened, so a
-- cost query can never silently mistake "unattributable" for "free".
--
-- security_invoker = true so ai_run's owner-scoped RLS (18_ai_run_rls.sql)
-- still applies through the view — without it the view would run with the
-- owner's rights and leak every user's token spend, which is the exact defect
-- 18_ai_run_rls.sql was written to close.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_ai_run_attributed WITH (security_invoker = true) AS
SELECT
    ar.id,
    COALESCE(ar.activity_id, a.id)      AS activity_id,
    CASE
        WHEN ar.activity_id IS NOT NULL THEN 'stored'
        WHEN a.id IS NOT NULL           THEN 'resolved'
        WHEN ar.call_public_id IS NOT NULL THEN 'unsaved_call'
        ELSE 'no_call_id'
    END                                 AS attribution_source,
    ar.call_public_id,
    ar.run_type,
    ar.pass_name,
    ar.model,
    ar.input_tokens,
    ar.output_tokens,
    ar.cached_tokens,
    ar.grounding_queries,
    ar.cache_hit,
    ar.retry_count,
    ar.user_id,
    ar.cost_usd,
    ar.latency_ms,
    ar.error_code,
    ar.created_at
FROM ai_run ar
LEFT JOIN activity a
       ON ar.activity_id IS NULL
      AND ar.call_public_id IS NOT NULL
      AND a.public_id = 'act_' || ar.call_public_id;

COMMENT ON VIEW v_ai_run_attributed IS
    'ai_run with call attribution resolved at read time (P9/J-019). Prefer the '
    'stored activity_id; otherwise join activity on act_<call_public_id>. '
    'attribution_source distinguishes stored / resolved / unsaved_call / '
    'no_call_id so unattributable spend is never counted as zero.';

GRANT SELECT ON v_ai_run_attributed TO janus_app;
