# Event Bus

Phase B adds a SQLite-backed event bus stored in `$HOME/.hermes/state.db`.
It owns only the `gideon_events` table and does not create any other table.
DO NOT add CREATE TABLE for any table you don't own.

## Schema

```sql
CREATE TABLE IF NOT EXISTS gideon_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  consumed INTEGER DEFAULT 0
);
```

## Commands

```bash
scripts/event-bus.sh init
scripts/event-bus.sh publish test hi
scripts/event-bus.sh poll
```

`poll` prints unconsumed rows as tab-separated `id`, `ts`, `type`, `payload`
fields and marks each row consumed after it is emitted.

`scripts/event-bus-publish.sh` is a wrapper for `event-bus.sh publish "$@"`.

## Subscribers

Register a handler function name for an event type:

```bash
scripts/event-bus-subscribe.sh test handle_test_event
```

This writes the mapping to `$HOME/.hermes/event-bus-handlers.conf`. Define the
function in that config file, or source another file from it:

```bash
handle_test_event() {
  local id="$1"
  local ts="$2"
  local type="$3"
  local payload="$4"
  printf 'received %s %s %s %s\n' "$id" "$ts" "$type" "$payload"
}
```

Run the daemon:

```bash
scripts/event-bus-daemon.sh
```

The daemon reloads the handler config every 3 seconds, polls unconsumed events,
and dispatches events with a registered type to the matching handler function.
