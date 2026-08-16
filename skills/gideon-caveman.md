---
name: gideon-caveman
description: "Caveman token compression for the Gideon mesh — strip conversational fluff, emit terse telegrams to save context window tokens."
version: 1.0.0
author: Gideon
---

# Caveman Token Compression

Compress verbose agent output into dense, info-preserving "caveman" telegrams.
Designed for the Gideon mesh: when subagent results, tool output, or inter-agent
messages are relayed through the mesh, every token costs context window budget.
Caveman mode re-encodes content without losing meaning.

## When to Use

- **Subagent → orchestrator results**: compress before writing RESULT_FILE
- **Mesh relay hops**: compress when forwarding between agents
- **Memory consolidation digests**: pre-compress before LLM summarization
- **Long tool output being relayed**: compress before injecting into parent context
- **Inter-agent ping messages**: heartbeat/status exchanges

## When NOT to Use

- Final output delivered to the human user
- Code, commands, paths, or structured data (JSON/SQL/YAML) — keep verbatim
- Error messages being debugged — preserve full text
- Session digests intended for human review

## Compression Rules

Apply in order. Each rule preserves information; only style is lost.

### Rule 1: Drop articles and filler

Strip: `the`, `a`, `an`, `this`, `that`, `these`, `those`, `very`, `really`,
`just`, `quite`, `some`, `any`, `such`, `also`, `actually`, `basically`,
`essentially`, `simply`, `literally`.

```
Before: "The script failed because the database was not found in the path."
After:  "script failed: db not found in path"
```

### Rule 2: Shorten verbs and auxiliaries

| Full | Caveman |
|------|---------|
| is / are / was / were / been | — (omit entirely) |
| have / has / had | → `hv` |
| will / would | → `wld` |
| should / shall | → `shd` |
| could / can | → `cn` |
| cannot / can't | → `cant` |
| do / does / did | → `d` |
| because / since | → `bc` |
| however / although | → `but` |
| therefore / thus / hence | → `→` |
| before | → `b4` |
| after | → `aft` |
| without | → `w/o` |
| with | → `w/` |
| through / thru | → `thr` |
| about | → `abt` |
| between | → `btwn` |
| different | → `diff` |
| information | → `info` |
| configuration | → `config` |
| directory | → `dir` |
| environment | → `env` |
| parameter | → `param` |
| function | → `fn` |
| variable | → `var` |
| definition | → `def` |
| command | → `cmd` |
| output | → `out` |
| error | → `err` |
| message | → `msg` |
| number | → `nr` |
| result | → `res` |
| success / successful | → `ok` |
| failure / failed | → `fail` |
| because of | → `b/c` |

```
Before: "The function was unable to complete because the configuration parameter was invalid."
After:  "fn unable complete b/c config param invalid"
```

### Rule 3: Collapse redundant phrases

| Full phrase | Caveman |
|-------------|---------|
| "in order to" | `→` |
| "due to the fact that" | `b/c` |
| "it should be noted that" | `note:` |
| "please note that / keep in mind" | `note:` |
| "as a result of" | `b/c` |
| "with respect to / regarding" | `re:` |
| "in the case of" | `if` |
| "for the purpose of" | `4` |
| "at this point in time" | `now` |
| "in the event that" | `if` |
| "a number of / several / numerous" | `N` (with count) |
| "prior to" | `b4` |
| "subsequent to" | `aft` |
| "in addition to" | `+` |
| "not able to / unable to" | `cant` |
| "it is necessary to" | `must` |
| "make a decision" | `decide` |
| "take into consideration" | `consider` |
| "give consideration to" | `consider` |

### Rule 4: Symbol substitution

| Meaning | Symbol |
|---------|--------|
| and | `+` |
| or | `\|` |
| not | `!` |
| greater than | `>` |
| less than | `<` |
| equals / is equal to | `=` |
| approximately | `~` |
| increases / creates / adds | `+` |
| decreases / removes / deletes | `-` |
| leads to / results in | `→` |
| with | `w/` |
| without | `w/o` |
| number / count | `#` |
| percent | `%` |
| question | `?` |

```
Before: "The server returned an error and the retry count increased to 3, which caused a timeout."
After:  "srv err + retry #→3 → timeout"
```

### Rule 5: Preserve exactly — never compress these

- File paths: `/root/.hermes/scripts/curiosity-daemon.sh`
- Command names: `bash -n`, `sqlite3`, `delegate_task`
- Identifiers: `goal_id`, `gideon_goals`, `STATUS_FIELD`
- Numbers and units: `3 retries`, `500ms`, `10MB`
- Booleans: `true`, `false`
- Status codes: `exit 0`, `STATUS: SUCCESS`
- URLs and URLs fragments
- Code blocks, inline code, SQL, JSON
- Table cell values
- Environment variable names: `RESULT_FILE`, `GOAL_ID`
- Semicolons and pipe operators in shell commands

**If shortening a word creates ambiguity with a technical term, do not shorten it.**

### Rule 6: Sentence → telegram

Convert full sentences into colon-separated telegrams:

```
Before: "The migration script failed to run because the DATABASE_URL environment variable was not set, so the gideon_goals table was not created."
After:  "migration fail: DATABASE_URL not set → gideon_goals not created"
```

```
Before: "I checked the logs and found that the curiosity daemon had restarted 3 times in the last hour, but the goal-dispatcher did not pick up any new goals."
After:  "logs: curiosity daemon restarted 3x/hr, but goal-dispatcher 0 goals picked"
```

