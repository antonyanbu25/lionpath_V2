# Goal Queue

Phase D adds a persistent hierarchical goal queue backed by
`$HOME/.hermes/state.db`.

Owned table:

```sql
CREATE TABLE IF NOT EXISTS gideon_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal TEXT NOT NULL,
  parent_id INTEGER,
  status TEXT DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);
```

Do NOT add `CREATE TABLE` for any table this phase does not own.

## Commands

Add a root goal:

```bash
scripts/goal-queue.sh add "ship Phase D"
```

Add a child goal:

```bash
scripts/goal-queue.sh add "write scheduler" 1
```

List all goals:

```bash
scripts/goal-queue.sh list
```

Update status:

```bash
scripts/goal-queue.sh update 2 completed
```

List children:

```bash
scripts/goal-queue.sh children 1
```

Decompose a high-level goal into child goals:

```bash
scripts/goal-decompose.sh "ship Phase D"
```

If `GLM_API_URL` and `GLM_API_KEY` are set, decomposition is requested via
`curl`. Otherwise the script uses three built-in demo subgoals.

Schedule the next actionable leaf goal:

```bash
scripts/goal-schedule.sh
```

The scheduler marks the selected pending goal as `in_progress` and prints the
selected row. Parent goals with pending children are treated as containers, so
the scheduler prefers concrete subgoals.
