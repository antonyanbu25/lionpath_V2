# Gideon Curiosity Loop — ACT Layer Implementation Plan

## 0. Reference Paths & Conventions

```
SCRIPT_DIR=~/.hermes/scripts/curiosity
DB=~/.hermes/db/gideon.db
CRON_DIR=~/.hermes/cron.d
EVENT_BUS=~/.hermes/run/event-bus
AGENT_RADIO=~/.hermes/scripts/agent-radio.sh
SKILL_MANAGE=~/.hermes/scripts/skill_manage.sh   (assumed; if different, swarm agent 3 confirms)
LIB_DIR=$SCRIPT_DIR/lib
```

Existing files (do not rewrite, only extend):
- `$SCRIPT_DIR/curiosity-daemon.sh`
- `$SCRIPT_DIR/curiosity-sense.sh`
- `$SCRIPT_DIR/curiosity-fetch.sh`
- `$SCRIPT_DIR/curiosity-synthesize.py`
- `$SCRIPT_DIR/curiosity-surface.sh`
- `$SCRIPT_DIR/curiosity-feedback.py`

New files introduced by this plan:
- `$SCRIPT_DIR/curiosity-classify.py`        (Agent 2)
- `$SCRIPT_DIR/curiosity-act.sh`             (Agent 3)
- `$SCRIPT_DIR/curiosity-verify.sh`          (Agent 4)
- `$SCRIPT_DIR/lib/curiosity-act-primitives.sh`  (Agent 3)
- `$SCRIPT_DIR/lib/curiosity-risk-rules.json`    (Agent 2, derived from §3)
- `$SCRIPT_DIR/lib/curiosity-sense-queries.sql`   (Agent 5)
- `$SCRIPT_DIR/tests/test-act-loop.sh`            (Agent 6)

---

## 1. The Act Layer — Direct vs Observe

### 1.1 Current state (observe-only)

```
SENSE → DECIDE → FETCH → SYNTHESIZE → SURFACE → FEEDBACK → sleep
```

The loop writes briefs, updates memory entries, and emits events. Every proposed change lives in a brief; a human must read the brief and execute. The loop is a passive observer of its own findings.

### 1.2 Target state (observe + direct)

```
SENSE → DECIDE → FETCH → SYNTHESIZE → SURFACE → FEEDBACK → CLASSIFY → ACT → VERIFY → sleep
                                                              ↑          ↑         ↑
                                                         risk-bucket  executes  confirms
```

- **Observe** = write a brief describing a gap and a proposed change.
- **Direct** = classify the proposed change by risk, execute low-risk changes autonomously, escalate high-risk changes to a human queue, and never execute blocked changes.

The loop now closes: a brief can produce a goal, the goal can drift, the drift produces a new brief, the new brief can produce an act, the act updates the goal's progress. No human in the inner loop for AUTO_ACT primitives.

### 1.3 Boundary rule

The ACT layer may only touch:
- Tables prefixed `curiosity_`
- The `memory` table (read + write, conservative patches only)
- The `gideon_goals` table (insert + progress updates only)
- The `gideon_events` table (insert only)
- Files under `$SCRIPT_DIR/` and `$CRON_DIR/curiosity-*`
- The agent-radio broadcast channel

Anything else requires `[AGENT_REQUIRES_APPROVAL]` and is routed to HUMAN_REQUIRED or BLOCK.

---

## 2. Curiosity Act Stages

### 2.1 Extended loop in `curiosity-daemon.sh`

Locate the loop body in `curiosity-daemon.sh`. After the existing `FEEDBACK` call, insert three new stages. The existing stages must remain untouched.

```bash
# --- FEEDBACK (existing) ---
log "FEEDBACK start"
python3 "$SCRIPT_DIR/curiosity-feedback.py" --brief-id "$BRIEF_ID" \
  || { log "FEEDBACK failed"; continue; }

# --- CLASSIFY (new) ---
log "CLASSIFY start"
python3 "$SCRIPT_DIR/curiosity-classify.py" --brief-id "$BRIEF_ID" \
  --rules "$LIB_DIR/curiosity-risk-rules.json" \
  --db "$DB" \
  || { log "CLASSIFY failed (non-fatal)"; }

# --- ACT (new) ---
log "ACT start"
bash "$SCRIPT_DIR/curiosity-act.sh" --brief-id "$BRIEF_ID" --db "$DB" \
  || { log "ACT failed (non-fatal)"; }

# --- VERIFY (new) ---
log "VERIFY start"
bash "$SCRIPT_DIR/curiosity-verify.sh" --brief-id "$BRIEF_ID" --db "$DB" \
  || { log "VERIFY failed (non-fatal)"; }

# --- sleep (existing) ---
sleep "$CYCLE_SLEEP_SECONDS"
```

All three new stages are non-fatal: a failure logs and continues. The observe/surface loop must never break because of an act-layer error.

