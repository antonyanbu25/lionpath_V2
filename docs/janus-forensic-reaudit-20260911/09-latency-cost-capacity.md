# 09 — Latency, cost and capacity

The mandate says to **measure rather than estimate wherever staging access permits**. It
permits very little: no `gcloud` for Cloud Run metrics or logs (B-04), no `janus_app`
credential to exercise the runtime read path (B-07), and no live authenticated session for
browser waterfalls against real data. So this document is explicit about which numbers are
**measured**, which are **derived from live data**, and which are **static analysis only**.

I have not padded it with estimates dressed as measurements.

---

## 1. What was actually measured

| Measurement | Value | Method |
|---|---|---|
| Post-call intake request count, one gesture | **1 submit + 1–2 warm-ups** | real browser, `page.route` interception, per-request stack attribution (E-044, E-045) |
| Warm-up debounce | 800ms (`postcall.js:661`) then one `POST /api/postcall/resolve` | observed at t≈2783ms after typing began |
| `#analyze-call` first-paint settling | disabled at 133ms, visible at 495ms, **no enabled-while-empty window** | rAF sampling from first existence (E-047) |
| Page load requests to first idle | **195 requests in 12.3s**, then **0 new after 5s** | Playwright request log |
| Requests that never complete | **1** — `/assets/login-bg.webm`, a looping `<video>` | pending-request probe (E-049) |
| Provider timeout budgets | 10s auth / 20s Zoom API / 30s embeddings / 60s Zoom download / 120s transcript inference; Gemini 45–90s per workload | `fetch-timeout.ts`, `gemini-retry.ts:90-101` |
| Hung-socket bound | gives up at the budget, verified against a real non-responding loopback server | E-072 |
| Web bundle | **373.4 KB**, byte-identical to baseline | `npm run build` |
| Schema apply, 42 files, from zero | completes; 64 tables / 16 views / 237 routines / 288 indexes | E-064 |
| Staging TCP latency | **65ms** to `8.231.110.188:5432` | network gate |
| PostgreSQL auth handshake | **442ms median** (n=20); the 2358ms single sample was an outlier | re-measured, see §4 |

## 1a. Measured per-pass latency — this IS measurable today

`ai_run.latency_ms` is populated on **2816 of 2816 rows (100%)**, so provider latency per
pass is measurable right now without any unblocking. Measured on staging:

| Overall | Value |
|---|---|
| mean latency | **2775 ms** |
| max latency | **30,289 ms** |
| rows with `latency_ms` | 2816 / 2816 (100%) |
| rows with `retry_count` | 2816 / 2816 (100%) |
| rows with `input_tokens` | 2816 / 2816 (100%) |
| rows with `cost_usd` | **2060 / 2816 (73%)** — 756 rows carry no cost |

Slowest passes by mean latency:

| Pass | runs | mean latency |
|---|---|---|
| `synthesize` | 69 | **9569 ms** |
| `scorecard` | 159 | **7037 ms** |
| `analyze` | 170 | 4890 ms |
| `video/vision` | 39 | 4236 ms |
| `commit` | 173 | 4207 ms |
| `rivals` | 41 | 4025 ms |
| `demo-guidance` | 41 | 3229 ms |
| `research` | 200 | 3178 ms |

**This validates P10's timeout budgets against real data**, which is worth stating because
the budgets were sized from documented p95 estimates, not measurements:

| Workload | Budget | Observed mean | Headroom |
|---|---|---|---|
| `synthesize` | 90,000 ms | 9569 ms | ~9× |
| `postcall` (`scorecard`, `analyze`, `commit`) | 75,000 ms | 4207–7037 ms | ~11–18× |
| `vision` | 60,000 ms | 4236 ms | ~14× |
| `extraction` (`rivals`, `demo-guidance`, `research`) | 45,000 ms | 3178–4025 ms | ~11–14× |

The single slowest observed call was **30.3s**, against the tightest relevant budget of
45s. So the budgets are generous rather than tight — which is the correct bias for a
timeout whose job is to bound a hung socket, not to fail slow-but-working providers. **No
budget needs changing.**

**A secondary cost gap:** 756 `ai_run` rows (27%) have a NULL `cost_usd` while having
tokens and latency. So even the aggregate spend figure below understates actual cost, and
by an unknown margin.

## 2. Cost, from live data

| Measure | Value |
|---|---|
| `ai_run` rows | **2816** |
| total recorded cost | **$1.1365** |
| input tokens | **16,700,036** |
| output tokens | 1,618,844 |
| rows joinable to a call | **4 (0.14%)** |
| rows with a `user_id` | 466 (16.5%) |

