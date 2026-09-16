# ADR 006 — Product insight: gaps, taxonomy, and PM curation

| Status | Accepted |
|--------|----------|
| Date | 2026-07-24 |
| Context | [ENTITY_CATALOG.md](../ENTITY_CATALOG.md) gates `ProductInsight` until PM curation is scoped; [POST_CALL_SPEC_V2.md](../POST_CALL_SPEC_V2.md) §8 and §10 now define that scope |
| Supersedes | None (opens the `ProductInsight` gate in ENTITY_CATALOG) |
| Related | [ARCHITECTURE.md](../ARCHITECTURE.md), [RBAC.md](../RBAC.md), [BUILD_ALIGNMENT.md](../BUILD_ALIGNMENT.md) §6, [adr/003-account-deal-engagement.md](./003-account-deal-engagement.md) |

---

## Context

Post-call Pass 6 extracts **product gaps** (negative signal) and **what landed** (positive signal) from every analyzed call. Spec §11.10 ("Product signal") and §11.4 (call record "Product signal" tab) need these objects **queryable across calls, deals, accounts, and SEs** — filtered by taxonomy, clustered by theme, split real vs enablement, and curated before they enter a PM dashboard.

Today:

- `PostCallDoc.analysis` is an **opaque blob**; narrative fields that nobody queries may live there.
- [ARCHITECTURE.md](../ARCHITECTURE.md) extension rule 1: **new audience → new entity type + new role**, not new columns on PostCall.
- [ENTITY_CATALOG.md](../ENTITY_CATALOG.md) explicitly gates `ProductInsight` until "PM curation workflow is scoped."
- [RBAC.md](../RBAC.md) already anticipates a future `pm` role for org-wide gap reads; product signal is blocked until that role and its collections exist.

**Forces**

1. Product managers need **org-wide** reads of gap rows and clusters — outside SE `ownerId` / manager `teamId` boundaries.
2. Roughly a third of extracted "gaps" are **enablement gaps** (product already does it; SE did not know). Wrong routing wastes PM time and misses the real fix.
3. A **flat single-axis taxonomy** fragments cross-cutting themes (e.g. data residency raised against AI, knowledge, and channels on five ASEAN deals becomes three unrelated rows).
4. Customer **verbatims** are PII-bearing; retention and export need explicit policy before the first dashboard ships.
5. Spec §8 **Governance** fixes taxonomy shape, versioning, Other-bucket cadence, and clustering over embeddings — the gate ENTITY_CATALOG was waiting on.

---

## Decision

Adopt **three extension collections** (`product_gaps`, `gap_clusters`, `what_works`) as the concrete `ProductInsight` lane; a **versioned two-axis taxonomy**; **model-first gap-type classification with human arbitration**; a **PM-owned curation workflow**; a new **`pm` role**; and **retention rules** with explicit human flags where legal/org policy is required.

---

### 1. Collections (extension lane)

Three collections. None modify `PostCall`, `PrepBrief`, or `Deal` schemas beyond existing FK references.

#### `product_gaps` (`productGaps`) — per-call negative signal

**Owns:** One structured gap surfaced on one call — taxonomy classification, customer verbatim, disposition, deal impact, gap type (real vs enablement), competitor context, ARR touched (snapshot from call), embedding, curation status, link to cluster.

**Does not own:** Cross-call rollups, PM-facing cluster labels, deal-level TC state, or positive "what landed" rows (those live in sibling collections).

**Why not PostCall columns:** Gaps must be queried org-wide by `product_area`, tag, `gap_type`, status, and cluster — filters a blob cannot serve. Spec §11.10 closes the loop ("every gap shows the SE what happened to it"); that requires addressable rows, not arrays on the call document.

**Natural keys / FKs:** `postCallId`, `dealId`, `accountId`; denorm `ownerId`, `teamId`, `orgId` from the call for SE/manager visibility on the call record; org-wide PM reads bypass owner scope via `pm` role.

**ID prefix:** `pgap_` (register in ID_STANDARDS before code).

#### `gap_clusters` (`gapClusters`) — cross-call aggregation

**Owns:** PM-facing cluster — human label, embedding centroid (or reference vector id), `dealCount`, `arrTotal`, status, taxonomy version used when labeled, optional `productArea` + `crossCuttingTags[]` summary (derived, not authoritative per gap).

