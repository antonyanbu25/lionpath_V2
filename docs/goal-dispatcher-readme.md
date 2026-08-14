# Goal Dispatcher

## What It Is

The **goal-dispatcher** is the bridge between the curiosity loop's
`goal_register` act primitive and the goal-scheduler/worker subsystem. When
curiosity identifies a gap and proposes a goal (via `goal_register`), the goal
lands in the `gideon_goals` table with `status='proposed'`. The goal-dispatcher
picks up these proposed goals, transitions them to `active`, and hands them to
a subagent worker for execution.

It runs on two triggers:

1. **Cron** — every 10 minutes via `/etc/cron.d/gideon-dispatch`.
2. **Inline** — immediately after the curiosity act layer completes a
   brief (in `curiosity-daemon.sh`), so newly registered goals don't wait
   for the next cron tick.

It also supports on-demand dispatch through two act-layer primitives:

- **`dispatch_now`** — immediately invoke `goal-dispatcher.sh --goal-id <id>`.
- **`subagent_dispatch`** — same as `dispatch_now` but also records the
  target agent name in the dispatch log.

## Why It Exists

Without the dispatcher, goals registered by curiosity sit in `proposed`
status indefinitely until someone manually runs the scheduler. The
dispatcher automates this pipeline:

```
curiosity-act (goal_register)
    → gideon_goals (status='proposed')
        → goal-dispatcher (cron + inline)
            → goal-dispatcher-worker (execution)
                → gideon_goals (status='active' → 'completed')
```

## How to Install

Run the install script from the repo root:

```bash
bash scripts/install-goal-dispatcher.sh
```

What it does (all idempotent — safe to re-run):

1. **Copies scripts** — `goal-dispatcher.sh` and `goal-dispatcher-worker.sh`
   → `/root/.hermes/scripts/`
2. **Runs migration 003** — `003_dispatch_state.sh` adds dispatch-tracking
   columns to `gideon_goals` and creates the `gideon_goal_dispatches` log
   table
3. **Creates cron entry** — `/etc/cron.d/gideon-dispatch`:
   ```
   */10 * * * * root /root/.hermes/scripts/goal-dispatcher.sh >> /var/log/goal-dispatcher.log 2>&1
   ```
