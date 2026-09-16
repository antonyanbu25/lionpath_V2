# 07 — ACID, concurrency, idempotency and recovery

Evidence classes are marked throughout. **VERIFIED** = I read the source or ran the query.
**DELEGATED** = located by a read-only inventory and not independently re-read; treated as
a lead. I verified the five most severe items personally.

Concurrency and failure-injection testing was to run against a disposable local
PostgreSQL, per the mandate. **It did not run** — the audit's remaining time went to
root-causing the motion defect (J-025) and the erasure question (J-026). That is a real
coverage gap and is stated rather than glossed: everything below is static analysis plus
live-data measurement, not fault injection.

---

## 1. Transaction boundaries

**VERIFIED:** there is exactly one domain transaction helper —
`withSessionContext` (`worker/src/data/persistence/session-context.ts:327`) — which does
`BEGIN`, sets the three RLS session variables **in a separate earlier statement**, runs the
callback, then `COMMIT`, with `ROLLBACK` on throw. That shape is correct, and it is the
shape J-010's fix depends on.

**DELEGATED:** only three call sites open a transaction for domain writes
(`routes.ts:2036`, `:3174`, `:3326`). Operations writing 2+ tables **without** a shared
transaction:

| Operation | Boundary problem |
|---|---|
| `POST /api/history` | the `user_kv` blob is one transaction, the `account`+`deal`+`activity`+`post_call` shred is a **second, independent** one. A crash between leaves a blob with no relational rows |
| `POST /api/feedback` | Freshdesk ticket created **first**, then two separate blob writes |
| `POST /api/recovery/upload` | six independent writes; the handler reports "partial progress" in its own catch |
| `PATCH /api/org/structure` | user doc, old team `memberIds`, new team `memberIds` — three writes, no batch. A failure between them leaves a user on a team whose `memberIds` omits them |
| `POST /api/deals` | writes **only Firestore** via `.add()` — no `deal` row in PostgreSQL at all |
| `bindAuthIdentity` | `user_identity` insert then `audit_log` insert, both bare `pool.query` |
| scorecard persistence end to end | a 10-theme scorecard is **12+ separate transactions** (header, then one HTTP request per theme) |

The scorecard one is the most consequential: an interrupted re-score can leave a header
with zero themes and a stale `composite_score`, because a repeated header write **deletes
every existing theme** before re-inserting.

---

## 2. Isolation

**DELEGATED, and consistent with my own reading:** no isolation-level statement exists
anywhere in the repository. `withSessionContext` issues a bare `BEGIN`, and the pool sets
no options — so **PostgreSQL's default READ COMMITTED applies**.

Anomalies that permits, against concrete code:

**Lost update** — read-modify-write across separate transactions:

- `history.ts` reads the whole history array, then writes it back, in two separate
  transactions. Two tabs saving different calls: the later write overwrites the earlier
  entry entirely. `user_kv` columns are replaced wholesale (`SET ${column} = EXCLUDED.${column}`).
- The same pattern in `tasks.ts` (`upsertTask`, `patchTask`, `deleteTask`) and
  `feedback.ts`.
- `upsertPostCall`'s UPDATE branch overwrites `analysis`, `detail`, `transcript_ref` and
  `pipeline_state` with **no version or `updated_at` predicate** — **VERIFIED** (see J-026).

**Write skew** — mostly caught by partial unique indexes, which converts silent corruption
into a visible duplicate-key error. That is the better failure, but it is unhandled:
`idx_scorecard_activity_current`, `idx_deal_contact_primary` and `uq_aset_primary` each
stop a demote-then-insert race by aborting the transaction rather than by serialising it.

**Non-atomic reads:** each read method wraps itself in its own `withSessionContext`, so
`getPostCallDetail` issues at least two transactions and can observe a scorecard mid-delete.

---

## 3. Idempotency

**DELEGATED:** all 22 named `ON CONFLICT` targets resolve to a real constraint or partial
unique index — none are invalid. **The problem is the inverse:** twelve real unique
constraints are named by *no* `ON CONFLICT`, so a collision surfaces as an unhandled
`duplicate key value` that aborts the enclosing transaction:

`idx_activity_idempotency`, `idx_pre_call_idempotency`, `idx_post_call_idempotency`,
`pre_call.activity_id`, `post_call.activity_id`, `idx_task_ai_dedup`, `idx_psig_ai_key`,
`idx_account_slug_active`, `idx_contact_account_email_active`,
`idx_scorecard_activity_current`, `uq_aset_primary`, `idx_deal_contact_primary`.

