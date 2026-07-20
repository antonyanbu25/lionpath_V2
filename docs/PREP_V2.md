# Pre-call Prep v2 — Grounded Research

Prep v2 replaces the one-shot LLM+search pipeline with a deterministic **research → extract → synthesize → validate** flow. Account and Contact records cache research for 30 days.

## Architecture

```
Form (company + domain + emails)
  → POST /api/generate-prep
  → normalize + cache check
  → [Apollo enrich] + fixed playbook searches (Gemini + google_search, temp 0)
  → extract facts (temp 0, no search)
  → synthesize brief (temp 0, no search, PREP_SCHEMA)
  → validate-prep (force "unknown" for low-confidence claims)
  → persist Account.metadata.research + Contact.metadata.research
```

### API routes

| Route | Purpose |
|-------|---------|
| `POST /api/generate-prep` | Full pipeline (default UI flow) |
| `POST /api/prep/research` | Research only — returns facts for human confirmation |
| `POST /api/prep/synthesize` | Synthesize from `confirmedFacts` + optional `researchBundle` |

### Request fields

```json
{
  "companyName": "Acme Corp",
  "companyDomain": "acme.com",
  "prospectEmail": "alex@acme.com",
  "prospectEmails": ["alex@acme.com"],
  "prepType": "new_business",
  "forceRefresh": false,
  "cachedResearch": { "...": "optional client-side cache" }
}
```

`prepType: "expansion"` returns **501** until Bikal/SF integration is built.

## Playbook (v1)

Fixed queries — same inputs → same query list:

1. `site:{domain} (about OR company OR "who we are")`
2. `site:{domain} (support OR help OR careers OR jobs)`
3. `site:{domain} (zendesk OR intercom OR freshdesk OR "help center")`
4. `"{companyName}" news OR funding`
5. Per prospect: `"{local-part}" "{companyName}" site:linkedin.com/in`

## Account / Contact cache

**Account.metadata:**

```typescript
{
  research: {
    lastResearchedAt, inputHash, facts[], sources[], snippets[],
    playbookVersion: "1", enrichmentProvider?: "apollo" | null
  },
  firmographics?: { industry, employeeRange, hqCountry },
  sfAccountId?: string,      // expansion — not wired yet
  bikalAccountId?: string   // expansion — not wired yet
}
```

**Contact.metadata:**

```typescript
{
  research: { lastResearchedAt, experienceSummary, priorEmployers[], competitorTouchpoints[], sourceUrls[] },
  disc?: { profile, assessedAt }  // Phase 4 slot only
}
```

**TTL:** 30 days. Client sends `cachedResearch` on repeat preps; worker skips playbook on cache hit.

## Apollo enrichment (Phase 2)

### Operator checklist

1. Sign up at [apollo.io](https://www.apollo.io) with Freshworks work email
2. **Settings → API** → create API key (paid seat for production volume)
3. Store key: `wrangler secret put APOLLO_API_KEY` and add to `worker/.dev.vars` locally
4. Confirm internal policy for storing enriched contact data (GDPR, vendor DPA)
5. Do **not** commit API keys

### Integration

`worker/src/enrichment/apollo.ts`:

- `organizations/enrich?domain=` — firmographics + account facts
- `people/match?email=` — per prospect (up to 5)

When `APOLLO_API_KEY` is set, Apollo runs before playbook; playbook fills gaps (support stack, news).

**Estimated credits per prep (cache miss):** 1 org + up to 5 people ≈ 6 credits.

## Expansion path (provision only)

- `prepType: "expansion"` → future Bikal adapter (501 today)
- Read-only SF: `Account.metadata.sfAccountId`
- No write-back to Salesforce in v1

## Human-in-the-loop

1. UI shows **Confirm company** modal (`companyName` + `companyDomain`) before research
2. Optional two-step API: `/api/prep/research` → user confirms facts → `/api/prep/synthesize`

## Evaluation

```bash
cd worker
node scripts/eval-prep-golden.mjs
```

Fixtures in `worker/testdata/prep-golden/`. Metrics: accuracy, stability (3-run field match), hallucination rate (claims without URL).

## Success criteria (Phase 1)

| Metric | Target |
|--------|--------|
| Stability | Same input, 3 runs: ≥80% fact fields identical |
| Hallucination | ≥90% facts/signals have valid URL or `"unknown"` |
| Cache | Second prep same domain within TTL skips playbook |
| Latency | p50 ≤ 60s |