4. **Creates log file** — `/var/log/goal-dispatcher.log` (pre-created so
   the cron redirect doesn't fail on first run)
5. **Verifies syntax** — runs `bash -n` on both dispatcher scripts

## How to Verify It's Working

After installation:

```bash
# Check scripts are installed
ls -la /root/.hermes/scripts/goal-dispatcher*.sh

# Check the cron entry
cat /etc/cron.d/gideon-dispatch

# Check the migration ran
sqlite3 /root/.hermes/state.db \
  "SELECT migration FROM curiosity_schema_migrations WHERE migration='003_dispatch_state.sql';"

# Check dispatch table exists
sqlite3 /root/.hermes/state.db ".schema gideon_goal_dispatches"

# Check the log file
tail -20 /var/log/goal-dispatcher.log
```

## How to Check Logs

```bash
# Dispatcher log (cron output)
tail -50 /var/log/goal-dispatcher.log

# Curiosity daemon log (inline dispatch attempts)
grep -i dispatch ~/.hermes/curiosity/daemon.log | tail -20

# Migration log
tail -20 ~/.hermes/curiosity/migrations.log

# Dispatch history from the database
sqlite3 -header -column /root/.hermes/state.db \
  "SELECT * FROM gideon_goal_dispatches ORDER BY id DESC LIMIT 10;"
```

## How to Manually Trigger

```bash
# Dispatch all eligible goals
/root/.hermes/scripts/goal-dispatcher.sh

# Dispatch a specific goal
/root/.hermes/scripts/goal-dispatcher.sh --goal-id 42
```

## Cron Schedule Explanation

The cron entry runs every 10 minutes:

```
*/10 * * * * root /root/.hermes/scripts/goal-dispatcher.sh >> /var/log/goal-dispatcher.log 2>&1
```

- `*/10` = every 10 minutes
- `root` = run as the root user
- `>>` = append to the log file (not overwrite)
- `2>&1` = redirect stderr to stdout so errors are captured in the log

This is a **backup** trigger. The primary dispatch happens inline in
`curiosity-daemon.sh` right after the act layer completes. The cron ensures
goals are also picked up if the curiosity daemon is stopped or if a goal was
registered through a different path.

## How to Interpret Goal Statuses

| Status | Meaning |
|--------|---------|
| `proposed` | Goal has been registered (e.g., by curiosity) but not yet dispatched |
| `active` | Goal has been picked up by the dispatcher and assigned to a worker |
| `in_progress` | Worker is actively executing the goal |
| `completed` | Goal has been fully achieved |
| `failed` | Worker attempted the goal but could not complete it |

### Dispatch log statuses (`gideon_goal_dispatches.status`)

| Status | Meaning |
|--------|---------|
| `pending` | Dispatch row created, goal-dispatcher not yet invoked |
| `dispatched` | goal-dispatcher successfully handed the goal to a worker |
| `dispatch_failed` | goal-dispatcher returned non-zero |
| `completed` | Worker finished execution (goal marked done or failed) |

## Architecture

```
                                    ┌─────────────────────┐
                                    │  curiosity-daemon.sh │
                                    │  (inline dispatch)   │
                                    └──────────┬──────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────┐
                    │                          │                      │
                    ▼                          ▼                      ▼
          ┌─────────────────┐   ┌──────────────────────┐   ┌─────────────────┐
          │ /etc/cron.d/    │   │ curiosity-act.sh      │   │ Manual trigger  │
          │ gideon-dispatch │   │ (dispatch_now /       │   │ (CLI)            │
          │ (every 10 min)  │   │  subagent_dispatch)   │   │                  │
          └────────┬────────┘   └───────────┬──────────┘   └────────┬────────┘
                   │                        │                       │
                   └────────────────────────┼───────────────────────┘
                                            │
                                            ▼
                               ┌────────────────────────┐
                               │ goal-dispatcher.sh      │
                               │ (picks proposed goals,  │
                               │  marks active, calls    │
                               │  worker)                │
                               └───────────┬────────────┘
                                           │
                                           ▼
                               ┌────────────────────────┐
                               │ goal-dispatcher-worker  │
                               │ (executes the goal)     │
                               └────────────────────────┘
```

## Files

| File | Location | Purpose |
|------|----------|---------|
| `install-goal-dispatcher.sh` | `scripts/` | Idempotent install script |
| `goal-dispatcher.sh` | `scripts/` → `/root/.hermes/scripts/` | Main dispatcher (installed by other worktrees) |
| `goal-dispatcher-worker.sh` | `scripts/` → `/root/.hermes/scripts/` | Goal execution worker |
| `003_dispatch_state.sh` | `scripts/curiosity-migrations/` | DB migration: dispatch columns + log table |
| `curiosity-act.sh` | `scripts/` | Modified: `do_dispatch_now()` + primitive cases |
| `curiosity-act-primitives.sh` | `scripts/` | Modified: `act_dispatch_now()` + `act_subagent_dispatch()` |
| `curiosity-risk-rules.json` | `scripts/` | Modified: added `dispatch_now` + `subagent_dispatch` to `auto_act_primitives` |
| `curiosity-daemon.sh` | `scripts/` | Modified: invoke dispatcher after ACT layer |
| `gideon-dispatch` | `/etc/cron.d/` | Cron entry (created by install script) |

## Constraints

- Must NOT break `curiosity-daemon.sh` or `curiosity-act.sh`
- Idempotent install (safe to run multiple times)
- All scripts pass `bash -n`
- Cron entries use standard 5-field cron format
- Dispatcher failures are always non-fatal (`|| true`)