**Does not own:** Individual gap rows, verbatims, or per-call evidence. Gaps reference a cluster via optional `clusterId`; cluster membership is recomputed/async, not embedded as unbounded arrays on the cluster doc (Firestore extension rule 3).

**Why separate:** Clustering is an **async pipeline** over embeddings (spec §8: "cluster over embeddings of verbatims, not labels"). Deal count and ARR rollups change as new gaps attach; that is aggregate state, not call artifact state.

**ID prefix:** `gclus_`.

#### `what_works` (`whatWorks`) — per-call positive signal

**Owns:** What landed — product area, customer verbatim, `referenceCandidate` flag, source call/account FKs.

**Does not own:** Deal-level TC roll-up (`TechnicalCommit.whatsWorking` remains the deal snapshot; per-call detail lives here per ENTITY_CATALOG TechnicalCommit comment).

**Why not PostCall blob:** Spec §8 and §11.10 treat positives as a **case-study and reference pipeline** queryable across accounts — same extension pattern as gaps.

**ID prefix:** `ww_`.

#### Pass 6 write path

Worker Pass 6 creates **draft** `product_gaps` and `what_works` rows after analysis. Pass 6 may emit a **provisional** `gap_type` and taxonomy classification; it does **not** publish to the product dashboard. Optional lightweight summary pointer on the call record (count + status) is acceptable for UX; structured rows remain authoritative.

#### Why extension lane, not core

Per [ARCHITECTURE.md](../ARCHITECTURE.md): core PrepBrief/PostCall stay stable; derived, queryable, cross-entity insight lives in extension collections keyed by core IDs. `ProductInsight` in ENTITY_CATALOG is this lane — register all three entities there, plus RELATIONSHIPS and RBAC, before implementation.

---

### 2. Two-axis taxonomy (spec §8)

#### Axis 1 — Product area (single-select, routes to owner)

Fixed enum. Routes each gap to a **product-area owner** (PM or PM delegate). Initial v1 areas and sub-areas are exactly spec §8's table (Ticketing & workflow, Channels, AI — customer/agent/platform, Knowledge, Reporting & analytics, Admin & config, Integrations & extensibility, ITSM-specific, CRM/sales-specific, Platform, Commercial).

- **`productArea`** — required on every gap and what_works row.
- **`subArea`** — required when a sub-area list exists for the area; otherwise `other` within that area.

**No free-text product area.** Misclassification goes to **`Other`** bucket (see §4).

#### Axis 2 — Cross-cutting tags (multi-select, orthogonal)

Fixed enum: `data_residency`, `security_compliance`, `localization`, `scale_limits`, `accessibility`, `migration`, `tco`.

- Zero or more per gap.
- Do **not** replace Axis 1. Tags slice the same product-area rows for leadership narratives (e.g. "data residency" × any area = one cross-product story).

#### Why two axes

Five ASEAN deals raised **data residency** against AI, knowledge, and channels. One axis forces three unrelated rows under three product areas; PM ownership splits and ARR story fragments. Two axes yield one **`data_residency` tag** narrative with **per-area owners** still clear on Axis 1 — "one $88K story with a clear owner" per spec §8.

#### Taxonomy versioning

- Every `product_gaps` and `what_works` row stores **`taxonomyVersion`** (e.g. `"1.0"`) at write time.
- Org-wide config document **`productTaxonomies/{version}`** (or equivalent) holds the frozen area/sub-area/tag lists for that version. UI and reports resolve labels through the row's version, not the current config alone.
- When v2 ships: new extractions use `taxonomyVersion: "2.0"`; v1 rows stay interpretable with v1 labels. **Reclassification of old rows is explicit** (curator action + audit), never silent migration.
- **`gap_clusters`** store the taxonomy version active when the cluster was labeled/published.

**Human flag:** RACI mapping from each Axis 1 area → named PM owner (org chart), not inferable from code.

---

### 3. Real gap vs enablement gap

#### Definitions

| `gapType` | Meaning | Primary consumer |
|-----------|---------|------------------|
| `real_gap` | Product missing capability, wrong packaging, or defensible roadmap blocker | Product management backlog |
| `enablement_gap` | Product already supports it; failure mode is SE/sales knowledge, demo, or battlecard | Enablement / SE readiness |

Model signal: spec §8 **`disposition: se_didnt_know`** strongly correlates with enablement gap but is **not sufficient alone** (customer may be wrong; SE may have mis-demoed a real limitation).

#### Classification flow

