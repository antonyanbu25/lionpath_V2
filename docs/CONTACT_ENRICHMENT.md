# Contact enrichment API

Per-contact enrichment turns LinkedIn PDF text (and optional Zoom/Kaia excerpts) into structured profile fields and **inferred** DISC—not a formal assessment.

## Endpoint

`POST /api/contact/enrich` (authenticated)

### Request

```json
{
  "email": "prospect@company.com",
  "name": "Optional hint",
  "companyName": "Acme",
  "companyDomain": "acme.com",
  "sources": {
    "linkedinPdf": { "fileName": "Profile.pdf", "text": "…" },
    "zoomTranscriptExcerpt": "",
    "kaiaSummary": "",
    "kaiaMeetingUrl": "https://engage.freshworks.com/s/…",
    "additionalNotes": ""
  }
}
```

At least one source field must be non-empty. When `kaiaMeetingUrl` is set and `kaiaSummary` is empty, the worker resolves the public Engage share link (cached ~15 minutes per worker isolate) and fetches summary text server-side.

### Prompt size limits

| Source | Max chars in enrich prompt |
|--------|----------------------------|
| LinkedIn PDF | 16,000 |
| Zoom excerpt | 12,000 |
| Kaia summary | 12,000 |
| Additional notes | 4,000 |

Kaia fetch truncates summary to the Kaia cap before enrich. Larger values increase LLM cost and latency.

### Response

Profile (`totalExperience`, `priorEmployers`, `summary`, `skills`, …) plus `disc` with `inferred: true`, `confidence` (`low`|`medium` only), and `evidence` quotes.

## Kaia share content

`POST /api/kaia/share-content` (authenticated)

```json
{ "url": "https://engage.freshworks.com/s/p_…" }
```

Returns `{ ok: true, summary, title?, startTime?, participants?, summaryJson?, bundle?, transcriptExcerpt? }` or `{ ok: false, reason, error }`.

Supported URL formats (HTTPS, host allowlist **`engage.freshworks.com` only**):

- Short link: `https://engage.freshworks.com/s/{id}` (307 → `/kaia/share/{token}`)
- Direct share: `https://engage.freshworks.com/kaia/share/{token}`

### Per-prospect Kaia (heuristic v1)

Prep stores the full `bundle` from share-content. Before each enrich call, the client builds a **speaker-scoped excerpt** by matching prospect email/name to `summaryJson` speaker tags and participant names. If no match, enrich falls back to meeting-level summary with an explicit disclaimer line.

This is **not** full transcript diarization (P1 transcript API still future).

### Failure modes

| Reason | Typical cause |
|--------|----------------|
| `invalid_url` | Not an Engage Kaia share URL |
| `link_expired` / `expired` | Token or link past expiry |
| `forbidden` / `auth_required` | Link is not a public “anyone” share |
| `not_found` | Bad or revoked link |
| `empty_content` | API returned no summary blocks |

User-visible errors redact `/kaia/share/` token segments.

## Prep flow

1. Client matches PDFs to prospect emails (email in PDF, LinkedIn slug, or name).
2. If **Kaia meeting URL** is set, client calls `/api/kaia/share-content` once, sets `kaiaContent` + `kaiaSummary`, clears URL before enrich.
3. Worker `/api/prep/research` also resolves `kaiaMeetingUrl` or accepts `kaiaContent` / `kaiaSummary` (skips refetch when client already fetched).
4. Research **input hash** (playbook v2) includes Kaia URL ref + fingerprint of SE additional context so cache invalidates when those change.
5. Parallel enrich calls → per-prospect Kaia excerpts → `confirmedProspectProfiles` on synthesize.
6. Dual-write merges DISC + research into `Contact.metadata`; MEDDPICC stays on account.

## Zoom / Kaia sources

| Source | Status |
|--------|--------|
| `linkedinPdf` | Implemented |
| `zoomTranscriptExcerpt` | Client text; `fetchZoomExcerptForEnrich` stub |
| `kaiaSummary` | Per-prospect excerpt or meeting-level text |
| `kaiaMeetingUrl` | Resolved on worker when summary omitted (prefer single prep fetch) |

Prep form optional fields: Zoom URL/passcode, Kaia URL (collapsible).

## Ownership

| Data | Store |
|------|--------|
| DISC | Contact |
| MEDDPICC | Account (continuous merge) |
| Prep prospect card | Read-only mirror of contact enrichment for that run |