This is not theoretical: a code comment in `postgres-repository.ts` records exactly this
class of failure occurring live on 2026-09-09 for `post_call_public_id_key`.

**Non-idempotent by construction** — these mint `Date.now()`-suffixed ids under
`ON CONFLICT … DO NOTHING`, so the `DO NOTHING` can never fire and a retry duplicates:

- `addArrOverride` → a retry appends a second ARR override
- `addContactEvent` → a retry appends a duplicate event
- `POST /api/tickets` → duplicate Freshdesk ticket
- `POST /api/disputes/notify` → duplicate email
- `POST /api/deals` → `.add()` auto-id, **duplicate deal on every retry**

**No client-side protection:** `apiFetch` sends no `Idempotency-Key` header and wraps
`fetch` with no `AbortController`, so there is no client timeout and no retry budget.

### `registerId` is destructive — VERIFIED BY ME

`id_registry` carries `UNIQUE (entity_type, internal_id)`, so one internal id may map to
only one `public_id`. `id-registry.ts:56-65` therefore does:

```sql
UPDATE id_registry SET public_id = $2
 WHERE entity_type = $1 AND internal_id = $3
   AND NOT EXISTS (SELECT 1 FROM id_registry WHERE entity_type = $1 AND public_id = $2)
```

**This rewrites the existing mapping.** Any write that resolves an existing row under a new
`public_id` — an account slug merge, a contact email merge, an `upsertActivity` matching by
`idempotency_key`, an `upsertScorecard` conflicting on `(activity_id, rubric_id)` —
silently unmaps the **old** `public_id`. `resolve_internal_id` then returns NULL for it,
and every child write keyed on the old id fails `unmapped_parent`.

That is a plausible contributor to J-008's fallback volume, and it is the kind of defect
that produces "it worked yesterday" reports.

---

## 4. JSONB semantics

**VERIFIED:** `post_call.detail` has **both** a correct key-level merge path
(`upsertDetailItem`, a single-statement `jsonb_set`) **and** whole-object replacement paths
(`upsertPostCall`, and a `COALESCE($3::jsonb, detail)` in `routes.ts`). The merge path is
safe across different keys; the replacement paths can erase everything the merge path
wrote. See **J-026** for the measured impact — 21 of 345 rows NULL, and 15 of 62 scored
calls without `detail`.

**DELEGATED:** `pre_call.research_brief` and `input_snapshot` are whole-object replacements,
and the synthesize path rebuilds `input_snapshot` from a **fixed allowlist**, dropping any
key not in that list. Same class as `detail`, unmeasured.

---

## 5. Concurrency scenarios

| Scenario | Verdict |
|---|---|
| two tabs finalising the same call | **UNSAFE (DELEGATED).** Both blob writes race with last-writer-wins; `ON CONFLICT (public_id)` serialises the SQL leg, but `idx_activity_idempotency` does not |
| re-analysis of a call that already has a `post_call` | **UNSAFE.** `upsertPostCall` overwrites wholesale; a repeated scorecard header **deletes all themes** first |
| retry after a timeout where the server already committed | **PARTIALLY UNSAFE.** Idempotency keys work for activity/pre_call/post_call; five routes duplicate outright (§3) |
| two writers on the same `public_id` | **mostly safe, one destructive edge** — `registerId`, §3 |
| projector running while a request writes | **safe for the claim** (`FOR UPDATE SKIP LOCKED`, and the enqueue is inside the request transaction so uncommitted rows are invisible); **unsafe for ordering** — claims are applied sequentially in JS with `{merge: true}`, so a stale partial payload can overwrite a newer field |

---

## 6. Recovery — the honest answer is "there is none"

**VERIFIED BY ME: there is no graceful shutdown anywhere.** A repo-wide search of
`worker/src`, `worker/scripts/dev-node.mjs` and `deploy/` for `SIGTERM`, `SIGINT`,
`gracefulShutdown` or `server.close` returns **zero hits**. `node-server.ts` calls
`.listen()` and installs no signal handler. There is no request draining and no
`closePool()` on shutdown.

Consequences:

| Event | Outcome |
|---|---|
| browser close mid-pipeline | **work lost.** `pipelineState` is a module variable, and `postcall.js` uses no `localStorage` — the post-call pipeline has no durable client state. The compute routes persist nothing, so resuming means paying full LLM cost again |
| worker restart | **in-flight work lost**, plus an in-memory read-model rebuild queue with a 60-second window is dropped silently, plus three fire-and-forget write paths (login telemetry, fallback telemetry, `ai_run` cost rows) |
| Cloud Run revision change mid-request | the request dies; committed SQL survives. For `POST /api/history` that means **the blob is written and the relational rows are not** — and the `[dual-write-DROPPED]` log line only fires if the process lives long enough to log it |