1. **Pass 6 (model):** Sets initial `gapType` + `disposition` from transcript evidence.
2. **SE (call record):** May flag "already in product" or "misclassified" — does not change published state; opens review.
3. **Triage queue:** Items enter **`draft`**; default sort surfaces disputed and `se_didnt_know` dispositions first.

#### Arbitration

| Dispute | Arbiter | Outcome |
|---------|---------|---------|
| SE or PM disagrees with model on **real vs enablement** | **Area PM** (Axis 1 owner) for real-gap candidates; **Enablement lead** for enablement candidates | `gapType` updated; `arbitratedBy`, `arbitratedAt`, `arbitrationNote` appended |
| PM and enablement lead disagree | **Product ops admin** (or director PM) | Final `gapType`; logged |

**Human flag:** Who is "enablement lead" in this org (named role/person). Whether enablement is a separate function from PM in all regions.

#### Where enablement gaps go

- **Same collection** (`product_gaps`), `gapType: enablement_gap`.
- **Not** published to the PM "what's not working" backlog. Status transitions to **`routed_enablement`** (see §4).
- **Enablement queue surface:** org-wide list filtered `gapType == enablement_gap` and status in `routed_enablement | published_enablement`. Consumption via **manager org-wide read** on enablement-routed rows **or** a future dedicated enablement role — see human flag below.
- **Close the loop (spec §11.10):** SE sees status on the call record ("routed to enablement — battlecard in progress") without exposing other SEs' verbatims.

**Human flag:** Whether enablement needs its **own RBAC role** (org-wide read on enablement rows only) or inherits from existing manager/org-leader scopes.

Real gaps with disposition **`roadmap_deflection`** remain `real_gap`; PM owns triage, not enablement.

---

### 4. Curation workflow

#### Roles

| Role | Responsibility |
|------|----------------|
| **System (Pass 6)** | Create `draft` gaps and what_works rows |
| **SE** | Read own gaps on call record; flag misclassification; no publish |
| **Area PM (`pm` role)** | Triage, classify, merge duplicates, publish real gaps, assign/review clusters |
| **Enablement lead** | Triage enablement queue, publish enablement resolutions |
| **Admin** | Taxonomy version bumps, Other-bucket review facilitation, force status overrides |

#### `product_gaps` statuses

| Status | Meaning |
|--------|---------|
| `draft` | Auto-created; not on product dashboard |
| `in_review` | PM or enablement actively triaging |
| `published` | Real gap on PM product-signal dashboard |
| `routed_enablement` | Enablement gap; in enablement queue (not PM backlog) |
| `published_enablement` | Enablement acknowledged fix (battlecard, training, doc) — visible to filing SE |
| `dismissed` | Noise, duplicate, or not actionable — SE sees reason |
| `merged` | Absorbed into another gap or cluster; pointer to survivor |

**Draft → published:** Only **`pm` role** (or admin) for `real_gap`. Enablement path: **`routed_enablement` → `published_enablement`** by enablement lead (or admin until enablement role exists).

#### `gap_clusters` statuses

| Status | Meaning |
|--------|---------|
| `draft` | Machine-suggested cluster |
| `published` | PM-approved label on dashboard |
| `archived` | Superseded by relabel or taxonomy version change |

Cluster publish: **PM only.** Embedding recomputation runs async; PM edits label, not individual verbatims.

#### Other bucket (spec §8)

- Gaps with `productArea: other` or `subArea: other` stay **`draft`** until monthly review — **not auto-published**.
- **Cadence:** monthly taxonomy review (PM + product ops).
- **Promotion rule:** term appears **≥ 5 times** in Other verbatims → propose new sub-area (or area) in **next taxonomy version**; do not retroactively rewrite v1 rows without explicit curator action.

#### Clustering

- Async job over **verbatim embeddings**, not taxonomy labels (spec §8).
- Catches themes taxonomy missed; PM names cluster after review.
- **`dealCount` / `arrTotal`** recomputed from member gaps' frozen `arrTouched` snapshots.

---

### 5. Permissions — new `pm` role

Per [ARCHITECTURE.md](../ARCHITECTURE.md) and [RBAC.md](../RBAC.md): product is a **new audience** → **new role value**, not a flag on `manager` or `admin`.

#### Role: `pm` (Product Manager)