### 2.2 CLASSIFY sub-stage

**File:** `$SCRIPT_DIR/curiosity-classify.py`
**Owner:** Agent 2
**Inputs:** `--brief-id`, `--rules` (JSON), `--db`
**Outputs:** rows inserted into `curiosity_actions` with `classification` set.

```python
#!/usr/bin/env python3
"""
curiosity-classify.py

Reads the proposed changes from the brief (curiosity_briefs.proposed_changes JSON),
classifies each into AUTO_ACT | HUMAN_REQUIRED | BLOCK using rule-based logic
plus a single conservative LLM call only when rules are ambiguous.

Writes one row per proposed change into curiosity_actions.
"""
import argparse, json, sqlite3, sys, subprocess, os
from pathlib import Path

def load_rules(path: str) -> dict:
    return json.loads(Path(path).read_text())

def classify_change(change: dict, rules: dict) -> tuple[str, str]:
    """
    Returns (classification, reason).
    Rule order: BLOCK > HUMAN_REQUIRED > AUTO_ACT.
    First matching rule wins.
    """
    primitive = change.get("primitive", "")
    target = change.get("target", "")
    tags = set(change.get("tags", []))

    # BLOCK rules
    if "AGENT_REQUIRES_APPROVAL" in tags and change.get("destructive"):
        return "BLOCK", "destructive action flagged in brief"
    if primitive in rules["block_primitives"]:
        return "BLOCK", f"primitive {primitive} is in block list"
    if any(t in target for t in rules["block_target_substrings"]):
        return "BLOCK", f"target matches block substring"

    # HUMAN_REQUIRED rules
    if "AGENT_REQUIRES_APPROVAL" in tags:
        return "HUMAN_REQUIRED", "brief tagged AGENT_REQUIRES_APPROVAL"
    if primitive in rules["human_required_primitives"]:
        return "HUMAN_REQUIRED", f"primitive {primitive} requires human"
    if change.get("creates_new", False):
        return "HUMAN_REQUIRED", "creates new resource"

    # AUTO_ACT rules
    if primitive in rules["auto_act_primitives"]:
        return "AUTO_ACT", f"primitive {primitive} is auto-actable"

    # Default: conservative
    return "HUMAN_REQUIRED", "no rule matched, defaulting to human"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--brief-id", required=True)
    ap.add_argument("--rules", required=True)
    ap.add_argument("--db", required=True)
    args = ap.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    row = conn.execute(
        "SELECT proposed_changes FROM curiosity_briefs WHERE brief_id = ?",
        (args.brief_id,)
    ).fetchone()
    if not row:
        print(f"no brief {args.brief_id}", file=sys.stderr)
        sys.exit(0)  # non-fatal

    changes = json.loads(row["proposed_changes"] or "[]")
    rules = load_rules(args.rules)

    for ch in changes:
        classification, reason = classify_change(ch, rules)
        conn.execute("""
            INSERT INTO curiosity_actions
              (brief_id, proposed_at, classification, primitive, target,
               payload, status, reason)
            VALUES (?, datetime('now'), ?, ?, ?, ?, 'proposed', ?)
        """, (
            args.brief_id,
            classification,
            ch.get("primitive", ""),
            ch.get("target", ""),
            json.dumps(ch, ensure_ascii=False),
            reason,
        ))
        # log
        action_id = conn.execute(
            "SELECT last_insert_rowid()"
        ).fetchone()[0]
        conn.execute("""
            INSERT INTO curiosity_action_log
              (action_id, event_type, at, detail)
            VALUES (?, 'classified', datetime('now'), ?)
        """, (action_id, f"{classification}: {reason}"))

    conn.commit()
    conn.close()

if __name__ == "__main__":
    main()
```

### 2.3 ACT stage

**File:** `$SCRIPT_DIR/curiosity-act.sh`
**Owner:** Agent 3
**Inputs:** `--brief-id`, `--db`
**Outputs:** executes AUTO_ACT actions, updates `curiosity_actions.status` to `done`|`failed`.

