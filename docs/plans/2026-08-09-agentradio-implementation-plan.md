# AgentRadio Implementation Plan — Gideon's New Architecture

**Date:** 2026-08-09
**Architect:** Gideon (informed by AgentRadio paper arXiv:2607.28430)
**Implementer:** Codex (gpt-5.5)
**Goal:** Rewire Gideon with asynchronous message-passing for multi-agent coding tasks

**Why this matters:** In AgentRadio benchmarks, 4 agents with passive awareness scored 62.1% on SWE-Atlas QnA vs 32.3% for a single agent. The key insight: "An agent that is working cannot also be listening." Background watchers dissolve this mutual exclusion.

---

## Architecture

### Data Flow
```
Gideon (Hermes orchestrator)
  delegate_task → Agent A
    ├── watcher (background: agent-radio.sh wait <sessionId> agent-a)
    └── worker (foreground: investigates code)
  delegate_task → Agent B
    ├── watcher (background)
    └── worker (foreground)
```

### Primitives
1. **create_thread** — opens a conversation
2. **send_message** — fire-and-forget broadcast
3. **wait_for_mention** — blocks until mentioned or new message, dumps FULL state on exit (self-contained)
4. **read_state** — read full snapshot

### Message conventions
- **"FYI:"** — no reply needed
- **"URGENT:"** — handle before next step
- **No prefix** — reply at natural break

### Five-Phase Workflow
- P1: Independent Exploration
- P2: Discussion & Division (unanimous agreement)
- P3: Execution with Live Sharing (broadcast mid-stream)
- P4: Review & Conflict Resolution
- P5: Final Synthesis

---

## Implementation Tasks

### Task 1: Create directory structure
Create: `~/.hermes/scripts/` (already exists) and `~/.hermes/agent-radio/state.json`

### Task 2: Create agent-radio.sh (~/.hermes/scripts/agent-radio.sh)
Single executable bash script with subcommands:

**init subcommand:** `agent-radio.sh init <sessionId> [agentIds...]`
- Creates `~/.hermes/agent-radio/sessions/<sessionId>/`
- Writes session.json: `{"sessionId": "...", "createdAt": epoch_ms, "agentIds": [...], "threadIds": [], "messageCount": 0}`
- Creates threads/, messages/ subdirs

**thread subcommand:** `agent-radio.sh thread <sessionId> <threadName> [participantsCSV]`
- Generates threadId (date+random 8-char hex)
- Writes `<sessionDir>/threads/<threadId>.json`: `{"id": "...", "name": "...", "participants": [...], "messageIds": [], "createdAt": epoch_ms, "lastActivityAt": epoch_ms}`
- Appends threadId to session.json threadIds
- Prints "threadId=<id>"

**send subcommand:** `agent-radio.sh send <sessionId> <threadId> <content> [mentionsCSV]`
- Generates msgId (date+random 8-char hex)
- Writes `<sessionDir>/messages/<msgId>.json`: `{"id": "...", "threadId": "...", "agentId": "system", "content": "...", "mentions": [...], "createdAt": epoch_ms, "type": "message"}`
- Updates the thread's lastActivityAt and messageIds
- Increments session messageCount

**wait subcommand:** `agent-radio.sh wait <sessionId> <agentId> [maxWaitMs=30000] [maxRounds=0]`
THE KEY PASSIVE AWARENESS PATTERN:
1. Record baseline message count. Loop: sleep 2s, re-count. If count grew, scan for any message where agentId is mentioned OR that came in after baseline. Dump FULL aggregated state (all threads + all messages) on exit.
State dump format:
```
===== AGENT-RADIO STATE DUMP =====
Session: <sessionId>
Agent: <agentId>
Latest Message: <message details>
--- Threads ---
<all threads with messages>
--- Messages ---
<all messages in session>
===================================
```

**read subcommand:** `agent-radio.sh read <sessionId>`
Prints aggregated state (same format as wait dump).

**cleanup subcommand:** `agent-radio.sh cleanup <sessionId>`
rm -rf the session directory.

### Task 3: Create AgentRadio skill
`~/.hermes/skills/agent-radio/SKILL.md`

```yaml
---
name: agent-radio
description: "Multi-agent coding with passive awareness: agents broadcast mid-execution findings via shared message store while background watchers keep listening."
version: 1.0.0
author: Gideon
---

# AgentRadio — Asynchronous Multi-Agent Communication

## When to use
- Multi-agent coding tasks with interdependent subtasks

## Primitives
- `bash ~/.hermes/scripts/agent-radio.sh thread <sessionId> <name> [participants]`
- `bash ~/.hermes/scripts/agent-radio.sh send <sessionId> <threadId> <content> [mentions]`
- `bash ~/.hermes/scripts/agent-radio.sh wait <sessionId> <agentId> [ms] [rounds]` (run in background)
- `bash ~/.hermes/scripts/agent-radio.sh read <sessionId>`

## Passive Awareness Loop
1. Launch watcher in background before working
2. Work in foreground
3. Periodically check watcher output
4. On detection: relaunch watcher, process findings, adjust course
5. Repeat until phase complete

## 5-Phase Workflow
Phase 1: Independent Exploration
Phase 2: Discussion & Division — create planning thread, negotiate ownership
Phase 3: Execution with Live Sharing — work + broadcast (FYI: / URGENT:)
Phase 4: Review & Conflict Resolution — review each other's results
Phase 5: Final Synthesis — lead assembles, all approve

## Integration with Two-Brain Workflow
- Gideon is orchestrator
- GLM-5.2 produces architecture/plan
- Codex agents execute subtasks via AgentRadio coordination
```

### Task 4-6: Wire init, send, wait in the script

### Task 7: End-to-end verification
Run a complete test cycle and report results.

### Task 8: Save to memory
Save facts about the new architecture.
