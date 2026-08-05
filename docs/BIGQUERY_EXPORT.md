# Firestore → BigQuery export (director analytics)

Operational reads stay on Firestore read-models (`teamMetrics`, `accountRollup`, etc.). Director-level analytics that need `GROUP BY`, cohort trends, and cross-org rollups run against BigQuery via the **Firebase Extension: Export Collections to BigQuery**.

## Collections to export

| Firestore collection | BigQuery dataset table | Used for |
|---------------------|------------------------|----------|
| `postCalls` | `postCalls_raw_*` | Call volume, funnel timing |
| `callSummaries` | `callSummaries_raw_*` | QIP trends without full postCall payload |
| `scorecardLines` | `scorecardLines_raw_*` | Theme-level heatmaps at org scale |
| `productGaps` | `productGaps_raw_*` | Gap frequency, clustering validation |

## Setup (GCP console)

1. Open [Firebase Extensions](https://console.firebase.google.com/) → your Lionpath project → **Extensions**.
2. Install **Export Collections to BigQuery** (official Firebase extension).
3. For each collection above, add an extension instance (or one instance with multiple collection paths if your extension version supports it):
   - **Collection path**: e.g. `postCalls`
   - **Dataset ID**: `lionpath_analytics` (create in BigQuery if needed)
   - **Table prefix**: `postCalls_raw`
   - **Location**: same region as Firestore (e.g. `us-central1`)
4. Grant the extension service account BigQuery Data Editor + BigQuery Job User on `lionpath_analytics`.
5. Deploy Firestore composite indexes required by export (extension docs list any `orderBy` indexes on exported fields).

## Environment variables (worker Node runtime)

Add to `worker/.dev.vars` / VPS env when querying BigQuery from the worker:

```bash
BIGQUERY_PROJECT_ID=your-gcp-project
BIGQUERY_DATASET=lionpath_analytics
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

The worker analytics route (`GET /api/analytics/director-summary`) uses these when set; otherwise it returns `503` with setup instructions.

## Verification

1. After extension install, write a test `postCalls` doc and confirm a row appears in BigQuery within a few minutes.
2. Run a sample query in BigQuery console:

```sql
SELECT
  DATE(TIMESTAMP_MILLIS(CAST(JSON_VALUE(data, '$.createdAt') AS INT64))) AS day,
  COUNT(*) AS calls
FROM `lionpath_analytics.postCalls_raw_*`
GROUP BY day
ORDER BY day DESC
LIMIT 30;
```

## Notes

- This is **additive** — no Firestore migration required.
- Raw export tables include a `data` JSON column (extension default). Create views for stable schemas if needed.
- Keep PII policy in mind: export includes attendee emails on postCalls; restrict BigQuery IAM to director roles.