```bash
#!/usr/bin/env bash
# curiosity-act.sh
# Executes all AUTO_ACT actions for a brief. Skips HUMAN_REQUIRED and BLOCK.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="$SCRIPT_DIR/lib"
source "$LIB_DIR/curiosity-act-primitives.sh"

BRIEF_ID=""
DB=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --brief-id) BRIEF_ID="$2"; shift 2;;
    --db) DB="$2"; shift 2;;
    *) shift;;
  esac
done

[[ -z "$BRIEF_ID" || -z "$DB" ]] && { echo "usage: --brief-id --db"; exit 1; }

# Pull AUTO_ACT actions still in 'proposed'
mapfile -t ACTIONS < <(sqlite3 "$DB" \
  -cmd ".mode list" -cmd ".separator '|'" \
  "SELECT id, primitive, target, payload FROM curiosity_actions
   WHERE brief_id='$BRIEF_ID' AND classification='AUTO_ACT' AND status='proposed';")

for line in "${ACTIONS[@]}"; do
  IFS='|' read -r ACTION_ID PRIMITIVE TARGET PAYLOAD <<< "$line"

  # Mark executing
  sqlite3 "$DB" "UPDATE curiosity_actions SET status='executing', executed_at=datetime('now')
                 WHERE id=$ACTION_ID;"
  sqlite3 "$DB" "INSERT INTO curiosity_action_log(action_id, event_type, at, detail)
                 VALUES ($ACTION_ID, 'executing', datetime('now'), '$PRIMITIVE on $TARGET');"

  case "$PRIMITIVE" in
    memory_write)        act_memory_write "$DB" "$ACTION_ID" "$PAYLOAD" ;;
    skill_patch)         act_skill_patch  "$DB" "$ACTION_ID" "$PAYLOAD" ;;
    cron_create)         act_cron_create  "$DB" "$ACTION_ID" "$PAYLOAD" ;;   # should never be AUTO_ACT; safety
    delegate_task)       act_delegate_task "$DB" "$ACTION_ID" "$PAYLOAD" ;;
    radio_broadcast)     act_radio_broadcast "$DB" "$ACTION_ID" "$PAYLOAD" ;;
    goal_register)       act_goal_register "$DB" "$ACTION_ID" "$PAYLOAD" ;;
    event_emit)          act_event_emit   "$DB" "$ACTION_ID" "$PAYLOAD" ;;
    *) echo "unknown primitive $PRIMITIVE"; sqlite3 "$DB" \
       "UPDATE curiosity_actions SET status='failed', outcome='unknown_primitive' WHERE id=$ACTION_ID;";;
  esac
done
```

### 2.4 VERIFY sub-stage

**File:** `$SCRIPT_DIR/curiosity-verify.sh`
**Owner:** Agent 4
**Inputs:** `--brief-id`, `--db`
**Outputs:** sets `verified_at`, `outcome`, `verification_payload` on each action.

```bash
#!/usr/bin/env bash
# curiosity-verify.sh
# Confirms each executed action landed. Records outcome.

set -euo pipefail
DB=""
BRIEF_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --brief-id) BRIEF_ID="$2"; shift 2;;
    --db) DB="$2"; shift 2;;
    *) shift;;
  esac
done
[[ -z "$BRIEF_ID" || -z "$DB" ]] && { echo "usage: --brief-id --db"; exit 1; }

mapfile -t ACTIONS < <(sqlite3 "$DB" \
  -cmd ".mode list" -cmd ".separator '|'" \
  "SELECT id, primitive, target, payload, status FROM curiosity_actions
   WHERE brief_id='$BRIEF_ID' AND status='done';")

for line in "${ACTIONS[@]}"; do
  IFS='|' read -r AID PRIM TARGET PAYLOAD STATUS <<< "$line"
  OUTCOME="unknown"
  VERIFY_JSON="{}"

  case "$PRIM" in
    memory_write)
      # Check the memory row exists with the new content
      KEY=$(echo "$PAYLOAD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('key',''))")
      CNT=$(sqlite3 "$DB" "SELECT count(*) FROM memory WHERE key='$KEY';")
      [[ "$CNT" -ge 1 ]] && OUTCOME="success" || OUTCOME="failure"
      VERIFY_JSON="{\"key\":\"$KEY\",\"rows\":$CNT}"
      ;;
    skill_patch)
      FILE_PATH=$(echo "$PAYLOAD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('file',''))")
      [[ -f "$FILE_PATH" ]] && OUTCOME="success" || OUTCOME="failure"
      VERIFY_JSON="{\"file\":\"$FILE_PATH\",\"exists\":$([[ -f "$FILE_PATH" ]] && echo true || echo false)}"
      ;;
    cron_create)
      CRON_NAME=$(echo "$PAYLOAD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('name',''))")
      [[ -f "$CRON_DIR/curiosity-$CRON_NAME.sh" ]] && OUTCOME="success" || OUTCOME="failure"
      ;;
    delegate_task)
      # Check delegated task table for status
      TASK_ID=$(echo "$PAYLOAD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('task_id',''))")
      ST=$(sqlite3 "$DB" "SELECT status FROM curiosity_delegated_tasks WHERE task_id='$TASK_ID';")
      [[ "$ST" == "accepted" || "$ST" == "running" || "$ST" == "done" ]] && OUTCOME="success" || OUTCOME="pending"
      ;;
    radio_broadcast)
      # Always succeeds (fire-and-forget); verify event landed in gideon_events
      EVT_CNT=$(sqlite3 "$DB" "SELECT count(*) FROM gideon_events
                                WHERE topic='curiosity.act.broadcast' AND payload LIKE '%$BRIEF_ID%';")
      [[ "$EVT_CNT" -ge 1 ]] && OUTCOME="success" || OUTCOME="pending"
      ;;
    goal_register)
      GOAL_ID=$(echo "$PAYLOAD" | python3 -c "import sys,json;print(json.load(sys.stdin).get('goal_id',''))")
      CNT=$(sqlite3 "$DB" "SELECT count(*) FROM gideon_goals WHERE id=$GOAL_ID;")
      [[ "$CNT" -ge 1 ]] && OUTCOME="success" || OUTCOME="failure"
      ;;
    event_emit)
      OUTCOME="success"
      ;;
    *) OUTCOME="unknown_primitive";;
  esac

  sqlite3 "$DB" "UPDATE curiosity_actions
                   SET verified_at=datetime('now'),
                       outcome='$OUTCOME',
                       verification_payload='$VERIFY_JSON'
                 WHERE id=$AID;"
  sqlite3 "$DB" "INSERT INTO curiosity_action_log(action_id, event_type, at, detail)
                 VALUES ($AID, 'verified', datetime('now'), '$OUTCOME');"
done
```

