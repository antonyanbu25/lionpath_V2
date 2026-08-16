# Goal Dispatcher — Implementation Plan (GLM 5.2)

## 1. Repository Layout

```
/root/gideon-mesh/
├── scripts/
│   ├── goal-dispatcher.sh              # main entrypoint
│   ├── goal-dispatcher.lib.sh         # shared functions (SQL, locks, dispatch)
│   └── goal-dispatcher-worker.sh       # subagent-side result writer template
├── tests/
│   └── test-goal-dispatcher.sh        # verification harness
└── docs/plans/2026-08-14-goal-dispatcher.md
```

Runtime state:
```
~/.hermes/state.db                       # existing SQLite DB
~/.hermes/goal-dispatcher/
├── locks/goal-<id>.lock                # per-goal flock
├── results/goal-<id>-attempt-<n>.out   # subagent result files
├── logs/goal-dispatcher.log            # rotated log
└── global.lock                         # global flock
```

## 2. Schema Additions (non-breaking)

```sql
CREATE TABLE IF NOT EXISTS goal_dispatch_state (
  goal_id            INTEGER PRIMARY KEY REFERENCES gideon_goals(id) ON DELETE CASCADE,
  attempts           INTEGER NOT NULL DEFAULT 0,
  max_attempts       INTEGER NOT NULL DEFAULT 3,
  last_attempt_at    TEXT,
  dispatched_at      TEXT,
  last_status        TEXT,    -- pending | success | failed | error
  last_result_file   TEXT,
  last_error         TEXT,
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gds_status ON goal_dispatch_state(last_status);
```

Migration is idempotent — CREATE TABLE IF NOT EXISTS. Run once at startup.

## 3. Staleness Query

Priority-weighted thresholds: high=1h, medium=6h, low=24h.

```sql
SELECT g.id, g.goal, g.description, g.priority,
       COALESCE(s.attempts, 0) AS attempts
FROM gideon_goals g
LEFT JOIN goal_dispatch_state s ON s.goal_id = g.id
WHERE g.status = 'active'
  AND COALESCE(s.attempts, 0) < COALESCE(s.max_attempts, 3)
  AND COALESCE(s.last_status, '') != 'pending'
  AND (
    s.goal_id IS NULL
    OR s.last_attempt_at IS NULL
    OR (
      CASE g.priority
        WHEN 'high'   THEN s.last_attempt_at <= datetime('now', '-1 hour')
        WHEN 'medium' THEN s.last_attempt_at <= datetime('now', '-6 hours')
        WHEN 'low'    THEN s.last_attempt_at <= datetime('now', '-24 hours')
        ELSE              s.last_attempt_at <= datetime('now', '-24 hours')
      END
    )
  )
ORDER BY
  CASE g.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
  g.created_at ASC
LIMIT 25;
```

`last_status != 'pending'` prevents re-dispatching a goal whose subagent is still running.

## 4. Dispatch Flow (per goal)

```
goal-dispatcher.sh
  ├─ acquire global flock ~/.hermes/goal-dispatcher/global.lock
  ├─ migrate schema (CREATE TABLE IF NOT EXISTS)
  ├─ query stale goals (§3)
  └─ for each goal_id:
       ├─ acquire per-goal flock locks/goal-<id>.lock (non-blocking)
       ├─ UPSERT goal_dispatch_state:
       │     attempts = attempts + 1
       │     last_attempt_at = now
       │     last_status = 'pending'
       │     dispatched_at = now
       ├─ result_file = results/goal-<id>-attempt-<n>.out
       ├─ build prompt + write to prompt file
       ├─ hermes delegate_task --prompt-file <prompt_file> --timeout 1800
       │     env RESULT_FILE=<result_file> GOAL_ID=<id>
       ├─ poll for result_file (5s interval, 1800s cap)
       ├─ verify result (§5)
       └─ update state (§5)
```

### 4.1 Hermes invocation

```
hermes delegate_task \
    --role "goal-worker" \
    --prompt-file <prompt_file> \
    --timeout 1800 \
    --env RESULT_FILE=<result_file> \
    --env GOAL_ID=<id>
```

### 4.2 Worker template (goal-dispatcher-worker.sh)

```bash
emit_result() {
  local status="$1"  # SUCCESS | FAILED
  local body="$2"
  {
    printf 'STATUS: %s\n' "$status"
    printf '%s\n' "$body"
  } > "$RESULT_FILE"
  sync "$RESULT_FILE"
}
trap 'emit_result FAILED "worker trapped: $?"' ERR
```

## 5. Result Verification

```bash
verify_result() {
  local goal_id="$1" attempt="$2" rf="$3"
  if [[ ! -s "$rf" ]]; then
    update_state "$goal_id" "$attempt" error "" "no result file"
    return 1
  fi
  local first
  first=$(head -n1 "$rf" | tr -d '\r' | tr '[:lower:]' '[:upper:]')
  case "$first" in
    "STATUS: SUCCESS")
      sqlite3 "$DB" "UPDATE gideon_goals SET status='completed', updated_at=datetime('now') WHERE id=$goal_id"
      update_state "$goal_id" "$attempt" success "$rf" ""
      ;;
    "STATUS: FAILED")
      handle_verification_failure "$goal_id" "$attempt" "$rf"
      ;;
    *)
      update_state "$goal_id" "$attempt" error "$rf" "unknown status: $first"
      ;;
  esac
}
```

Retry: exponential backoff (2^retry_count seconds), max 3 attempts before marking failed.

## 6. Crash Recovery / Pending Reaping

Force-reap stale `pending` entries older than their priority window:

```bash
# Inside global lock, before querying stale goals:
sqlite3 "$DB" "
  UPDATE goal_dispatch_state
  SET last_status='error', last_error='dispatcher crashed during pending'
  WHERE last_status='pending'
    AND last_attempt_at < datetime('now', '-2 hours')
"
```

## 7. Cron Integration

No new daemon. Add to existing /etc/cron.d/gideon-consolidation or a new entry:

```
*/10 * * * * root /root/.hermes/scripts/goal-dispatcher.sh >> /var/log/goal-dispatcher.log 2>&1
```

Or hook from curiosity-daemon.sh act layer after `goal_register` primitive fires:
- After registering a new goal, invoke `goal-dispatcher.sh` immediately to check if it should dispatch

## 8. Verification Test Plan

1. **Unit: schema migration** — run on fresh DB, verify tables created
2. **Unit: staleness query** — seed goals with various priorities/ages, verify correct selection
3. **Integration: dispatch without subagent** — mock delegate_task, verify lock, UPSERT, result file writing
4. **Integration: status parsing** — write result files with SUCCESS/FAILED/unknown, verify correct state transitions
5. **Integration: retry logic** — mock 2 failures, verify 3rd attempt then failed
6. **Integration: flock contention** — run two dispatchers simultaneously, verify second is skipped
7. **E2E: real subagent dispatch** — register a real goal, run dispatcher, verify subagent fires and result is written
8. **E2E: crash recovery** — start dispatch, kill mid-way, verify reaper reclaims on next run