| Action | `se` | `manager` | `pm` | `admin` |
|--------|------|-----------|------|---------|
| Read own call's gap rows + what_works | Yes | — | — | Yes |
| Read team gap rows (coaching context) | — | Yes | — | Yes |
| Read **org-wide** product_gaps, gap_clusters, what_works | — | — | **Yes** | Yes |
| Create draft gaps (Pass 6 worker) | Via own calls | — | — | Yes |
| Update curation fields (status, gapType, taxonomy, clusterId) | — | — | **Yes** | Yes |
| Publish / dismiss / merge gaps | — | — | **Yes** | Yes |
| Publish gap_clusters | — | — | **Yes** | Yes |
| Read full PostCall / transcript for any SE | No | Team only | **Gap-linked only**¹ | Yes |
| Manage product taxonomy versions | No | No | Read | **Yes** (write) |

¹ **PM read scope on core artifacts:** PM may read the **source post call** for gaps they curate (`postCallId` FK), not blanket org-wide PostCall access. Prevents product dashboard from becoming undeclared surveillance.

**Implementation notes**

- Add `pm` to `User.role` enum; assign via admin user management.
- Firestore rules: org-wide read on the three collections when `role == 'pm'`; writes limited to curation fields + cluster docs.
- Until `pm` users exist, **admin** may operate the product-signal dashboard (RBAC.md interim note) — not manager impersonation.

**Human flags**

- Whether any PM functions (e.g. competitive intel) require **read across MoM or scorecards** — default **no** unless product leadership requests.
- Dedicated **`enablement` role** vs manager/org-leader access to enablement queue (see §3).

---

### 6. Retention

Gaps and what_works carry **customer verbatims** (direct quotes). Policy:

#### Active retention

- Rows live for the life of the **account** plus **`retentionPeriodAfterLastActivity`** after the account's last call or deal update.
- **Proposed default:** 24 months after last activity — **human flag: legal/compliance must confirm** (GDPR, customer DPAs, APAC residency commitments).

#### Who can export

| Export | Who | Contents |
|--------|-----|----------|
| **Dashboard view** | `pm`, admin | Aggregates, taxonomy, cluster labels, counts, ARR rollups — verbatims on drill-down only |
| **Verbatim export** | `pm`, admin | CSV/JSON with verbatims, account/deal ids, taxonomy — **audit-logged** (`exportedBy`, `exportedAt`, scope) |
| **SE export** | No bulk export | Own call's gaps only, in UI |
| **Manager export** | No bulk verbatim export | Team coaching views without cross-team verbatim bulk download |

**Human flag:** Whether verbatims require **redaction** (contact names, emails) on export; default store verbatim as extracted, redact on export until legal confirms.

#### Embeddings

- Stored alongside gap row; deleted when parent gap is deleted or anonymized.
- Not exported to PM CSV by default (internal clustering only).

#### Account deletion

When an **account is deleted** (admin operation):

1. **Cascade delete** (or hard anonymize) all `product_gaps`, `what_works` rows where `accountId` matches.
2. **Recompute** affected `gap_clusters` counts; clusters falling below threshold → `archived`.
3. **Audit log** retention event; no verbatim recovery after delete.

If account is **archived** but not deleted: retain rows under retention clock; PM access unchanged until period expires.

**Human flags**

- Company-wide **data retention schedule** may override the 24-month proposal.
- Whether **won/lost deal** terminal state should start a shorter clock — product decision.

---

## Target shape (not implemented)

```text
product_gaps (pgap_*)
  postCallId, dealId, accountId
  productArea, subArea, crossCuttingTags[]
  verbatim, disposition, dealImpact, gapType
  competitorNamed?, arrTouched (snapshot)
  embedding[], taxonomyVersion
  clusterId?, status
  curatedBy?, publishedAt?
  arbitratedBy?, arbitrationNote?
  ownerId, teamId, orgId (denorm from call)

gap_clusters (gclus_*)
  label, centroidRef | embeddingCentroid
  dealCount, arrTotal
  productArea?, crossCuttingTags[] (summary)
  taxonomyVersion, status
  orgId

what_works (ww_*)
  postCallId, accountId
  productArea, verbatim
  referenceCandidate: boolean
  taxonomyVersion
  ownerId, teamId, orgId

productTaxonomies/{version}   — frozen v1/v2 area + tag enums (admin write)
```

---

## Options considered

### Option A: Arrays on `PostCall.analysis`

| Dimension | Assessment |
|-----------|------------|
| Complexity | Low initial |
| Fit | **Poor** — no org-wide PM queries, no curation lifecycle, violates extension rules |

