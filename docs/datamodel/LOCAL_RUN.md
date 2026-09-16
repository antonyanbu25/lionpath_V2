# Running Janus locally against the staging Postgres

Both servers are up and pointed at the staging Cloud SQL instance. This is how
to use it and how to see what reaches Postgres.

| | |
|---|---|
| **Web app** | http://localhost:8788 |
| **Worker API** | http://localhost:8787 |
| **Database** | Cloud SQL `janus-db` (`8.231.110.188`), staging |
| **Mode** | `PERSISTENCE_MODE=dual` — Postgres is primary, Firestore is projected from it |
| **Auth** | Firebase Google SSO, unchanged (D1) |

## Start and stop

```bash
npm run dev:worker
```

```bash
npm run dev:web
```

Config in `worker/.dev.vars` (gitignored). Everything needed is already there:
both database roles, the Gemini key, the Firestore service account, and
`FIREBASE_PROJECT_ID`.

`web/firebase-config.local.js` was retrieved from the Firebase API using the
service account, so there is no manual copy step.

## Signing in

**Only Google SSO is available**, because `FIREBASE_PROJECT_ID` is set and
that enforces real auth — the demo email/password logins are hidden. Sign in
with your `@freshworks.com` account; `ALLOWED_EMAIL_DOMAIN` rejects anything
else.

First sign-in does something worth knowing: `resolveSqlSession` binds your
Firebase uid to your `app_user` row and writes `user_identity`. Until that
happens you have no SQL session and every write falls back to Firestore. It is
automatic, but it only works if you are one of the **21 provisioned people** —
25 of the 46 on the roster are not yet in Postgres.

Provisioned and ready: `nivedha.natarajan@`, `antony.sagayaraj@`,
`vipin.thomas@`, `mary.sheeba@`, `sowrav.sunil@` (admin), and 16 others.

## Seeing what reaches Postgres

This is the point of the whole exercise. After using the app:

```bash
node janus/scripts/coverage-report.mjs
```

Three sections:

1. **Writes that did NOT reach Postgres** — per method, with a reason code and
   a count. Anything appearing here is not wired, whatever the code looks like.
2. **Module coverage** — which tables exist and are filling, module by module.
3. **Firestore vs Postgres** — where the two still disagree.

For one record:

```bash
node janus/scripts/verify-call-storage.mjs
```

```bash
node janus/scripts/verify-call-storage.mjs act_call_abc123
```

Shows the resolved row, which `detail` arrays arrived, motion provenance, and
outbox health.

## Worth exercising, in this order

| Flow | What to watch |
|---|---|
| **Pre-call brief** | The brief must tie to a deal. New ones fall back to `lifecycleId` when there is no `dealId` — before that fix, 86 of 87 briefs were written and invisible |
| **Post-call analysis** | Writes `post_call` + the `detail` arrays + **`call_participant`** (newly wired — five kinds, real `app_user` FKs) |
| **A QIP score** | The one to watch. `composite_score` was `CHECK 0..2` while the score is 0–10, so **every score above 2 was rejected** and Postgres held zero. Now `0..10` with the cap applied on read |
| **Dashboard / activities** | Reads. Still Firestore-backed — `PERSISTENCE_READ_MODE` is unset |

After each, run the coverage report. The `last_24h` column going to zero for a
method is what "wired" means.

## Known state

**Working and verified against this database:**
schema 33 files idempotent · rubric catalog 19 → 270 → 1350 · 21 people with
segments and D15 motions · AT-1…AT-7 **7/7** · a real Firestore scorecard
round-tripping 5.67 → 5.67 → 5.67.

**Not yet:**

| | |
|---|---|
| Reads are still Firestore | `PERSISTENCE_READ_MODE` unset. The browser store has ~145 methods; the Postgres read repository has 36 |
| `history.storage: firestore` | Tasks and history use a per-user KV blob, a third store. `HISTORY_BACKEND_MODE=pg` moves it to `user_kv` |
| Outbox drain not running | 107 writes queued for Firestore. Needs a scheduler on `POST /api/internal/outbox/project` |
| `deal_contact` empty | Table exists, `createDealContact` is wired, nothing has exercised it |
| 25 people unprovisioned | Their writes fall back. `export-user-ids.mjs` then `provision-identity.mjs` |
| Firestore-only data | 71 post-calls, 10 scorecards, 6 users. Accepted loss per D6 |

## Not switching to `sql` mode yet

`PERSISTENCE_MODE=sql` stops Firestore writes, and reads have no Postgres path
for most methods — the app would go blank in places. Worse, a fallback in
`sql` mode is a **lost write**, not a fallback, because Firestore is not there
to catch it. The coverage report flags those in red.

The sequence is: run in `dual` → coverage report shows what still falls back →
fix those → repeat until `last_24h` is zero everywhere → then `sql`.