Per-pass distribution: `analysis` 1009, `pre_call` 554, `scoring` 454, `detail` 433,
`signal_extract` 131, `transcript_infer` 90, NULL 55, `contact_enrich` 51, `vision` 39.

**The capacity conclusion that matters is not the total — it is that the total is all you
can have.** With 0.14% attribution, none of the questions a cost review exists to answer
can be answered: cost per call, cost per account, cost per SE, which pass regressed, or
whether a given SE's spend is anomalous. `worker/src/data/usage-anomaly.ts` implements
anomaly detection over this table.

Aggregate cost is low ($1.14 across 2816 runs), so **there is no current spend emergency** —
the finding is that spend is *unobservable*, which becomes an emergency only after it
matters.

## 3. Request duplication

| Finding | Status |
|---|---|
| Post-call submit duplication | **does not occur** — invariant proven across 5 scenarios (E-045) |
| Warm-up amplification | **one warm-up per distinct recording link.** A paste-then-correct sequence produced 2. Each is a full server-side Zoom resolve (OAuth mint, recording lookup, VTT download) whose result is discarded by design |
| Saved-call open: "six `innerHTML` repaints, ≥10 requests, one duplicate query" (F-029) | **NOT re-measured.** Needs a live authenticated session with real call data |
| Serial Pass 0 / classify blocking the gate (F-018) | **NOT re-measured** — same blocker |
| Contact enrichment serial loop (F-018) | **NOT re-measured** |

The three F-029/F-018 performance findings are the ones a latency review most wants, and
all three remain `UNVERIFIED` on this branch. They need journey access, not more static
reading.

## 4. The handshake lead — RE-MEASURED, and largely deflated (roadmap 4.5)

**The 2358ms figure is not reproducible.** It was a single sample, correctly flagged here
as "a lead, not a finding", and re-measuring it across 20 sequential connections shows it
was an outlier by roughly 5x.

Measured twice against the staging instance over the public IP, 20 samples each
(`worker/scripts/measure-pg-handshake.mjs`, read-only — it opens connections and runs
`SELECT 1`):

| phase | n | min | median | p95 | max |
|---|---|---|---|---|---|
| TCP connect (network floor) | 20 | 55.5 | **60.9** | 67.5 | 67.5 |
| FULL connect (TCP + TLS + startup + auth) | 20 | 414.0 | **441.9** | 493.5 | 493.5 |
| `SELECT 1` on an open connection | 20 | 57.5 | **61.7** | 66.3 | 66.3 |
| **pooled acquire + `SELECT 1`** | 20 | 57.8 | **59.0** | 64.0 | 64.0 |

Three things follow, and they change the conclusion:

**1. The gap is ~7.5x TCP, not ~36x.** Median cold connect 442ms against 61ms TCP. The
original 2358ms was not the typical cost.

**2. It is genuinely per-connection, not a one-off.** First connect vs the median of the
rest was 1.11x in one run and 1.84x in another — noisy, but nowhere near the >3x a
first-contact effect (DNS, TLS session ticket) would produce. Every cold connection really
does pay ~390ms above TCP.

**3. But a warm pool amortises it completely.** Pooled acquisition plus a query is
**1.04x TCP** — indistinguishable from a single round trip. So the ~390ms is paid on
connection ESTABLISHMENT only, and a healthy pool pays it approximately never.

**Therefore §4's original escalation is overstated.** This is not "the most likely real
bottleneck" for steady-state latency. The real exposure is connection **churn**: Cloud Run
cold starts, a pool `max` too low for the configured concurrency, or pool thrash — any of
which converts an amortised cost back into a per-request one. That reframes the open
question from "how slow is auth" to "how often do we open a cold connection", which is
still worth answering and is still `RUNTIME-BLOCKED` on the deployed `max` versus Cloud
Run's concurrency setting.

### The caveat that matters most

**These absolute numbers do not transfer to Cloud Run.** `SELECT 1` on an already-open
connection costs 61.7ms — essentially identical to the 60.9ms TCP connect — which means
both are dominated by one network round trip from *this* host to the instance over the
public internet. A Cloud Run instance in the same region as the Cloud SQL instance sees an
RTT one to two orders of magnitude smaller.

What transfers is the **ratio**: the handshake costs about **7.5 round trips**, and a
pooled acquire costs about **1**. Applied to a same-region RTT of ~1ms, the cold-connection
penalty is single-digit milliseconds, not hundreds. Applied to the original 2358ms reading,
the implied RTT would be ~310ms — which is itself evidence that sample was taken under
transient network conditions rather than measuring Cloud SQL.