---

## 3. Risk Taxonomy

### 3.1 AUTO_ACT (loop may execute without human)

| Primitive | Scope | Constraint |
|---|---|---|
| `memory_write` | `memory` table | Only UPDATE existing rows OR INSERT with new key. No DELETE. Max 5 rows/cycle. |
| `skill_patch` | existing skill content file | Only modifies files under `~/.hermes/skills/*/content/`. No new files. No structural files (manifest.json, skill.yaml). |
| `goal_register` | `gideon_goals` table | INSERT only, status='proposed'. Max 1 goal/cycle. |
| `radio_broadcast` | agent-radio | Topic must start with `curiosity.`. No commands, only notifications. |
| `event_emit` | `gideon_events` table | INSERT only. Topic must start with `curiosity.`. |
| `delegate_task` | delegate to subagent | Task spec must be read-only or AUTO_ACT-scoped. Subagent cannot escalate. |

### 3.2 HUMAN_REQUIRED (loop proposes, human approves via queue)

| Primitive | Scope | Why |
|---|---|---|
| `skill_create` | new skill directory | New resource, naming risk |
| `skill_patch` (structural) | manifest.json, skill.yaml | Changes skill identity |
| `cron_create` | new cron job | Persistent execution, scheduling risk |
| `systemd_create` | new systemd unit | Persistent execution |
| `table_alter` | non-curiosity tables | Schema risk |
| `external_api` | any HTTP call to non-local service | Network, secret, cost |
| `goal_activate` | promote goal from 'proposed' to 'active' | Commits the mesh to a goal |
| `delegate_task` (privileged) | subagent that may escalate | Privilege boundary |

### 3.3 BLOCK (never execute, log only)

| Primitive | Scope | Why |
|---|---|---|
| `agent_code_mutate` | any file under another agent's `scripts/` | Cross-agent boundary |
| `agent_code_mutate` (self) | any file under `$SCRIPT_DIR/` for this loop | Self-modification risk |
| `data_delete` | any DELETE statement | Destructive |
| `deploy_trigger` | any git push, systemctl restart (non-curiosity), deploy hook | Production risk |
| `config_mutate` | `~/.hermes/config/*`, systemd unit files | Config integrity |
| `budget_mutate` | changes to token/cycle limits | Self-dealing |

### 3.4 Rules file: `$SCRIPT_DIR/lib/curiosity-risk-rules.json`

```json
{
  "auto_act_primitives": [
    "memory_write",
    "skill_patch",
    "goal_register",
    "radio_broadcast",
    "event_emit",
    "delegate_task"
  ],
  "human_required_primitives": [
    "skill_create",
    "skill_patch_structural",
    "cron_create",
    "systemd_create",
    "table_alter",
    "external_api",
    "goal_activate",
    "delegate_task_privileged"
  ],
  "block_primitives": [
    "agent_code_mutate",
    "self_code_mutate",
    "data_delete",
    "deploy_trigger",
    "config_mutate",
    "budget_mutate"
  ],
  "block_target_substrings": [
    "/agents/",
    "/config/",
    "systemctl",
    "git push",
    "rm -rf",
    "DELETE FROM"
  ]
}
```

---

## 4. Actuation Primitives

**File:** `$SCRIPT_DIR/lib/curiosity-act-primitives.sh`
**Owner:** Agent 3

Each function:
1. Receives `$DB`, `$ACTION_ID`, `$PAYLOAD` (JSON string).
2. Executes the primitive.
3. Updates `curiosity_actions.status` to `done` or `failed` with `outcome`.
4. Inserts a `curiosity_action_log` row.

