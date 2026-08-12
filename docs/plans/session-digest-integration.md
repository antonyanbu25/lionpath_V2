# Session Digest Integration — Gateway + Reboot Persistence

## Goal
Wire the L2 session digest layer into Hermes WebUI so every active session:
1. Pulls the digest at each turn boundary (context injection via prefill hook)
2. Emits a heartbeat after each turn completes (gateway hook)
3. Consolidation runs automatically every 60s via systemd timer (reboot-persistent)

## Architecture

```
Gateway turn completes
  → _finish_gateway_run_starting_if_done()
      → emit heartbeat to event bus

Every 60s (systemd timer)
  → consolidation-daemon.sh digest
      → /tmp/session-digest.md

Every turn (prefill hook)
  → session-digest-pull.sh pull
      → injected into session context
```

---

## Deliverables

### D1: Prefill Script — Inject Digest into Session Context
File: scripts/session-digest-prefill.py

A Python script invoked by webui_prefill_messages_script. Runs the pull script
and returns a prefill system message.

### D2: Gateway Heartbeat Emission
File: api/gateway_chat.py — modify _finish_gateway_run_starting_if_done()

Add heartbeat emission after each turn completes. Fire-and-forget Popen call to
session-heartbeat.sh emit. Must not block the streaming response.

### D3: Systemd Timer for Digest Consolidation
Files:
- /etc/systemd/system/gideon-session-digest.timer
- /etc/systemd/system/gideon-session-digest.service

Timer fires consolidation-daemon.sh digest every 60s. Reboot-persistent.

---

## Partition for Parallel Agents

| Agent | Owns | Must NOT touch |
|-------|------|----------------|
| D1 | scripts/session-digest-prefill.py, config snippet | gateway code, systemd |
| D2 | api/gateway_chat.py | anything else |
| D3 | systemd .timer and .service files | Python code, shell scripts |

D1 and D2 can run in parallel with D3.

---

## Verification
1. python3 scripts/session-digest-prefill.py → JSON with session digest
2. curl test to gateway → check digest in context
3. systemctl status gideon-session-digest.timer → active
4. journalctl -u gideon-session-digest → see digest writes
5. Reboot → timer still fires
