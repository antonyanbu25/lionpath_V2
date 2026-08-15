# SE Metrics Reporting Workflow

Pre-call and post-call report generation for Kuttan (SE, NB team).

## Inputs
- Zoom meeting data: date, duration, participant email → unique call ID
- Firestore: previous call records, deduplicated by zoom_call_id + date + duration
- Human signal: meeting context (who, what, outcome)

## Stages

1. **COLLECT** — Fetch Zoom data for the reporting period.
2. **DEDUP** — Apply unique call dedup: `zoom_call_id + date + duration` → one record.
3. **ENRICH** — Add human context from last 3 sessions (session_search).
4. **REPORT** — Generate pre/post-call narrative using GLM-5.2.
5. **VERIFY** — Cross-check: did we already report this call? Check Firestore.
6. **PUBLISH** — Write to Google Sheets via gws CLI.

## Dedup Key (Critical)
```
UNIQUE_CALL_KEY = f"{zoom_call_id}::{call_date}::{duration_minutes}"
```
If this key already exists in Firestore for this SE, SKIP — do not count again.

## Output
- Google Sheets row: SE name, date, call_count_unique, total_duration, context
- Inner monologue: emit "decision" thought when report is generated