### Rule 7: Lists → inline

Compress bulleted lists into semicolon-separated inline strings:

```
Before:
- Script file is missing
- Permission denied on /var/log
- SQLite is not installed

After: "script missing; perms denied /var/log; sqlite3 not installed"
```

## Compression Levels

Choose the level based on context budget pressure:

### Level 1: Light (default)

Apply rules 1-3 only. Readable by any agent, ~30-40% reduction.

```
Before: "The goal dispatcher checked for stale goals but did not find any because all goals have been completed."
After:  "goal-dispatcher checked stale goals, found none b/c all completed"
```

### Level 2: Standard

Apply rules 1-4. Denser, still parseable, ~50-60% reduction.

```
Before: "The goal dispatcher checked for stale goals but did not find any because all goals have been completed."
After:  "goal-dispatcher: stale goals checked, none found b/c all ok"
```

### Level 3: Telegram (aggressive)

Apply rules 1-6. Maximum density for tight budget, ~65-75% reduction.

```
Before: "The goal dispatcher checked for stale goals but did not find any because all goals have been completed."
After:  "dispatcher: stale goals=0 b/c all ok"
```

### Level 4: List collapse

Apply rules 1-7. For multi-item outputs and status reports.

```
Before:
- Migration 003 applied successfully
- goal_dispatch_state table created with 0 rows
- Cron entry installed at /etc/cron.d/gideon-dispatch
- Log file created at /var/log/goal-dispatcher.log
- Syntax check passed (bash -n) on both scripts

After: "migr003 ok; goal_dispatch_state created(0 rows); cron→/etc/cron.d/gideon-dispatch; log→/var/log/goal-dispatcher.log; bash -n ok ×2"
```

## Usage in the Mesh

### Subagent result compression

In `goal-dispatcher-worker.sh` before writing RESULT_FILE:

```bash
compress_result() {
  local level="${CAVEMAN_LEVEL:-1}"
  local raw="$1"
  # For level 1+, pipe through the compression logic
  # In practice, the agent applies rules mentally when writing the result body
  echo "$raw"
}

emit_result SUCCESS "$(compress_result "$findings")"
```

In practice, caveman compression is applied at the LLM level — the agent
writing the result naturally encodes it in caveman style based on these rules.
No separate script is needed; the skill IS the encoding protocol.

### Relay compression between agents

When agent A passes results to agent B:

```
# Agent A output (verbose)
"The curiosity daemon found 3 knowledge gaps and registered 3 new goals.
Goal 42 is about documenting the event bus API. Goal 43 is about testing
the consciousness-sync.sh script. Goal 44 is about adding error handling
to mesh-memory.sh. All goals are in proposed status."

# Compressed for relay
"curiosity: 3 gaps→goals; g42=event-bus api docs; g43=consciousness-sync test; g44=mesh-memory err handling; all proposed"
```

### Memory consolidation pre-compression

Before feeding episodic rows to `consolidation-compress.sh`, pre-compress
verbose content into caveman telegrams. This reduces the token count sent to
the CHEAP_MODEL summarization endpoint, lowering cost and latency:

```bash
# Instead of feeding full verbose rows:
#   "The curiosity daemon observed that the mesh-memory.sh script had an
#    unhandled edge case where concurrent writes could deadlock..."
#
# Pre-compress:
#   "mesh-memory.sh: concurrent writes deadlock risk observed"
```

## Quality Checks

After compression, verify:

1. **No information lost** — can a reader reconstruct the original meaning?
2. **Technical terms intact** — paths, commands, identifiers uncompressed?
3. **Numbers preserved** — counts, durations, sizes, exit codes unchanged?
4. **Status clear** — success/failure/state transitions unambiguous?
5. **Parseable** — another agent can still act on this?

If any check fails, reduce the compression level and retry.

## Encoding Pitfalls

- **Don't compress error messages being actively debugged** — full text needed
- **Don't compress code, SQL, JSON, or structured data** — breaks parsing
- **Don't compress human-facing final output** — user sees raw
- **Don't invent abbreviations not in the tables above** — stay predictable
- **Don't compress different parts at different levels** — pick one level per message
- **Don't compress timestamps** — `2026-08-14T22:46:00Z` stays verbatim
- **Don't compress file paths** — `/root/.hermes/state.db` stays verbatim

## Mesh Integration Points

| Component | Compression Use |
|-----------|----------------|
| `goal-dispatcher-worker.sh` | Compress subagent findings before RESULT_FILE |
| `consolidation-compress.sh` | Pre-compress episodic rows before LLM digest |
| `agent-radio-mesh.sh` | Compress inter-agent relay messages |
| `session-digest-pull.sh` | Compress session summaries for storage |
| `curiosity-synthesize.py` | Compress synthesis output before relay |
| `critic-agent.sh` | Compress critique feedback for orchestrator |

## Verification

To verify caveman compression is working correctly in the mesh:

```bash
# Check subagent results are compressed
grep -r "STATUS: SUCCESS" /tmp/mesh-results/ | head -5
# Results should be terse telegrams, not paragraphs

# Check consolidation input is pre-compressed
HERMES_HOME=~/.hermes scripts/consolidation-compress.sh --limit 5 | head -20
# Input rows should already be caveman-style

# Check inter-agent relay messages
grep -r "relay" ~/.hermes/logs/ 2>/dev/null | tail -10
```