**Rejected.**

### Option B: Single `ProductInsight` entity with type discriminator

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium |
| Fit | **Mixed** — gaps, clusters, and positives have different lifecycles and RBAC; forces polymorphic queries |

**Rejected** in favor of three collections matching spec §10.

### Option C: Three collections + two-axis taxonomy + `pm` role (this ADR)

| Dimension | Assessment |
|-----------|------------|
| Complexity | Medium — new entities, async clustering, curation UI |
| Fit | **High** — matches spec §8–§10, ARCHITECTURE extension lane, ENTITY_CATALOG gate |

**Accepted.**

---

## Trade-offs

| Topic | Choice |
|-------|--------|
| Enablement gaps storage | Same collection, different status path — avoids duplicate extraction pipelines |
| PM vs admin interim | Admin operates dashboard until `pm` users seeded |
| Cluster storage | Separate collection vs materialized view — chosen for explicit PM publish and status |
| Taxonomy changes | Version on row + frozen config — old dashboards stay interpretable |
| Verbatim privacy | Retain for product value; export gated and logged — exact TTL needs legal |

---

## Consequences

### Positive

- Opens ENTITY_CATALOG `ProductInsight` gate with concrete entities and IDs.
- PM dashboard queries are indexable (area, tag, gapType, status, cluster).
- Enablement gaps stop polluting PM backlog; SE close-the-loop preserved.
- Two-axis taxonomy preserves cross-cutting narratives (residency, TCO) without losing area ownership.
- Core PostCall schema remains stable.

### Negative / cost

- Three collections + taxonomy config + async clustering job + curation UI.
- New role, Firestore rules, and permission matrix updates.
- Monthly Other-bucket review is operational overhead.
- Legal review required before verbatim export and retention defaults ship.

### Revisit when

- Enablement org asks for dedicated role or CRM/Jira sync out of published gaps.
- Cross-org or multi-tenant SaaS (`orgId` isolation on clusters) — [ARCHITECTURE.md](../ARCHITECTURE.md) multi-tenant row.
- Taxonomy v2 promotion triggers bulk reclassification tooling.

---

## Human decisions required (not decided here)

| # | Decision | Why blocked |
|---|----------|-------------|
| H1 | **Retention period** after last account activity | Legal / DPA / regional policy |
| H2 | **Verbatim redaction** rules on export | Legal / privacy |
| H3 | **Area → PM owner** RACI | Product org chart |
| H4 | **Enablement lead** identity and whether **`enablement` role** is separate from `pm` | Org design |
| H5 | **PM access** to full transcripts beyond gap-linked calls | Product leadership appetite |
| H6 | **Account deletion** trigger in production (who may delete, customer offboarding process) | Ops / legal |
| H7 | **Jira/roadmap tool** integration for published real gaps | PM toolchain choice |

---

## Implementation phases (action items)

1. [ ] **Product + legal:** Resolve H1–H3, H6 before first verbatim stored in prod.
2. [ ] Register **ProductGap**, **GapCluster**, **WhatWorks** in ENTITY_CATALOG, ID_STANDARDS, RELATIONSHIPS, RBAC.
3. [ ] Add **`pm` role** to types, permissions, Firestore rules, seed at least one PM user.
4. [ ] Worker Pass 6: write draft `product_gaps` + `what_works`; store `taxonomyVersion: "1.0"`.
5. [ ] Seed **`productTaxonomies/1.0`** from spec §8 tables.
6. [ ] Async clustering job → draft `gap_clusters`; PM publish UI (spec §11.10).
7. [ ] Call record + product-signal surfaces: SE status loop; PM cluster dashboard.
8. [ ] Export endpoint with audit log; retention sweeper job (post legal sign-off).

---

## Related

- [POST_CALL_SPEC_V2.md](../POST_CALL_SPEC_V2.md) §8 (taxonomy), §10 (data model), §11.10 (product signal)
- [ARCHITECTURE.md](../ARCHITECTURE.md) — extension rules; example `ProductInsight` shape
- [ENTITY_CATALOG.md](../ENTITY_CATALOG.md) — `ProductInsight` gate
- [RBAC.md](../RBAC.md) — future `pm` role row
- [BUILD_ALIGNMENT.md](../BUILD_ALIGNMENT.md) §6 — Firestore mapping
- [adr/003-account-deal-engagement.md](./003-account-deal-engagement.md) — `dealId` / `accountId` FKs on call-scoped rows
