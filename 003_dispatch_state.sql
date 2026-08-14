-- Owner: Agent 2 (mesh-disp-2)
-- Goal Dispatcher state table.
-- Non-breaking: CREATE IF NOT EXISTS only; safe to re-run.

CREATE TABLE IF NOT EXISTS goal_dispatch_state (
    goal_id          INTEGER PRIMARY KEY REFERENCES gideon_goals(id) ON DELETE CASCADE,
    attempts         INTEGER NOT NULL DEFAULT 0,
    max_attempts     INTEGER NOT NULL DEFAULT 3,
    last_attempt_at  TEXT,
    dispatched_at    TEXT,
    last_status      TEXT CHECK (last_status IN ('pending','success','failed','error')),
    last_result_file TEXT,
    last_error       TEXT,
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gds_status ON goal_dispatch_state(last_status);
CREATE INDEX IF NOT EXISTS idx_gds_goal   ON goal_dispatch_state(goal_id);
