# Scheduled jobs

Four mechanisms exist, are correct, and were invoked by **nothing** (J-021, J-023).
This file is the missing half: the code side is done and tested on
`fix/extensive-deployment-review`; the schedules below are **not applied** and have to be,
by someone with `gcloud` access to `se-singha-paathi`.

Read the caveat under each one before creating it. Two of the four should **not** simply be
switched on.

| Job | Endpoint / entry point | Schedule | Status |
|---|---|---|---|
| Outbox projector | `POST /api/internal/outbox/project` | `*/5 * * * *` | **conditional** — see below |
| Outbox health / dead letter | `GET /api/internal/outbox/health` | `*/10 * * * *` (or an alert policy) | ready |
| Usage rollup | `POST /api/internal/usage/rollup` | `10 1 * * *` UTC | ready |
| PII retention | `SELECT redact_pii()` | — | **do not schedule yet** |

All three HTTP endpoints authenticate with `X-Cron-Secret: $INTERNAL_CRON_SECRET`, the same
header the existing internal batch routes use. The secret is already set on the service; none
of these need a new one.

---

## 1. Outbox projector — check the mode first

```bash
gcloud scheduler jobs create http janus-outbox-project \
  --project=se-singha-paathi \
  --location=us-central1 \
  --schedule="*/5 * * * *" \
  --uri="https://lionpathapi.benjaminsquare.com/api/internal/outbox/project" \
  --http-method=POST \
  --headers="X-Cron-Secret=$INTERNAL_CRON_SECRET" \
  --attempt-deadline=300s
```

**Do not create this before reading the deployed `PERSISTENCE_MODE`** (D1 in the remediation
roadmap). `enqueueOutbox` is called only from `DualWriteRepository`, so in `sql` mode — the
shipped default — nothing is ever enqueued and the projector has no steady-state work. The
236 pending rows are then a **historical backlog from an earlier dual-write window**, and
draining them is a one-off, not a recurring need.

`GET /api/internal/outbox/health` reports `enqueueActive`, which answers this without a
`gcloud` call. If it is `false`, run the projector **once by hand** to drain the backlog and
skip the schedule entirely.

**Scheduling this also restores crash recovery.** The reaper that re-queues rows stranded in
`processing` for more than 10 minutes is the first statement of `claim_outbox_batch`, so it
only runs when the projector runs. One schedule, two findings closed.

**Before draining:** in `dual` mode the projector writes to Firestore. If the D1 answer is
that Firestore is being retired, draining 236 stale rows writes 236 stale documents into the
store you are trying to decommission. Decide that first.

## 2. Outbox health — the dead-letter reader

```bash
gcloud scheduler jobs create http janus-outbox-health \
  --project=se-singha-paathi \
  --location=us-central1 \
  --schedule="*/10 * * * *" \
  --uri="https://lionpathapi.benjaminsquare.com/api/internal/outbox/health" \
  --http-method=GET \
  --headers="X-Cron-Secret=$INTERNAL_CRON_SECRET"
```

A monitoring uptime check or alert policy is a better fit than a scheduler job, since the
endpoint is a side-effect-free `GET` whose value is the response body. Either works.

**Alert on these, in this order:**

| Field | Condition | Why |
|---|---|---|
| `counts.failed` | `> 0` | a permanently failed row. **This had no reader at all before** — the queue's only consumer was the projector |
| `stuckProcessing` | `> 0` **and** the projector reported `completed: 0` | the projector is not running. The reaper cannot report this itself, because it lives inside the projector |
| `oldestPendingAgeSeconds` | rising over consecutive polls **and** `enqueueActive` is `true` | draining has stalled |

**Do not alert on `counts.pending` alone.** With `enqueueActive: false` the backlog cannot
drain and cannot grow, so that alert fires once and never clears — which is how an alert
gets muted and then ignored.

## 3. Usage rollup

```bash
gcloud scheduler jobs create http janus-usage-rollup \
  --project=se-singha-paathi \
  --location=us-central1 \
  --schedule="10 1 * * *" \
  --time-zone="Etc/UTC" \
  --uri="https://lionpathapi.benjaminsquare.com/api/internal/usage/rollup" \
  --http-method=POST \
  --headers="X-Cron-Secret=$INTERNAL_CRON_SECRET" \
  --attempt-deadline=600s
```

01:10 UTC, so the last complete UTC day is closed before it runs. With no body it recomputes
yesterday and today; the dates are UTC because `user_usage_daily.usage_date` is.

Idempotent — it deletes and recomputes the requested dates in one transaction, so a retry
replaces rather than double-counts. Safe to re-run, and safe to overlap with a manual run.

Backfill a range explicitly, capped at 92 days per call:

```bash
curl -X POST https://lionpathapi.benjaminsquare.com/api/internal/usage/rollup \
  -H "X-Cron-Secret: $INTERNAL_CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"from":"2026-06-01","to":"2026-08-31"}'
```

`worker/scripts/rollup-user-usage.mjs` still works as a CLI and shares the same code, so the
two paths cannot drift.

## 4. PII retention — deliberately not scheduled

**Do not put `redact_pii()` on a schedule as part of this work.** Two reasons, and the
second is the one that matters:

1. **No credential.** It is `SECURITY DEFINER` and, after migration 39, executable only by
   `janus_redactor`. The worker connects as `janus_app` and now correctly cannot call it.
   Scheduling it needs a `janus_redactor` credential that does not exist yet.

2. **It is irreversible, and it was reachable by the web role.** It `NULL`s
   `post_call.analysis` and `post_call.detail` for every post-call on a lost deal closed more
   than 12 months ago — the transcript-derived analysis, MEDDPICC, ARR, objections and
   commitments — and tombstones soft-deleted `app_user`/`contact` rows. Until migration 39,
   EXECUTE was held by **`PUBLIC` and `janus_app`** despite migration 06 appearing to grant
   it only to `janus_redactor`: PostgreSQL grants EXECUTE to `PUBLIC` by default, and
   `07_grants.sql:22` re-widens it with `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO
   janus_app`, which runs after 06. That is **J-036**, and migration 39 revokes it.

The other three jobs project or aggregate. This one destroys. Turning it on is a
data-retention decision with a legal dimension — what must be destroyed, after how long, and
who signs off — not a wiring task. It stays off until that decision has an owner.

`redact_pii()` also has no dry-run mode and returns only a count. Before it is ever
scheduled it should report what it *would* destroy.

---

## Verifying

```bash
curl -s https://lionpathapi.benjaminsquare.com/api/internal/outbox/health \
  -H "X-Cron-Secret: $INTERNAL_CRON_SECRET" | jq
```

```json
{
  "ok": true,
  "counts": { "pending": 236, "processing": 0, "completed": 51, "failed": 0 },
  "oldestPendingAgeSeconds": 1209600,
  "oldestFailedAgeSeconds": null,
  "stuckProcessing": 0,
  "enqueueActive": false,
  "persistenceMode": "sql"
}
```

`enqueueActive: false` with a large `pending` is the **expected** shape in `sql` mode, and it
is the historical backlog described above — not an incident.

The gate for all of this is `worker/scripts/test-dormant-jobs.ts` (`sql` lane), which also
asserts the health reader's stuck-row count agrees with `claim_outbox_batch`'s own reaper
condition, so the two cannot drift.
