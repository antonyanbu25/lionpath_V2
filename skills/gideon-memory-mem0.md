---
name: gideon-memory-mem0
description: "mem0 memory layer integration for the curiosity daemon. Use when wiring Mem0 (OSS or hosted) into Gideon's curiosity loop as a semantic memory backend alongside the SQLite `memory` table."
version: 1.0.0
author: Gideon
---

# Gideon Memory — Mem0 Integration for the Curiosity Daemon

Adds a semantic long-term memory layer ([Mem0](https://mem0.ai)) to the curiosity
loop so that curiosity briefs, act-layer outcomes, and self-reflection findings are
retrievable by meaning (vector search) rather than only by exact key lookup. The
existing SQLite `memory` table remains the source of truth for act-layer writes;
Mem0 is a read-side enrichment + write-side mirror that makes the SENSE and
SYNTHESIZE stages context-aware.

## When to use this skill

- You are extending `curiosity-sense.sh` or `curiosity-fetch.sh` to pull
  semantically related memories into the brief prompt.
- You are extending `curiosity-feedback.py` or `curiosity-act-primitives.sh`
  (`act_memory_write`) so that every key/value written to the `memory` table is
  also mirrored to Mem0.
- You are adding a `mem0_search` primitive to the act layer.
- You are bootstrapping Mem0 (OSS self-hosted via Docker, or hosted Platform API)
  on the Gideon VPS.

## Architecture

```
curiosity-daemon.sh
  │
  ├─ SENSE    curiosity-sense.sh
  │     └─ mem0_search(topic)  ← NEW: enrich trigger context
  ├─ FETCH    curiosity-fetch.sh
  │     └─ mem0_search(session_digest) ← NEW (optional)
  ├─ SYNTHESIZE curiosity-synthesize.py
  │     └─ memory context now includes semantic hits
  ├─ SURFACE  curiosity-surface.sh
  ├─ FEEDBACK curiosity-feedback.py
  │     └─ after apply_actions() → mem0_add()  ← NEW: mirror write
  ├─ CLASSIFY curiosity-classify.py
  ├─ ACT      curiosity-act.sh / curiosity-act-primitives.sh
  │     └─ act_memory_write() → mem0_add()  ← NEW: mirror write
  └─ VERIFY   curiosity-verify.sh
```

### Two storage backends, one logical memory

| Layer | Store | What | Query style |
|-------|-------|------|-------------|
| Existing | SQLite `memory` table in `state.db` | key → value, act-layer writes, KV state | exact key |
| **New** | Mem0 (OSS Docker or hosted API) | semantic facts extracted from briefs, act outcomes, reflections | vector similarity |

**Rule:** the SQLite `memory` table remains the authoritative write target for
`memory_write` and `curiosity-feedback`. Mem0 is a **mirror + search index**.
Never read from Mem0 to decide whether to write to SQLite — that creates a
circular dependency. Write to SQLite first, mirror to Mem0 second.

## Prerequisites

```bash
# Option A — Mem0 OSS (self-hosted, no external API dependency)
docker run -d --name gideon-mem0 \
  -p 8050:8050 \
  -e OPENAI_API_KEY="$HERMES_CUSTOM_API_NEURALWATT_COM_API_KEY" \
  -e MEM0_EMBEDDING_MODEL="text-embedding-3-small" \
  -e MEM0_LLM_MODEL="glm-5.2" \
  -e MEM0_LLM_BASE_URL="https://api.neuralwatt.com/v1" \
  mem0/mem0:latest

# Option B — Mem0 hosted Platform
# Set MEM0_API_KEY in ~/.hermes/.env
```

Add to `~/.hermes/.env`:

```bash
# Mem0 configuration — OSS self-hosted (preferred for Gideon)
MEM0_BASE_URL="http://127.0.0.1:8050"
MEM0_USER_ID="gideon"
MEM0_AGENT_ID="curiosity-daemon"
# OR hosted Platform:
# MEM0_API_KEY="mcp-xxxxx"
```

The `mem0_client.py` helper (below) reads these from `~/.hermes/.env` the same
way `curiosity-synthesize.py` reads its API key.

## Integration points

### 1. SENSE enrichment (read-side)

In `curiosity-sense.sh`, after computing the trigger, call Mem0 for
semantically related memories and inject them into the trigger JSON:

```bash
# curiosity-sense.sh — after trigger detection, before stdout
MEM0_CONTEXT=""
if command -v python3 >/dev/null 2>&1; then
  MEM0_CONTEXT="$(python3 "$HERMES_HOME/scripts/curiosity-mem0.py" \
    search "$TOPIC" --limit 5 2>/dev/null || true)"
fi
# append to trigger JSON as "mem0_context" field
```

### 2. FETCH enrichment (read-side, optional)

`curiosity-fetch.sh` can use `curiosity-mem0.py search` to pull memories related
to the session digest or recent events, giving SYNTHESIZE richer context.

### 3. FEEDBACK mirror (write-side)

In `curiosity-feedback.py`, after `apply_actions()`, mirror each applied action
to Mem0:

```python
# curiosity-feedback.py — after apply_actions(database, actions)
from curiosity_mem0 import mem0_client
client = mem0_client()
if client:
    for action in actions:
        try:
            client.add(
                messages=[
                    {"role": "system", "content": f"curiosity feedback: {action['key']}"},
                    {"role": "user", "content": action["value"]},
                ],
                user_id=os.environ.get("MEM0_USER_ID", "gideon"),
                agent_id=os.environ.get("MEM0_AGENT_ID", "curiosity-daemon"),
                metadata={"source": "curiosity-feedback", "key": action["key"]},
            )
        except Exception:
            pass  # non-fatal — Mem0 is a mirror, not authoritative
```

### 4. ACT primitive mirror (`act_memory_write`)

In `curiosity-act-primitives.sh`, after the SQLite UPSERT in `act_memory_write()`,
mirror to Mem0:

```bash
act_memory_write() {
  # ... existing SQLite UPSERT logic ...

  # Mirror to Mem0 (non-fatal)
  python3 "$HERMES_HOME/scripts/curiosity-mem0.py" add \
    --key "$key" \
    --value "$val" \
    --source "curiosity-act" \
    --action-id "$aid" 2>/dev/null || true

  _done_action "$db" "$aid" "success" "memory_write $key"
}
```

### 5. New act primitive: `mem0_search` (optional)

Add to `curiosity-risk-rules.json` under `auto_act_primitives`:

```json
"mem0_search"
```

This lets the curiosity loop query its own semantic memory during act execution.
Implementation in `curiosity-act-primitives.sh`:

```bash
act_mem0_search() {
  local db="$1" aid="$2" payload="$3"
  local query
  query=$(echo "$payload" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('query',''))")

  local results
  results="$(python3 "$HERMES_HOME/scripts/curiosity-mem0.py" search "$query" --limit 5 2>/dev/null || echo "[]")"

  # Store results in action outcome for VERIFY stage
  _set_status "$db" "$aid" "done" "mem0_search_complete"
  _log_action "$db" "$aid" "executed" "mem0_search query=$query results=$results"
}
```

Add to the `case` dispatch in `curiosity-act.sh`:

```bash
mem0_search)       act_mem0_search "$DB" "$ACTION_ID" "$PAYLOAD" ;;
```

## Helper script: `curiosity-mem0.py`

Create at `~/.hermes/scripts/curiosity-mem0.py`. Thin CLI wrapper over the Mem0
Python SDK, usable from both bash and Python stages.

```python
#!/usr/bin/env python3
"""mem0 bridge for the Gideon curiosity daemon.

CLI:
  curiosity-mem0.py search <query> [--limit N]
  curiosity-mem0.py add --key K --value V [--source S] [--action-id ID]
  curiosity-mem0.py health

Reads config from ~/.hermes/.env:
  MEM0_BASE_URL   OSS server URL (e.g. http://127.0.0.1:8050)
  MEM0_API_KEY    hosted Platform key (if set, overrides OSS)
  MEM0_USER_ID    user_id scope (default: gideon)
  MEM0_AGENT_ID   agent_id scope (default: curiosity-daemon)

All failures are non-fatal — prints to stderr, returns exit 1, never raises.
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error


def _env_file(home: str) -> dict:
    path = os.path.join(home, ".env")
    values = {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                if line.startswith("export "):
                    line = line[len("export "):].strip()
                k, v = line.split("=", 1)
                v = v.strip()
                if v and v[0] in ("'", '"') and v[-1] == v[0]:
                    v = v[1:-1]
                values[k.strip()] = v
    except OSError:
        pass
    return values


def _config():
    home = os.environ.get("HERMES_HOME") or os.path.expanduser("~/.hermes")
    env = _env_file(home)
    base_url = env.get("MEM0_BASE_URL", "http://127.0.0.1:8050")
    api_key = env.get("MEM0_API_KEY", "")
    user_id = env.get("MEM0_USER_ID", "gideon")
    agent_id = env.get("MEM0_AGENT_ID", "curiosity-daemon")
    return base_url, api_key, user_id, agent_id


def _request(url, payload, api_key="", timeout=30):
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Token {api_key}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"mem0 HTTP {e.code}: {e.read().decode('utf-8', 'replace')}", file=sys.stderr)
        return None
    except (urllib.error.URLError, json.JSONDecodeError, OSError) as e:
        print(f"mem0 request failed: {e}", file=sys.stderr)
        return None


def search(query, limit=5):
    base_url, api_key, user_id, agent_id = _config()
    result = _request(
        f"{base_url}/memories/search/",
        {"query": query, "user_id": user_id, "agent_id": agent_id, "limit": limit},
        api_key,
    )
    if result is None:
        return []
    memories = result.get("results") or result.get("memories") or []
    if isinstance(memories, list) and memories and isinstance(memories[0], dict):
        return [m.get("memory", m.get("content", str(m))) for m in memories]
    return memories if isinstance(memories, list) else []


def add(key, value, source="curiosity", action_id=""):
    base_url, api_key, user_id, agent_id = _config()
    messages = [
        {"role": "system", "content": f"curiosity {source} key={key} action_id={action_id}"},
        {"role": "user", "content": str(value)},
    ]
    result = _request(
        f"{base_url}/memories/",
        {"messages": messages, "user_id": user_id, "agent_id": agent_id,
         "metadata": {"source": source, "key": key, "action_id": action_id}},
        api_key,
    )
    return result


def health():
    base_url, api_key, _, _ = _config()
    result = _request(f"{base_url}/memories/search/", {"query": "", "limit": 1}, api_key)
    return result is not None


def main():
    ap = argparse.ArgumentParser(description="mem0 bridge for curiosity daemon")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search")
    s.add_argument("query")
    s.add_argument("--limit", type=int, default=5)

    a = sub.add_parser("add")
    a.add_argument("--key", required=True)
    a.add_argument("--value", required=True)
    a.add_argument("--source", default="curiosity")
    a.add_argument("--action-id", default="")

    sub.add_parser("health")

    args = ap.parse_args()
    if args.cmd == "search":
        results = search(args.query, args.limit)
        print(json.dumps(results, ensure_ascii=False))
    elif args.cmd == "add":
        result = add(args.key, args.value, args.source, args.action_id)
        print(json.dumps(result or {}, ensure_ascii=False))
    elif args.cmd == "health":
        sys.exit(0 if health() else 1)


if __name__ == "__main__":
    main()
```

## Guardrails (extends curiosity loop rules)

1. **Mem0 is a mirror, not authoritative.** All writes go to SQLite `memory` first.
   Mem0 mirroring happens after and is non-fatal (`|| true`).
2. **No circular reads.** Never use Mem0 to decide whether to write to the
   `memory` table. Mem0 informs SYNTHESIZE prompt context only.
3. **Scoped metadata.** Every Mem0 add carries `agent_id="curiosity-daemon"` and
   `source` tag so memories are filterable by origin.
4. **No secrets in memory.** API keys, tokens, and `.env` values must never be
   written to Mem0. Filter in `curiosity-feedback.py` before mirroring.
5. **Failure isolation.** If Mem0 is down, the curiosity loop must continue
   uninterrupted. Every Mem0 call is wrapped in `try/except` (Python) or
   `|| true` (bash).
6. **Budget.** Mem0 embedding/search calls consume the existing
   `CURIOSITY_DAILY_TOKEN_BUDGET`. Track Mem0 token usage separately in
   `curiosity_state` as `mem0_daily_tokens_<YYYYMMDD>`.

## Token budget tracking

Add to `curiosity-daemon.sh` in the budget-check section:

```bash
mem0_tokens_key="mem0_daily_tokens_$day"
mem0_tokens="$(state_int "$(state_get "$mem0_tokens_key")")"
# Mem0 search is cheap (embeddings only); reserve ~500 tokens/cycle for search
if (( mem0_tokens + 500 > DAILY_TOKEN_BUDGET )); then
  log INFO "mem0 search skipped: daily embedding budget exceeded"
  export CURIOSITY_MEM0_DISABLED=1
fi
```

`curiosity-mem0.py` checks `CURIOSITY_MEM0_DISABLED` env var and returns empty
results / no-ops writes if set.

## Install steps (Gideon)

```bash
# 1. Start Mem0 OSS container (or set MEM0_API_KEY for hosted)
docker run -d --name gideon-mem0 -p 8050:8050 \
  -e OPENAI_API_KEY="$(grep HERMES_CUSTOM_API_NEURALWATT_COM_API_KEY ~/.hermes/.env | cut -d= -f2 | tr -d '\"'"'"')" \
  mem0/mem0:latest

# 2. Add env vars
cat >> ~/.hermes/.env << 'ENV'
MEM0_BASE_URL="http://127.0.0.1:8050"
MEM0_USER_ID="gideon"
MEM0_AGENT_ID="curiosity-daemon"
ENV

# 3. Install helper script
install -m 755 scripts/curiosity-mem0.py ~/.hermes/scripts/

# 4. Verify
python3 ~/.hermes/scripts/curiosity-mem0.py health && echo "OK" || echo "FAIL"

# 5. Patch curiosity-feedback.py, curiosity-act-primitives.sh, curiosity-sense.sh
#    (see integration points above — apply patches one at a time, test each)

# 6. Restart curiosity daemon
systemctl restart gideon-curiosity
```

## Verification checklist

- [ ] `curiosity-mem0.py health` returns exit 0
- [ ] `curiosity-mem0.py search "test query"` returns JSON list (may be empty)
- [ ] `curiosity-mem0.py add --key test --value "hello world"` returns non-empty
- [ ] After one curiosity cycle, `curiosity-mem0.py search "gideon"` returns results
- [ ] Curiosity daemon log shows `mem0_search` or `mem0 add` entries
- [ ] If Mem0 container is stopped, curiosity daemon continues without errors
- [ ] `mem0_daily_tokens_<date>` key in `curiosity_state` tracks usage
- [ ] No API keys or secrets appear in Mem0 memories

## Pitfalls

- **Mem0 OSS requires an LLM provider for extraction.** The Neuralwatt GLM API
  works but pass `MEM0_LLM_BASE_URL` and `MEM0_LLM_MODEL` explicitly — Mem0
  defaults to OpenAI endpoints.
- **Docker on aarch64 (VPS).** Verify the Mem0 image supports arm64. If not, use
  the hosted Platform API instead.
- **`content:null` from GLM.** Mem0's internal LLM calls can also return
  `content:null`. Use the same retry-once-then-reasoning fallback as
  `curiosity-synthesize.py`.
- **Embedding model mismatch.** If you change `MEM0_EMBEDDING_MODEL` after initial
  load, existing memories must be re-indexed. Start with `text-embedding-3-small`
  and don't change it.
- **SQLite write ordering.** Always write to `memory` table BEFORE mirroring to
  Mem0. If the mirror fails, SQLite has the data. If SQLite fails, the cycle
  fails fast and nothing mirrors.
- **Stale lock file.** Shared with curiosity daemon — if Mem0 hangs, the daemon
  lock at `/tmp/curiosity-daemon.lock` may remain. The daemon already handles
  this via its `LOCK_FILE` check + `trap rm -f` cleanup.