```bash
#!/usr/bin/env bash
# curiosity-act-primitives.sh
# Sourced by curiosity-act.sh. Each function executes one primitive.

source "$HOME/.hermes/scripts/agent-radio.sh" 2>/dev/null || true
AGENT_RADIO="${AGENT_RADIO:-$HOME/.hermes/scripts/agent-radio.sh}"
CRON_DIR="${CRON_DIR:-$HOME/.hermes/cron.d}"

_log_action() {
  local db="$1" aid="$2" etype="$3" detail="$4"
  sqlite3 "$db" "INSERT INTO curiosity_action_log(action_id, event_type, at, detail)
                 VALUES ($aid, '$etype', datetime('now'), '$detail');"
}

_set_status() {
  local db="$1" aid="$2" status="$3" outcome="$4"
  sqlite3 "$db" "UPDATE curiosity_actions SET status='$status', outcome='$outcome'
                 WHERE id=$aid;"
}

# --- 4.1 memory_write ---
act_memory_write() {
  local db="$1" aid="$2" payload="$3"
  local key val op
  key=$(echo "$payload" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('key',''))")
  val=$(echo "$payload" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('value',''))")
  op=$(echo "$payload" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('op','upsert'))")

  if [[ "$op" == "insert" ]]; then
    sqlite3 "$db" "INSERT INTO memory(key, value, updated_at) VALUES ('$key','$val',datetime('now'));"
  else
    sqlite3 "$db" "INSERT INTO memory(key, value, updated_at) VALUES ('$key','$val',datetime('now'))
                   ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now');"
  fi
  _set_status "$db" "$aid" "done" "success"
  _log_action "$db" "$aid" "executed" "memory_write $key"
}

# --- 4.2 skill_patch ---
act_skill_patch() {
  local db="$1" aid="$2" payload="$3"
  local skill file content file_path
  skill=$(echo "$payload" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('skill',''))")
  file=$(echo "$payload" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('file',''))")
  content=$(echo "$payload" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('content',''))")

  file_path="$HOME/.hermes/skills/$skill/content/$file"
  # Safety: only content dir, only existing files
  if [[ ! -f "$file_path" ]]; then
    _set_status "$db" "$aid" "failed" "file_not_found"
    _log_action "$db" "$aid" "failed" "$file_path does not exist (HUMAN_REQUIRED for new files)"
    return
  fi
  # Backup + write
  cp "$file_path" "${file_path}.bak.$(date +%s)"
  printf '%s' "$content" > "$file_path"
  _set_status "$db" "$aid" "done" "success"
  _log_action "$db" "$aid" "executed" "patched $file_path"
}

# --- 4.3 cron_create (HUMAN_REQUIRED by default; included for completeness) ---
act_cron_create() {
  local db="$1" aid="$2" payload="$3"
  # This should not be called as AUTO_ACT. If reached, fail safe.
  _set_status "$db" "$aid" "failed" "cron_create_requires_human"
  _log_action "$db" "$aid" "blocked" "cron_create must be HUMAN_REQUIRED"
}

# --- 4.4 delegate_task ---
act_delegate_task() {
  local db="$1" aid="$2" payload="$3"
  local task_spec task_id
  task_spec=$(echo "$payload" | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(d.get('task_spec',{})))")
  task_id="curio-$(date +%s)-$aid"
  sqlite3 "$db" "INSERT INTO curiosity_delegated_tasks(task_id, brief_id, task_spec, status, created_at)
                 VALUES ('$task_id',
                         (SELECT brief_id FROM curiosity_actions WHERE id=$aid),
                         '$(echo "$task_spec" | sed "s/'/''/g")',
                         'pending', datetime('now'));"
  bash "$AGENT_RADIO" delegate "$task_spec" 2>/dev/null || true
  sqlite3 "$db" "UPDATE curiosity_delegated_tasks SET status='dispatched' WHERE task_id='$task_id';"
  _set_status "$db" "$aid" "done" "dispatched"
  _log_action "$db" "$aid" "executed" "delegated task $task_id"
}

# --- 4.5 radio_broadcast ---
act_radio_broadcast() {
  local db="$1" aid="$2" payload="$3"
  local topic msg
  topic=$(echo "$payload" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('topic','curiosity.act.broadcast'))")
  msg=$(echo "$payload" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('message',''))")

  # Enforce curiosity.* topic prefix
  [[ "$topic" == curiosity.* ]] || topic="curiosity.act.broadcast"

  bash "$AGENT_RADIO" broadcast "$topic" "$msg" 2>/dev/null || true
  sqlite3 "$db" "INSERT INTO gideon_events(topic, payload, emitted_at)
                 VALUES ('$topic', '$(echo "$msg" | sed "s/'/''/g")', datetime('now'));"
  _set_status "$db" "$aid" "done" "success"
  _log_action "$db" "$aid" "executed" "broadcast $topic"
}

# --- 4.6 goal_register ---
act_goal_register() {
  local db="$1" aid="$2" payload="$3"
  local title desc source_brief
  title=$(echo "$payload" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('title',''))")
  desc=$(echo "$payload" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('description',''))")
  source_brief=$(echo "$payload" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('brief_id',''))")

  sqlite3 "$db" "INSERT INTO gideon_goals(title, description, source, status, created_at, last_progress_at)
                 VALUES ('$(echo "$title" | sed "s/'/''/g")',
                         '$(echo "$desc" | sed "s/'/''/g")',
                         'curiosity',
                         'proposed',
                         datetime('now'),
                         datetime('now'));"
  local goal_id
  goal_id=$(sqlite3 "$db" "SELECT last_insert_rowid();")
  # Stash goal_id back into payload for verify
  sqlite3 "$db" "UPDATE curiosity_actions SET payload=json_set(payload,'\$.goal_id',$goal_id) WHERE id=$aid;"
  _set_status "$db" "$aid" "done" "success"
  _log_action "$db" "$aid" "executed" "registered goal $goal_id"
}

# --- 4.7 event_emit ---
act_event_emit() {
  local db="$1" aid="$2" payload="$3"
  local topic payload_json
  topic=$(echo "$payload" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('topic','curiosity.event'))")
  payload_json=$(echo "$payload" | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps(d.get('payload',{})))")
  [[ "$topic" == curiosity.* ]] || topic="curiosity.event"
  sqlite3 "$db" "INSERT INTO gideon_events(topic, payload, emitted_at)
                 VALUES ('$topic', '$(echo "$payload_json" | sed "s/'/''/g")', datetime('now'));"
  _set_status "$db" "$aid" "done" "success"
}
```

