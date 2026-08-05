# Cost control — four layers

Production cost protection for **SE Singha Paathi** (`se-singha-paathi`). Budgets alert; quotas and the worker circuit breaker actually cap spend.

| Layer | Mechanism | Caps spend? | Setup |
|-------|-----------|-------------|-------|
| **1. Cloud Billing budget** | GCP budget alerts at 50/80/100/150% | No — alerts only | `deploy/gcp/setup-billing-budget.sh` or Console |
| **2. Gemini API quotas** | Requests/minute + requests/day on API key | Yes — hard API ceiling | GCP / AI Studio Console (manual) |
| **3. Worker token budget** | Per-user daily token budget in Firestore | Yes — blocks LLM before call | Code + env vars (automatic when Firestore configured) |
| **4. Pass 7 anomaly alert** | Summarise tokens/call > rolling p95 × 2 | No — detects prompt regressions | Code + optional webhook |

---

## Layer 1 — Cloud Billing budget

**Project:** `se-singha-paathi`

### Automated (gcloud)

```bash
export BILLING_ACCOUNT_ID=XXXXXX-YYYYYY-ZZZZZZ   # gcloud billing accounts list
export MONTHLY_BUDGET_USD=1500                    # agreed monthly figure — adjust with finance
export ALERT_EMAIL_USER=se-lead@freshworks.com
export ALERT_EMAIL_DIRECTOR=director@freshworks.com
bash deploy/gcp/setup-billing-budget.sh
```

Script: `deploy/gcp/setup-billing-budget.sh`

### Manual (Console)

