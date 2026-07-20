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
    "additionalNotes": ""
  }
}
```

At least one source field must be non-empty.

### Response

Profile (`totalExperience`, `priorEmployers`, `summary`, `skills`, …) plus `disc` with `inferred: true`, `confidence` (`low`|`medium` for LinkedIn-only), and `evidence` quotes.

## Prep flow

1. Client matches PDFs to prospect emails (email in PDF, LinkedIn slug, or name).
2. Parallel enrich calls → `confirmedProspectProfiles` on synthesize payload.
3. Worker merges enrichments into `prospects[]` after validation (deterministic).
4. Dual-write merges DISC + research into `Contact.metadata`; MEDDPICC stays on account.

## Zoom / Kaia (provisioned)

| Source | Status |
|--------|--------|
| `linkedinPdf` | Implemented |
| `zoomTranscriptExcerpt` | Accepted when client passes text; `fetchZoomExcerptForEnrich` stub |
| `kaiaSummary` | Accepted when client passes text; `fetchKaiaSummary` returns `not_configured` |

Prep form optional fields: Zoom URL/passcode, Kaia URL (collapsible).

## Ownership

| Data | Store |
|------|--------|
| DISC | Contact |
| MEDDPICC | Account (continuous merge) |
| Prep prospect card | Read-only mirror of contact enrichment for that run |