### What was NOT done

**The Auth Proxy comparison.** §4 asked for "with and without the Auth Proxy" and only the
direct public-IP path is measured — the proxy is not installed here and installing it
changes the host's network posture. It remains the right next experiment, because the
~7.5-round-trip handshake is where `sslmode=require` with `rejectUnauthorized: false`
(`pg-client-config.mjs`) and TLS negotiation against a Google-managed cert chain both land.
Note that the proxy is a **security** requirement independently of latency: that file's own
header says production must use the Auth Proxy or private IP, where `rejectUnauthorized`
stays true.

---

## 5. Database shape and query-plan work

Static facts (measured): 64 tables, **288 indexes**, 50 policies, 13 triggers, 16 views.
Largest tables by live row estimate: `scorecard_line` 3990, `ai_run` 2802,
`id_registry` 1839, `rubric_parameter` 1350, `sql_fallback_log` 1250 (now 1341),
`scorecard_theme` 860, `deal_stage_history` 455, `deal` 454.

**No `EXPLAIN (ANALYZE, BUFFERS)` was run.** The mandate permits it on non-mutating
staging queries, and I judged the value low at this data volume: the largest table has
~4000 rows, so almost any plan is fast and a plan captured now would not predict behaviour
at 100× the data. **Recorded as a deliberate omission, not an oversight.** The useful
version of this work is a plan-regression gate in CI against a seeded dataset, which is
specified in the roadmap.

One structural observation from the schema that does not need a plan: `v_deal_counters`
(`24_task_write_path.sql:119`) replaced stored counters with derived counts, and
`v_post_call_detail_items` (`31_remaining_collections.sql:196`) projects every item inside
`post_call.detail` as rows. Both are correctness improvements that trade compute for
consistency, and both will be the first views to need attention as `post_call` grows.

## 6. Capacity risks, ranked by what is actually known

1. **Unobservable spend** (J-019) — 0.14% attribution. Not a throughput risk; a governance
   one. You cannot cap what you cannot attribute.
2. **236 pending outbox rows and growing** (J-021) — an unbounded queue with no reaper and
   no scheduler is a capacity problem that gets worse on its own.
3. **Pool sizing versus Cloud Run concurrency** — still `RUNTIME-BLOCKED`, but reframed:
   the handshake is ~7.5 round trips and a warm pool amortises it to ~1, so the question is
   how often a COLD connection is opened (cold starts, `max` too low, thrash), not how slow
   auth is. See §4.
4. **Browser-as-job-runner** (F-008) — the transcript lives in a module global and the
   pipeline runs in the tab, so per-user capacity is bounded by the tab staying open. This
   is architectural and unchanged.
5. **Warm-up amplification** — bounded by user behaviour, not by code. Low impact; worth
   knowing because it explains the reported "three requests".
6. **Bundle size** — 373.4 KB, unchanged. Not a risk today.

## 7. Coverage boundary

Not done, and why:

| Mandate item | Status |
|---|---|
| browser waterfalls for 10 journeys | **blocked** — needs a live authenticated session with real data |
| server spans | **blocked** — needs Cloud Run tracing (B-04) |
| p50/p95/p99 | **blocked** — no sample population; single-request timings only |
| `EXPLAIN (ANALYZE, BUFFERS)` | **deliberately skipped** at ~4000 max rows; specified as a CI gate instead |
| rows scanned, N+1 detection | **not done** — needs the plans above |
| cache hit/miss/staleness | **not done** |
| provider latency per pass | **DONE — see §1a.** `latency_ms` is 100% populated, so this needed no unblocking at all. Mean 2775 ms, max 30,289 ms, per-pass table above |
| cold start / revision effects | **blocked** (B-04) |

**The single highest-value unlock:** fixing `ai_run` attribution (J-019). Everything
needed for per-call, per-account and per-SE analysis is **already being written** —
`latency_ms` and `retry_count` at 100% coverage, `input_tokens` at 100%, `cost_usd` at
73%. The data is there; only the join key is missing. Adding `activity_id` to the insert
turns 2816 orphan rows into a full cost-and-latency model with no new instrumentation.

**A correction against my own first pass at this document:** I initially listed per-pass
latency as blocked. It was not — `latency_ms` was fully populated all along, and §1a is
the result. The lesson generalises: three of the items in the table above may likewise be
cheaper than they look, and should be attempted before being declared blocked.