---

## 5. The Self-Direction Loop

### 5.1 Closed loop

```
        ┌──────────────────────────────────────────────────────────────┐
        │                                                              │
        ▼                                                              │
   ┌─────────┐  brief  ┌──────────┐  actions  ┌─────┐  outcome  ┌────────┐
   │ SYNTH   │────────▶│ CLASSIFY │──────────▶│ ACT │──────────▶│ VERIFY │
   └─────────┘         └──────────┘           └─────┘           └────────┘
        ▲                     │ goal_register │                  │
        │                     └───────────────┼─▶ gideon_goals   │
        │                                     │   (status=proposed)
        │                                     │
   ┌─────────┐  T_GOAL_DRIFT   ┌─────────┐    │
   │  SENSE  │◀────────────────│ queries │◀───┘
   └─────────┘                 └─────────┘
        │
        │ fires T_GOAL_DRIFT if goal.last_progress_at < now - 3d
        │ fires T_CURIOSITY_FINDING if HUMAN_REQUIRED action stale > 1d
        ▼
   (next cycle DECIDE picks the trigger)
```

### 5.2 gideon_goals integration

**Schema additions** (Agent 1, see §7 DDL):

```sql
-- Ensure gideon_goals has the columns we need. Use PRAGMA check before ALTER.
-- Agent 1 will write a migration script that:
-- 1. PRAGMA table_info(gideon_goals)
-- 2. ALTER TABLE gideon_goals ADD COLUMN source TEXT DEFAULT 'manual';
-- 3. ALTER TABLE gideon_goals ADD COLUMN status TEXT DEFAULT 'active';
-- 4. ALTER TABLE gideon_goals ADD COLUMN last_progress_at TEXT;
-- 5. ALTER TABLE gideon_goals ADD COLUMN progress_log TEXT DEFAULT '[]';
```

**Goal lifecycle:**
1. `goal_register` (AUTO_ACT) inserts with `status='proposed'`, `source='curiosity'`.
2. Human (or future HUMAN_REQUIRED action) promotes to `status='active'`.
3. Each VERIFY that touches a goal updates `last_progress_at` and appends to `progress_log`.
4. SENSE fires `T_GOAL_DRIFT` when `status='active'` and `last_progress_at < now - 3 days`.
5. The new brief about goal drift can propose actions (delegate_task, memory_write, etc.) to advance the goal.

### 5.3 Loop closure example

Cycle 1:
- SENSE fires T_STALE_TOPIC on "rust async runtime"
- SYNTH proposes: "register goal to investigate rust async patterns"
- CLASSIFY: goal_register → AUTO_ACT
- ACT: inserts gideon_goals row, status='proposed'
- VERIFY: confirms row exists

Cycle 2 (human approves goal via a separate queue, not shown):
- goal status → 'active'

Cycle N+3 days:
- SENSE fires T_GOAL_DRIFT
- SYNTH proposes: "delegate a subagent to summarize rust async runtime tradeoffs"
- CLASSIFY: delegate_task → AUTO_ACT (read-only task)
- ACT: dispatches subagent via agent-radio
- VERIFY: confirms task accepted
- Goal's `last_progress_at` updated

---

## 6. Sense Integration — New Trigger Types

**File:** `$SCRIPT_DIR/curiosity-sense.sh` (extend)
**Owner:** Agent 5

### 6.1 New triggers

