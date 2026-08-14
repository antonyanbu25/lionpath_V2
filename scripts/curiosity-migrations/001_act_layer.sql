-- Owner: Agent 1
-- ACT layer schema for Gideon curiosity.

CREATE TABLE IF NOT EXISTS curiosity_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brief_id TEXT NOT NULL,
  proposed_at TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('AUTO_ACT','HUMAN_REQUIRED','BLOCK')),
  primitive TEXT NOT NULL,
  target TEXT,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','executing','done','failed','blocked')),
  executed_at TEXT,
  verified_at TEXT,
  outcome TEXT,
  verification_payload TEXT,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS curiosity_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id INTEGER NOT NULL REFERENCES curiosity_actions(id),
  event_type TEXT NOT NULL,
  at TEXT NOT NULL,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS curiosity_delegated_tasks (
  task_id TEXT PRIMARY KEY,
  brief_id TEXT,
  task_spec TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','dispatched','accepted','running','done','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS curiosity_triggers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_type TEXT NOT NULL,
  ref_id TEXT,
  payload TEXT,
  fired_at TEXT NOT NULL,
  consumed INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_actions_brief ON curiosity_actions(brief_id);
CREATE INDEX IF NOT EXISTS idx_actions_status ON curiosity_actions(status);
CREATE INDEX IF NOT EXISTS idx_actions_class ON curiosity_actions(classification);
CREATE INDEX IF NOT EXISTS idx_action_log_aid ON curiosity_action_log(action_id);
