# callSummaries — thin list projection

List surfaces (dashboard, deal/account calls, manager views) read **`callSummaries`** (~2KB) instead of full **`postCalls`** docs (analysis blob). Detail views still load full `postCalls` by id.

New calls: `dual-write.js` writes `postCall` + `callSummary` in one Firestore batch.

## Deploy checklist

### 1. Firestore indexes (once per Firebase project)

From repo root (Firebase CLI required):

```bash
npx firebase-tools login
npx firebase-tools deploy --only firestore:indexes --project se-singha-paathi
```

On Windows PowerShell if `npm` is blocked:

```powershell
npx.cmd firebase-tools deploy --only firestore:indexes --project se-singha-paathi
```

Wait until all five **`callSummaries`** composites show **Enabled** in Firebase Console → Firestore → Indexes.

### 2. App code (VPS)

Production pulls branch **`2.1`** from **`antony`** (`antonyanbu25/lionpath_V2`). See [VPS_DEPLOY.md](./VPS_DEPLOY.md).

```bash
git fetch antony
git checkout 2.1
git pull antony 2.1
bash upgrade-now.sh   # or your usual restart
```

### 3. Backfill (optional — only if `postCalls` already has data)

**SEs do not run this.** One admin runs it once with a Firebase service account:

Firebase Console → Project settings → Service accounts → **Generate new private key**.

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"
node worker/scripts/backfill-call-summaries.mjs --dry-run
node worker/scripts/backfill-call-summaries.mjs
```

- Idempotent, resumable via `_migrations/callSummariesBackfill`
- **Skip entirely** if Firestore has no `postCalls` yet (prep-only / history-on-disk) — new post-calls populate both collections automatically after deploy

### 4. Large payloads (optional)

When `analysis` or `transcriptMeta` exceeds ~200KB, the worker offloads to GCS:

- Env: `CALL_PAYLOAD_BUCKET` (default `se-singha-paathi-call-payloads`)
- Paths: `calls/{callId}/analysis.json`, `calls/{callId}/transcript-meta.json`
- `postCall` stores `analysisGcsUri` + byte size only

## Collections

| Collection | Purpose |
|------------|---------|
| `postCalls` | Full call doc (detail view) |
| `callSummaries` | List projection (same doc id as postCall) |

## Smoke test

1. Run one post-call analysis after deploy
2. Firestore: new docs in **`postCalls`** and **`callSummaries`**
3. Dashboard / deal calls list loads without downloading full analysis blobs