| Trigger | Condition | SQL probe |
|---|---|---|
| `T_GOAL_DRIFT` | `gideon_goals.status='active' AND last_progress_at < datetime('now','-3 days')` | see §6.2 |
| `T_CURIOSITY_FINDING` | `curiosity_actions.classification='HUMAN_REQUIRED' AND status='proposed' AND proposed_at < datetime('now','-1 day')` | see §6.2 |
| `T_ACTION_FAILED` | `curiosity_actions.outcome='failure' AND verified_at > datetime('now','-1 day')` | see §6.2 |

### 6.2 SQL probe file: `$SCRIPT_DIR/lib/curiosity-sense-queries.sql`

```sql
-- T_GOAL_DRIFT
SELECT 'T_GOAL_DRIFT' AS trigger, id AS goal_id, title
FROM gideon_goals
WHERE status='active'
  AND last_progress_at < datetime('now','-3 days')
LIMIT 5;

-- T_CURIOSITY_FINDING
SELECT 'T_CURIOSITY_FINDING' AS trigger, id AS action_id, brief_id, primitive, target
FROM curiosity_actions
WHERE classification='HUMAN_REQUIRED'
  AND status='proposed'
  AND proposed_at < datetime('now','-1 day')
LIMIT 5;

-- T_ACTION_FAILED
SELECT 'T_ACTION_FAILED' AS trigger, id AS action_id, brief_id, primitive, outcome
FROM curiosity_actions
WHERE outcome='failure'
  AND verified_at > datetime('now','-1 day')
LIMIT 5;
```

### 6.3 Changes to `curiosity-sense.sh`

Add a new function `sense_act_layer()` called from the main sense body. The function runs each query in `curiosity-sense-queries.sql` and emits trigger rows into `curiosity_triggers` (existing table) with the trigger name and a JSON payload referencing the goal_id / action_id.

```bash
# Append to curiosity-sense.sh
sense_act_layer() {
  local db="$1"
  local queries="$LIB_DIR/curiosity-sense-queries.sql"

  while IFS='|' read -r trigger ref_id extra; do
    sqlite3 "$db" "INSERT INTO curiosity_triggers(trigger_type, ref_id, payload, fired_at, consumed)
                   VALUES ('$trigger', '$ref_id', '$extra', datetime('now'), 0);"
  done < <(sqlite3 "$db" -cmd ".mode list" -cmd ".separator '|'" < "$queries")
}
```

Call `sense_act_layer "$DB"` after the existing sense functions in the sense script's main body.

---

## 7. Swarm Partition

Six Codex agents. Each owns disjoint files. Agent 1 owns all DDL. All agents verify against a shared interface contract (this document §2.2–2.4).

### 7.1 Agent assignments

| Agent | Files owned | Depends on |
|---|---|---|
| **Agent 1 (DDL)** | `$SCRIPT_DIR/migrations/001_act_layer.sql`, `$SCRIPT_DIR/migrations/002_goals_columns.sql` | none |
| **Agent 2 (Classify)** | `$SCRIPT_DIR/curiosity-classify.py`, `$SCRIPT_DIR/lib/curiosity-risk-rules.json` | Agent 1 (schema) |
| **Agent 3 (Act)** | `$SCRIPT_DIR/curiosity-act.sh`, `$SCRIPT_DIR/lib/curiosity-act-primitives.sh` | Agent 1 (schema) |
| **Agent 4 (Verify)** | `$SCRIPT_DIR/curiosity-verify.sh` | Agent 1 (schema) |
| **Agent 5 (Sense)** | `$SCRIPT_DIR/curiosity-sense.sh` (extend only), `$SCRIPT_DIR/lib/curiosity-sense-queries.sql` | Agent 1 (schema) |
| **Agent 6 (Daemon+Tests)** | `$SCRIPT_DIR/curiosity-daemon.sh` (extend only), `$SCRIPT_DIR/tests/test-act-loop.sh` | Agents 2,3,4,5 |

### 7.2 Interface contract (each agent codes against this)

```
curiosity_actions:
  id              INTEGER PK
  brief_id        TEXT    (FK to curiosity_briefs.brief_id)
  proposed_at     TEXT
  classification  TEXT    CHECK in ('AUTO_ACT','HUMAN_REQUIRED','BLOCK')
  primitive       TEXT
  target          TEXT
  payload         TEXT    (JSON)
  status          TEXT    DEFAULT 'proposed'
                          CHECK in ('proposed','executing','done','failed','blocked')
  executed_at     TEXT
  verified_at     TEXT
  outcome         TEXT
  verification_payload TEXT (JSON)
  reason          TEXT

curiosity_action_log:
  id          INTEGER PK
  action_id   INTEGER FK -> curiosity_actions.id
  event_type  TEXT
  at          TEXT
  detail      TEXT

curiosity_delegated_tasks:
  task_id     TEXT PK
  brief_id    TEXT
  task_spec   TEXT (JSON)
  status      TEXT  ('pending','dispatched','accepted','running','done','failed')
  created_at  TEXT
  updated_at  TEXT

curiosity_briefs (existing, must have column):
  proposed_changes  TEXT (JSON array; each item: {primitive, target, payload, tags, creates_new, destructive})
```