1. [Billing → Budgets & alerts](https://console.cloud.google.com/billing/budgets)
2. Create budget → filter **projects/se-singha-paathi**
3. Amount: agreed monthly USD (placeholder **$1,500** — replace with finance sign-off)
4. Threshold rules: **50%, 80%, 100%, 150%** of budget (current spend)
5. Email notifications: SE lead + director

---

## Layer 2 — Gemini API quotas

Hard ceiling on API calls. Size at **~2× expected 80-SE volume**.

### Volume math

| Input | Value |
|-------|-------|
| Active SEs | 80 |
| Post-calls / day (org total) | 320 (= 4 calls/SE/day avg) |
| LLM API calls / post-call | ~9–12 (Pass 7 alone = **3** under `passName: summarise`) |
| Pre-call briefs / day (estimate) | ~160 (2/SE/day, ~18 LLM calls cold) |

**Post-call API calls/day:** 320 × 10 ≈ **3,200**

**Pre-call API calls/day:** 160 × 18 ≈ **2,880**

**Combined baseline:** ~**6,100 requests/day**

**Recommended quotas (2× headroom):**

| Quota | Recommended | Notes |
|-------|-------------|-------|
| **Requests per day** | **12,000** | 2× ~6,100 combined prep + post-call |
| **Requests per minute** | **120** | Covers confirm-and-generate parallel burst (~6 concurrent LLM calls × ~10 active users) |

### AI Studio API key (VPS production)

1. [Google AI Studio → API keys](https://aistudio.google.com/apikey)
2. Select the production key used in VPS `.env` (`GEMINI_API_KEY`)
3. **Set quota** (if exposed on key) or use Cloud Console:

### Cloud Console (Generative Language API)

1. [APIs & Services → Enabled APIs → Generative Language API](https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com?project=se-singha-paathi)
2. **Quotas & System Limits**
3. Filter **Requests per minute** → edit → **120**
4. Filter **Requests per day** → edit → **12,000**

Request increases via **Edit Quotas** if defaults are lower.

> Batch API jobs (`/api/internal/batch/*`) share the same key on VPS — include batch volume in daily headroom or use a separate key for batch.

---

## Layer 3 — Worker daily token budget (circuit breaker)

Implemented in code. Checked **before every wrapped LLM `generate()`** call (`worker/src/providers/index.ts` → `reserveDailyTokenBudget`).

### Behaviour

- Firestore doc per user per UTC day: `userDailyTokenUsage/{userId}_{YYYY-MM-DD}`
- Before each LLM call: reserve `DAILY_TOKEN_BUDGET_RESERVE` tokens (default **120,000**) in a transaction
- After call: settle to actual `promptTokens + outputTokens`
- On breach: HTTP **429** with message *"Daily analysis limit reached…"*
- Protects against client retry loops without spending

### Env vars (VPS `.env`)

```bash
# Enabled when FIREBASE_PROJECT_ID + service account are set (default: on)
DAILY_TOKEN_BUDGET_ENABLED=1

# Per-user daily token ceiling (default: 8000000 = 8M tokens)
DAILY_TOKEN_BUDGET_PER_USER=8000000

# Reservation per LLM call before provider runs (default: 120000)
DAILY_TOKEN_BUDGET_RESERVE=120000
```

### Recommended values

| Setting | Default | Rationale |
|---------|---------|-----------|
| `DAILY_TOKEN_BUDGET_PER_USER` | **8,000,000** | ~4 full post-call runs + 1 cold prep at typical transcript sizes |
| `DAILY_TOKEN_BUDGET_RESERVE` | **120,000** | Limits parallel-pass overshoot at confirm-and-generate |

Disable locally: `DAILY_TOKEN_BUDGET_ENABLED=0`

### Firestore schema

**Collection:** `userDailyTokenUsage`

| Field | Type | Description |
|-------|------|-------------|
| `userId` | string | Firestore user id |
| `dateKey` | string | UTC `YYYY-MM-DD` |
| `totalTokens` | number | Running total (includes in-flight reservations) |
| `reservedTokens` | number | Tokens reserved for in-flight calls |
| `limitTokens` | number | Snapshot of limit at first write |
| `createdAt` / `updatedAt` | number | Epoch ms |

Admin reads via Firestore Console or future admin API extension.

### Not covered (known gap)

Direct Gemini HTTP calls that **bypass** `wrapWithUsageRecording` are not gated:

- `worker/src/embeddings.ts` (gap clustering)
- `worker/src/video/transcript-infer.ts`, `worker/src/video/vision.ts`

These are low volume relative to prep/post-call. Add `reserveDailyTokenBudget` there if needed.

---

## Layer 4 — Pass 7 (summarise) usage anomaly alert

**Pass 7** = post-call summarise (`passName: summarise`, **3 LLM calls per post-call**).

After each summarise usage row is written, the worker compares **total summarise tokens for that `callId`** against **rolling p95 × multiplier** (default **2×**).

### Behaviour

- Baseline: p95 of per-call summarise token totals over last **14 days** (min **5** samples before alerting)
- Stored in `llmUsageBaselines/summarise` (refreshed every 6h)
- Alert once per call: `costAlerts/{callId}_summarise`
- Logs: `[cost-alert] Pass 7 summarise anomaly: …` (wire Cloud Logging alert policy)
- Optional webhook: `COST_ALERT_WEBHOOK_URL`

### Env vars

```bash
SUMMARISE_ANOMALY_ENABLED=1
SUMMARISE_ANOMALY_MULTIPLIER=2
SUMMARISE_ANOMALY_BASELINE_DAYS=14
COST_ALERT_WEBHOOK_URL=                        # optional Slack/PagerDuty webhook
```

### Firestore index

Anomaly baseline query filters `llmUsage` by `passName == summarise` and `createdAt >=`. Ensure composite index exists (Firebase will prompt with a link on first failure):

- Collection: `llmUsage`
- Fields: `passName` Asc, `createdAt` Desc

Per-call aggregation query: `callId` + `passName` (single-field indexes usually sufficient).

### Cloud Logging alert (optional)

Create log-based metric on:

```
textPayload=~"\\[cost-alert\\] Pass 7 summarise anomaly"
```

Notify director channel when count > 0 in 1 hour.

---

## Deploy checklist

1. **Finance:** agree `MONTHLY_BUDGET_USD` → run billing budget script or Console setup
2. **GCP admin:** set Gemini API quotas (12k/day, 120/min)
3. **VPS:** add cost env vars to `.env`, rebuild worker (`bash upgrade-now.sh`)
4. **Verify Firestore** credentials (`FIREBASE_PROJECT_ID`, service account)
5. **Optional:** `COST_ALERT_WEBHOOK_URL` for Pass 7 regressions
6. **Firestore indexes:** run one post-call summarise after deploy; create index if prompted

---

## Related code

| File | Role |
|------|------|
| `worker/src/cost-control-config.ts` | Env parsing, defaults |
| `worker/src/data/token-budget.ts` | Daily circuit breaker |
| `worker/src/data/usage-anomaly.ts` | Pass 7 p95 alert |
| `worker/src/data/llm-usage.ts` | Usage persistence + anomaly hook |
| `worker/src/providers/index.ts` | Budget gate on all wrapped providers |
| `worker/src/routes/admin-llm-usage.ts` | Director cost dashboard |
| `deploy/gcp/setup-billing-budget.sh` | Layer 1 automation |

See also README § LLM usage tracking (2.1).
