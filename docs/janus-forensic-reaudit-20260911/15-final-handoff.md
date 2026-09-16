# 15 — Final handoff

## Exact state

| Key | Value |
|---|---|
| Repository | `https://github.com/Antony-sagayaraj/SE-Labs` |
| Source branch | `main-with-functional-fix` |
| Source SHA | `5121bc4870a40dec793c98b98a38f8adbfef4789` |
| Working branch | `fix/janus-handover-and-forensic-reaudit-20260911` |
| Head SHA | `a10c6ed3a60a3befdbc42d582e685c4ee0676782` |
| Commits | 10 product/docs commits on top of the source |
| Worktree | clean |
| Pushed? | **NO** — see blocker B-06 |

**Note on the source ref:** `origin/main-with-functional-fix` and `origin/main` are the
**same commit** (`5121bc4`). The mandate treats them as distinct refs with distinct roles;
on the last-fetched state they are identical. `git fetch` could not be run (B-01), so refs
are as of **2026-09-11 16:01**.

---

## Do this first, in this order

1. **Read the deployed `PERSISTENCE_READ_MODE`.** One `gcloud run services describe`.
   It determines whether PostgreSQL is the system of record or a write-only log (J-028), and
   reframes half the roadmap. Prompt **P-A1**.
2. **Rotate three credentials** (P-A2): the Zoom passcode in 4 commits of history — also
   printed into this session's transcript, so treat as urgent — the **second, different**
   passcode in `worker/scripts/test-zoom-share-media.ts:117`, and the staging database
   password pasted in chat.
3. **Schedule the four dormant mechanisms** (P-B1). Configuration only, no code, closes
   four findings. Scheduling the outbox projector also restores crash recovery, because the
   reaper lives inside it.
4. **Add `activity_id` to the `ai_run` insert** (P-B2). One field turns 2816 orphan rows
   into a cost model; `latency_ms` and `retry_count` are already at 100%.
5. **Apply migration 37 to staging, then push and deploy.** Without 37, P5's telemetry
   silently fails on staging — so it gates the deploy, it is not a follow-up.

---

## Commands that reproduce this audit's evidence

```bash
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$PATH"   # node is not on PATH

# disposable local PostgreSQL (embedded-postgres devDependency, no Docker needed)
node worker/scripts/start-local-postgres.mjs        # NOTE: rewrites worker/.dev.vars

# the gates added this session
node scripts/scan-secrets.mjs                       # CI-gated secret scan
node worker/scripts/test-ci-foundation.mjs          # manifests, tags, schema paths, DB gates
npx tsx worker/scripts/test-route-authorization.ts  # P4, 20 assertions
npx tsx worker/scripts/test-provider-timeouts.ts    # P10, 21 assertions

# needs a local DB (loopback only — these refuse a remote host)
DATABASE_URL='postgresql://janus_app:janus_app_password@127.0.0.1:5432/janus' \
DATABASE_URL_MIGRATIONS='postgresql://postgres:password@127.0.0.1:5432/janus' \
  npm run test:sql-gates --prefix worker

# the Phase 2/3 browser invariants (move web/firebase-config.local.js aside first)
node web/scripts/test-postcall-intake-invariants.mjs
```

**Two traps that cost me time — check both before trusting any observation:**

- `node` is **not on PATH**; it is only at `~/.nvm/versions/node/v24.20.0/bin`.
- The dev servers on ports 8787/8788 were serving **two-day-old code**. Confirm with
  `ps -p $(lsof -ti :8788) -o lstart` before believing anything the UI shows.

---

## Blockers, and exactly what clears each

| ID | Blocker | What clears it |
|---|---|---|
| B-01 | `git fetch` fails — no credential helper | a PAT or credential helper |
| B-03 | no JDK | `brew install --cask temurin@21` — unblocks `test:rules` and the emulator lane |
| B-04 | no `gcloud` | install the Cloud SDK — unblocks Cloud Run config, logs, IAM, probes, and **P-A1** |
| B-06 | `pre-push` hook blocks the destination **and POSTs a `GIT_PUSH_POLICY_VIOLATION`** to `ghc.freshpo.com` with your name and email | allowlist the repo, or a deliberate human decision to bypass. **Not taken here** |
| B-07 | no staging `janus_app` credential | provision one — it is the only way any staging RLS claim can meet the mandate's bar |
| B-08 | `POST /api/history` 200 vs truthful persistence | an architectural decision: is the blob authoritative, or a projection? |
| B-09 | migration 37 unapplied on staging | approve the DDL. **Prerequisite for deploying P5** |
| B-10 | 16 e2e specs blocked by `networkidle` vs a looping video | prompt **P-D1**, mechanical |

---

## What was NOT done, plainly

- **Concurrency and failure-injection tests were not written.** The harness works; this is
  the largest unclaimed piece of the audit. Prompt **P-C1**.
- **No journey was proven end to end** — none of the 18. No `janus_app` credential, no live
  session, no Zoom credentials.
- **No staging RLS claim meets the evidence bar.** All positive RLS evidence is from the
  local cluster.
- **No `EXPLAIN ANALYZE`** — a deliberate omission at ~4000 max rows, with a CI
  plan-regression gate specified instead.
- **Security areas untouched:** SQL-injection sweep, CORS/CSRF/XSS, upload handling, OAuth
  lifecycle, and **prompt injection from transcript content**.
- **Nothing was deployed. No staging DDL or DML. `main` and `main-with-functional-fix`
  untouched. Git history not rewritten.** Staging object counts re-verified unchanged at
  gate time: 64 tables, 16 views, 53 policies, and migration 37 confirmed absent.

---

## One thing to carry forward

Four separate mechanisms in this system are **built, correct, and invoked by nothing** —
the outbox projector, the usage rollup, PII redaction, and the audit log. That is the most
repeated defect class in the codebase, and it is also the cheapest to fix.

The generalisation worth keeping: **this system's failures are overwhelmingly failures of
invocation and observation, not of implementation.** The code is largely right. It writes
to stores nothing reads, runs jobs nothing schedules, and reports success for work that did
not happen. Every one of the six CRITICAL findings is an instance of that pattern.