### 7.3 DDL — Agent 1 deliverable

**File:** `$SCRIPT_DIR/migrations/001_act_layer.sql`

```sql
CREATE TABLE IF NOT EXISTS curiosity_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brief_id TEXT NOT NULL,
  proposed_at TEXT NOT NULL,
  classification TEXT NOT NULL
    CHECK(classification IN ('AUTO_ACT','HUMAN_REQUIRED','BLOCK')),
  primitive TEXT NOT NULL,
  target TEXT,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK(status IN ('proposed','executing','done','failed','blocked')),
  executed_at TEXT,
  verified_at TEXT,
  outcome TEXT,
  verification_payload TEXT,
  reason TEXT,
  FOREIGN KEY (brief_id) REFERENCES curiosity_briefs(brief_id)
);
CREATE INDEX IF NOT EXISTS idx_actions_brief ON curiosity_actions(brief_id);
CREATE INDEX IF NOT EXISTS idx_actions_status ON curiosity_actions(status);
CREATE INDEX IF NOT EXISTS idx_actions_class ON curiosity_actions(classification);

CREATE TABLE IF NOT EXISTS curiosity_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id INTEGER NOT NULL REFERENCES curiosity_actions(id),
  event_type TEXT NOT NULL,
  at TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_action_log_aid ON curiosity_action_log(action_id);

CREATE TABLE IF NOT EXISTS curiosity_delegated_tasks (
  task_id TEXT PRIMARY KEY,
  brief_id TEXT,
  task_spec TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
```

**File:** `$SCRIPT_DIR/migrations/002_goals_columns.sql`

```sql
-- Idempotent column adds via PRAGMA table_info check.
-- Agent 1 must implement as a bash wrapper that runs each ALTER only if column missing.
-- Skeleton:

-- PRAGMA table_info(gideon_goals) -> check for 'source','status','last_progress_at','progress_log'
-- ALTER TABLE gideon_goals ADD COLUMN source TEXT DEFAULT 'manual';
-- ALTER TABLE gideon_goals ADD COLUMN status TEXT DEFAULT 'active';
-- ALTER TABLE gideon_goals ADD COLUMN last_progress_at TEXT;
-- ALTER TABLE gideon_goals ADD COLUMN progress_log TEXT DEFAULT '[]';
```

Agent 1 must also add a column to `curiosity_briefs` if `proposed_changes` does not exist:

```sql
-- Check PRAGMA table_info(curiosity_briefs) for 'proposed_changes'
-- ALTER TABLE curiosity_briefs ADD COLUMN proposed_changes TEXT DEFAULT '[]';
```

### 7.4 Daemon changes — Agent 6 deliverable

Insert the three new stage calls into `curiosity-daemon.sh` exactly as shown in §2.1. No other changes to the daemon. The new calls go after the existing FEEDBACK call and before the existing `sleep`.

### 7.5 Merge order

1. Agent 1 merges migrations first; all agents rebase against the new schema.
2. Agents 2, 3, 4 merge in any order (disjoint files).
3. Agent 5 merges sense changes (depends on schema + new tables).
4. Agent 6 merges daemon changes + tests last (depends on all stages existing).

---

## 8. Verification Checklist

**File:** `$SCRIPT_DIR/tests/test-act-loop.sh`
**Owner:** Agent 6

```bash
#!/usr/bin/env bash
# test-act-loop.sh — end-to-end test of the act layer.
# Run on a copy of the DB: cp gideon.db gideon.test.db

set -euo pipefail
DB="${1:-$HOME/.hermes/db/gideon.test.db}"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0

ok()   { echo "PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

# 1. Schema exists
for t in curiosity_actions curiosity_action_log curiosity_delegated_tasks; do
  cnt=$(sqlite3 "$DB" "SELECT count(*) FROM sqlite_master WHERE name='$t';")
  [[ "$cnt" -eq 1 ]] && ok "table $t exists" || fail "table $t missing"
done

# 2. gideon_goals has new columns
for c in source status last_progress_at progress_log; do
  cnt=$(sqlite3 "$DB" "PRAGMA table_info(gideon_goals);" | grep -c "|$c|")
  [[ "$cnt" -ge 1 ]] && ok "gideon_goals.$c exists" || fail "gideon_goals.$c missing"
done

# 3. curiosity_briefs.proposed_changes exists
cnt=$(sqlite3 "$DB" "PRAGMA table_info(curiosity_briefs);" | grep -c "|proposed_changes|")
[[ "$cnt" -ge 1 ]] && ok "curiosity_briefs.proposed_changes exists" || fail "missing proposed_changes"

# 4. Classify routes correctly
TEST_BRIEF="test-$(date +%s)"
sqlite3 "$DB" "INSERT INTO curiosity_briefs(b
