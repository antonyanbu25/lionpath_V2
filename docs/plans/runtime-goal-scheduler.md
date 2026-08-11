# Runtime Goal Scheduler

The goal scheduler keeps the goal queue moving by checking for the next actionable pending goal every 15 seconds and marking that goal `in_progress` for execution.

## Install

```bash
bash scripts/install-goal-scheduler.sh
```

## Verify

```bash
systemctl status gideon-goal-scheduler.service
```

## Add a Goal

```bash
/root/.hermes/scripts/goal-queue.sh add "goal text"
```