**Is there any resumable state?** No. `sql_fallback_log` is a *detection* mechanism, not a
*replay* one — **nothing reads it back and retries**. `sync_outbox` is the only genuinely
resumable queue, and it is populated **only in `dual` mode**, which means under the
default `sql` mode the queue, its reaper and its projector are all no-ops.

`clustering_state.running` is set `true` by the **client** and cleared only on the
client's success/failure paths, so a browser close leaves it `true` forever. The schema
comments claim a crashed pass "can be detected and the lock released" via `running_since`
— **DELEGATED: `running_since` has no reader anywhere.** There is no reaper.

---

## 7. Outbox

**VERIFIED BY ME:** `scorecard_theme` rows are enqueued
(`dual-write-repository.ts:242`) but `scorecard_theme` is **absent from
`COLLECTION_BY_ENTITY`** (`outbox.ts:32-42`, nine entries, none of them
`scorecard_theme`). `applyToFirestore` looks the collection up at `:48` and throws when it
is missing. So **in `dual` mode every theme write produces a poison row** that retries to
exhaustion and lands `failed`.

**DELEGATED:** delivery is **at-least-once** — the claim marks `processing` before the
Firestore apply and `completed` after, so a crash between re-delivers. Exactly-once is
impossible across two systems with no two-phase commit, and the apply is idempotent
(`set({merge:true})` / `delete()`), so at-least-once is the right design.

**There IS a reaper** — contradicting `SQL_QA_VALIDATION.md:44-46`, which records that
none exists. `claim_outbox_batch` re-queues rows stuck in `processing` for more than 10
minutes as its **first statement**. But it only runs when the projector is invoked, and
**nothing invokes the projector** (J-021: 236 pending). So a reaper that lives inside the
thing that is not running is not a reaper.

At 8 attempts a row goes `failed` permanently. There is **no dead-letter reader and no
alert.**

---

## 8. The five questions, per mutating route

The mandate requires every data-mutating route to answer five questions. A full table is
in the delegated inventory; the pattern across all of them:

| Question | System-wide answer |
|---|---|
| repeated request? | idempotent for activity/pre_call/post_call; **duplicates** for ARR overrides, contact events, tickets, dispute emails and deals |
| timeout after commit? | the client cannot distinguish "committed then died" from "refused" — **no route returns a commit receipt** |
| child write fails? | `{handled:false}` returned from *inside* the transaction **commits the partial writes**, then either 501s (sql mode) or double-writes to Firestore (dual) |
| safe to retry? | per-route; five are unsafe |
| incomplete state detected and resumed? | **detected** for some paths via `sql_fallback_log`; **resumed for none** |

---

## 9. What is genuinely sound

Worth recording, since the above is a long list of problems:

- **`withSessionContext` is correctly built** — transaction-scoped session variables set in
  their own statement, `ROLLBACK` on throw, `client.release()` in `finally`.
- **RLS fails closed.** `current_org_path()` returns NULL when unset, and `FORCE ROW LEVEL
  SECURITY` means even Cloud SQL's `postgres` gets zero rows without a session context —
  **verified live**.
- **The outbox claim is correct.** `FOR UPDATE SKIP LOCKED`, enqueue inside the caller's
  transaction, idempotent apply, bounded backoff, and a reaper. The design is right; only
  its scheduler is missing.
- **Partial unique indexes convert races into loud errors** rather than silent corruption.
  Unhandled, but loud — and loud is recoverable.
- **`upsertDetailItem` is a correct key-level JSONB merge** in a single statement. The right
  pattern already exists in the codebase; it just is not used by the write path that
  matters.

---

## 10. Coverage gap, stated plainly

Not done: lost-update reproduction, write-skew reproduction, two-tab finalisation,
retry-after-commit, deadlock ordering, pool exhaustion, request cancellation after commit,
outbox replay, migration rollback, and backup/restore assumptions.

All of these were to run against a disposable local PostgreSQL, which **exists and works**
(schema applies from zero, 42 files, idempotent). The harness is ready; the tests were not
written. That is the single largest unclaimed piece of this audit, and it is specified as
prompt **P-C1** in `14-implementation-prompts.md`.
