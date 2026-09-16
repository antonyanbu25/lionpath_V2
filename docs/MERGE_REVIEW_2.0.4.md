# Merge review: local `2.0.3` + WIP vs `lionpath/2.0.4`

**Repo:** `singapaathai` (fork/worktree of [skut264/lionpath](https://github.com/skut264/lionpath))  
**Generated:** 2026-07-22  
**Remotes:** `lionpath` → `git@github.com:skut264/lionpath.git`; `origin` → `sowravsunil/singapaathai`  
**Comparison bases:**

| Ref | Commit | Role |
|-----|--------|------|
| Local `HEAD` (`2.0.3`) | `bd752d6` | Shared merge-base with upstream |
| `lionpath/2.0.3` | `bd752d6` | Same as local committed tip |
| `lionpath/2.0.4` | `9dde6c8` | Target upstream release |
| Local working tree | uncommitted + untracked | Kaia enrich hardening on top of `2.0.3` |

**Fetch status:** `git fetch lionpath 2.0.4` succeeded (`refs/remotes/lionpath/2.0.4`).

---

## 1. Executive summary

### Delta at a glance

| Scope | vs `lionpath/2.0.3` | Notes |
|-------|---------------------|--------|
| **`lionpath/2.0.3` → `lionpath/2.0.4`** | **84 files**, **+4,542 / −1,242** lines | 82 commits on top of `bd752d6` |
| **Local committed `HEAD`** | Same as `2.0.3` | No local commits beyond upstream tag |
| **Local WIP (tracked)** | **13 files**, **+259 / −57** | Kaia API, enrich limits, input-hash, precall/enrich paths |
| **Local WIP (untracked)** | **15 paths** | `worker/src/kaia/*`, tests, `docs/FULLSTACK_REVIEW_BRIEF.md` |
| **`lionpath/2.0.4` vs local `HEAD`** | Same 84-file stat as above | Local is entirely *behind* 2.0.4 except WIP |

### Themes in 2.0.4 (upstream)

1. **Shorten / de-duplicate (structure, not mass deletes)** — Worker HTTP surface moved from a ~555-line `worker/src/index.ts` to a **71-line** entry plus **`worker/src/routes.ts`** (~525 lines) with a route map and named handlers. Web extracts **`web/shared.js`**, **`web/chart-shared.js`**, slims **`web/postcall.js`** and **`web/index.html`**, and refactors boot/history/dashboard paths for perf and clarity.
2. **Kaia + DISC (upstream shape)** — Single module **`worker/src/kaiaShare.ts`**, endpoint **`POST /api/fetch-kaia-summary`** (`{ kaiaUrl }` → summary text), precall fetch before enrich, UI labels for Kaia/merged DISC sources, **`web/customer-reference-links.js`** by industry.
3. **Prep / Gemini reliability** — Model defaults, thinking-level fixes for `google_search`, slimmer prep JSON schema, **`worker/src/research-orchestrator.ts`** + person/company providers for prospect work experience in cloud prep.
4. **Auth / SSO / Accounts** — **`worker/src/auth.ts`**, Firebase config/boot fixes, accounts panel auth gate and blank-panel fixes after SSO sync.
5. **Data layer perf** — **`web/domain/collection-crud.js`**, Firestore 30s TTL on `getById`, capped list queries (200), local-store in-memory cache cleared on logout.
6. **Deploy & docs** — **`deploy/cloudrun/*`**, VPS/nginx/Caddy tweaks, README 2.0.4 table; adds binary **`singapaathai-source-20260717.zip`** (559 KB).
7. **Test expansion (web)** — Many dashboard/prod timing scripts (39 test files under `web/scripts/` on 2.0.4 vs 27 committed locally; local adds 2 more in WIP).

### Themes in local WIP (not on upstream 2.0.4)

1. **Kaia enrich hardening (deeper than 2.0.4)** — Modular **`worker/src/kaia/`** (fetch, cache, sanitize, share-link parsing, **`matchProspectExcerpt`**, prep integration), client mirror **`web/kaia-prospect-match.js`**, endpoint **`POST /api/kaia/share-content`** (`{ url }` → **bundle** + summary), token redaction in errors (documented in **`docs/CONTACT_ENRICHMENT.md`**).
2. **Enrich caps** — **`worker/src/contact/enrich-limits.ts`** central limits; wired in **`worker/src/contact/enrich.ts`**.
3. **Research input hash (explicit sync)** — **`worker/src/prep/input-hash.ts`** + **`web/prep-input-hash.js`** with cross-package test **`test-prep-input-hash`** (2.0.4 already hashes via **`web/domain/account-service.js`** / `computePrepInputHash` — **duplicate concept, different files**).
4. **Gate tests** — **`web/scripts/test-prep-enrich-gate.mjs`**, worker Kaia parse/prospect tests (replace upstream **`test-kaia-share.ts`** with split scripts locally).
5. **Internal architecture brief** — **`docs/FULLSTACK_REVIEW_BRIEF.md`** (local-only; deployment/GCP opinion doc).

---

## 2. What 2.0.4 removed or consolidated (with paths)

No standalone **deleted** files in `lionpath/2.0.3..lionpath/2.0.4` (no `D` entries in name-status); “shortening” is **refactor and extraction**:

| Area | Before (2.0.3 mental model) | After (2.0.4) | Effect |
|------|------------------------------|---------------|--------|
| Worker routing | All handlers in **`worker/src/index.ts`** | **`worker/src/index.ts`** (thin) + **`worker/src/routes.ts`** | ~484 lines moved; route table at bottom of `routes.ts` |
| Kaia fetch | N/A on 2.0.3 tag | **`worker/src/kaiaShare.ts`** (~221 lines) | One file vs local’s split `kaia/` tree |
| Web utilities | Duplicated `esc`, chart helpers inline | **`web/shared.js`**, **`web/chart-shared.js`** | **`web/account-view.js`**, dashboard, etc. import shared helpers |
| Post-call UI wiring | Heavier **`web/postcall.js`** | Slimmer postcall; listeners deferred in **`web/app.js`** boot | Less duplicate boot logic |
| Dispute boot | MutationObserver path | Simpler inline boot (**commit `1164c58`**) | Less DOM watching |
| Firestore CRUD | Repeated patterns in **`web/domain/firestore-store.js`** | **`web/domain/collection-crud.js`** + store refactor | Less duplication for accounts/teams/orgs |
| Dashboard aggregation | Uncached QC normalize | Cached **`normalizeQualityCoach`** in **`web/dashboard.js`** | Perf |
| History sync | Sequential | Parallel history + tasks on login (**`web/history.js`**) | Boot perf |

**Net-new upstream files (high signal):**

- `worker/src/routes.ts`, `worker/src/auth.ts`, `worker/src/kaiaShare.ts`, `worker/src/research-orchestrator.ts`, `worker/src/research/**`
- `web/shared.js`, `web/chart-shared.js`, `web/customer-reference-links.js`, `web/domain/collection-crud.js`
- `deploy/cloudrun/*`, `worker/scripts/test-research-orchestrator.ts`, `worker/scripts/test-prep-payloads.mjs`, many `web/scripts/test-dashboard-*.mjs`, `web/scripts/test-prod-*.mjs`

**Questionable to keep from 2.0.4 as-is:**

- **`singapaathai-source-20260717.zip`** — snapshot artifact; bloated for git; prefer omit or `.gitignore` on merge.

---

## 3. What local / current has that 2.0.4 may lack

| Capability | Local paths | 2.0.4 equivalent | Gap |
|------------|-------------|-------------------|-----|
| Kaia **bundle** + per-prospect excerpt | `worker/src/kaia/*`, `web/kaia-prospect-match.js`, `web/prep-contact-enrich.js` | Summary-only `kaiaShare.ts`; enrich uses `kaiaSummary` string | **Local is strictly richer** for multi-prospect DISC |
| Kaia API contract | `POST /api/kaia/share-content`, body `{ url }` | `POST /api/fetch-kaia-summary`, body `{ kaiaUrl }` | **Breaking mismatch** — must unify |
| Share URL hardening | `shareLink.ts`, `sanitize.ts`, `shareCache.ts`, short-link `/s/` handling | Partial overlap in `kaiaShare.ts` | Port local parsing/cache/redaction into upstream structure |
| Enrich prompt limits | `worker/src/contact/enrich-limits.ts` | Inline slices in `enrich.ts` (2.0.4) | Keep local constants |
| Prep enrich gate | `web/scripts/test-prep-enrich-gate.mjs`, precall/enrich flow | Upstream Kaia fetch in precall only | Keep local tests + flow |
| Input hash (synced TS/JS) | `worker/src/prep/input-hash.ts`, `web/prep-input-hash.js` | `computePrepInputHash` in **`web/domain/account-service.js`** + worker `normalize-input.ts` | **Merge manually** — one canonical implementation |
| Accounts UX tweaks | WIP **`web/domain/account-service.js`** (hash imports) | 2.0.4 SSO fixes in **`web/account-view.js`** | Local **missing** 2.0.4 SSO empty-state / try/catch — **take 2.0.4** then re-apply hash imports |
| Customer reference links | Not in local WIP | **`web/customer-reference-links.js`** + tests | **Take 2.0.4** |
| Research orchestrator | Not in local | **`worker/src/research/**`** | **Take 2.0.4** unless it conflicts with prep pipeline edits |
| Firebase / worker auth | Partial on 2.0.3 | **`worker/src/auth.ts`**, config fixes | **Take 2.0.4** |
| Fullstack review brief | **`docs/FULLSTACK_REVIEW_BRIEF.md`** | — | Keep local doc; not required for runtime merge |
| Contact enrich docs | **`docs/CONTACT_ENRICHMENT.md`** (expanded) | README Kaia API section on 2.0.4 | Merge doc content both ways |

---

## 4. Side-by-side recommendation table

| Major area | Keep local | Take 2.0.4 | Merge manually | Defer |
|------------|------------|------------|------------------|-------|
| **Web — shell / boot** | — | `app.js` boot delegation, postcall deferral, `shared.js` / `chart-shared.js`, history parallel sync, index.html slimming | Re-wire **`precall.js`** deps: Kaia URL + customer refs + cached research | Prod-only test scripts until deploy target chosen |
| **Web — precall / enrich UI** | Kaia bundle client fetch, prospect excerpt matching, enrich gate tests | Customer reference links, Kaia DISC **labels** on chips/badges | **`precall.js`**, **`precall-render.js`**, **`prep-contact-enrich.js`**, **`app.js`** API base paths | — |
| **Web — accounts / CRM** | `account-service.js` hash module imports (after unify hash) | **`account-view.js`** SSO gate + empty states, firestore TTL + `collection-crud.js` | **`account-view.js`** + **`account-service.js`** | — |
| **Web — dashboard** | — | QC cache, team metrics email→uid fix, dashboard test suite | Verify no regression with local store cache (both add caching) | Optional: run full dashboard test matrix |
| **Web — firebase** | — | `firebase-config.js`, auth export fixes, cache-bust on VPS | Ensure **`kaiaShareUrl`** / worker base URL envs documented | — |
| **Worker — routing** | — | **`routes.ts`** + thin **`index.ts`**, **`auth.ts`** | Port **`/api/kaia/share-content`** (or alias) into **`routes.ts`**; delete duplicate handlers from local monolithic index | — |
| **Worker — Kaia** | Entire **`worker/src/kaia/`** module, limits, prospect match | — | Replace or wrap **`kaiaShare.ts`**: implement handlers calling local module; align JSON schema with web | Upstream **`test-kaia-share.ts`** → keep local split tests |
| **Worker — contact enrich** | **`enrich-limits.ts`**, Kaia URL resolve via `fetchShareContent` | Gemini/schema tweaks in same file on 2.0.4 | **`worker/src/contact/enrich.ts`** | — |
| **Worker — prep pipeline** | **`input-hash.ts`**, prep index meta | Research orchestrator, synthesize/schema fixes, merge-enrichment tweaks | **`prep/normalize-input.ts`**, **`prep/index.ts`**, **`providers/gemini.ts`** | — |
| **Worker — research** | — | **`research-orchestrator.ts`** + providers | Ensure enrich/Kaia changes don’t bypass orchestrator | — |
| **Docs** | **`CONTACT_ENRICHMENT.md`**, **`FULLSTACK_REVIEW_BRIEF.md`** | README 2.0.4 table, Cloud Run **`deploy/cloudrun/README.md`**, VPS doc updates | Single Kaia API section naming chosen endpoint | — |
| **Deploy** | singapaathai-specific origin workflow | Cloud Run Dockerfiles, VPS domain/nginx | **`wrangler.toml`**, env examples | **`singapaathai-source-*.zip`** |

---

## 5. Risky conflicts / must-test areas

### High conflict probability (same files, different designs)

1. **`worker/src/index.ts` vs `worker/src/routes.ts`** — Local WIP extends monolithic index with Kaia route; 2.0.4 deletes most of index. **Resolution:** implement Kaia on `routes.ts` only.
2. **`web/precall.js`** — Both add Kaia fetch; different endpoint names, payloads, and hash wiring. **Must-test:** full prep run with Kaia URL, LinkedIn PDF, and cached research skip.
3. **`worker/src/contact/enrich.ts`** — Both touch Kaia resolution and Gemini paths. **Must-test:** `POST /api/contact/enrich` with Kaia-only, Zoom-only, merged sources; DISC `source` field.
4. **`worker/src/providers/gemini.ts`** + **`worker/src/gemini-schema.ts`** — Large 2.0.4 rewrite; local may not touch but prep WIP depends on behavior. **Must-test:** `/api/prep/research` and `/api/prep/synthesize` (400 regressions were explicit 2.0.4 fixes).
5. **`web/domain/account-service.js`** + **`web/account-view.js`** — Hash vs SSO fixes. **Must-test:** Firebase SSO login → Accounts list + detail; profile-not-ready empty state.
6. **`web/domain/firestore-store.js`** / **`local-store.js`** — Caching layers from both sides. **Must-test:** logout clears cache; account/contact reads after edit.

### API / contract

| Topic | Risk |
|-------|------|
| Kaia endpoint rename | Any hardcoded path in `precall.js`, `app.js`, docs, or tunnel env must match chosen contract |
| Request body `{ url }` vs `{ kaiaUrl }` | Client/server 400s if not migrated together |
| Response summary-only vs bundle | DISC per-prospect matching breaks if bundle dropped |

### Auth / production

- **Firebase SSO boot** (2.0.4 fixes): sign-in flash, stale `firebase-config.js`, blank dashboard after history sync — re-run **`web/scripts/test-prod-blank.mjs`** (2.0.4) after merge.
- **`worker/src/auth.ts`**: all protected routes; run **`npm run test:firebase-auth`** in `worker/`.

### Sanity: automated tests (no full run required for this review)

| Package | Local committed + WIP | `lionpath/2.0.4` |
|---------|---------------------|------------------|
| **web** `npm test` | 15 steps incl. **`test-prep-enrich-gate`**, **`test-prep-input-hash`**; no **`test-customer-reference-links`** until taken from 2.0.4 | 16 steps incl. customer refs + **`test-customer-reference-links`**; no local enrich-gate/hash |
| **worker** `npm test` | 8 tsx steps incl. **`test-kaia-share-parse`**, **`test-prep-input-hash`**, **`test-kaia-prospect-match`** | 6 steps incl. **`test-kaia-share.ts`**, **`test-prep-payloads`**, **`test-research-orchestrator`** |

**Post-merge minimum:** `cd web && npm test` and `cd worker && npm test`, plus manual SSO + precall with Kaia link.

---

## 6. Suggested merge order

Goal: **2.0.4 as the structural base**, then **replay local Kaia hardening** onto the refactored tree (goodness of both). No `git push` unless explicitly requested.

1. **Save WIP**
   - `git stash push -u -m "kaia-hardening-pre-2.0.4"` *or* commit on a branch e.g. `wip/kaia-hardening-2.0.3`.

2. **Merge upstream release**
   - `git checkout 2.0.3` (or `feature/se-prep-portal-v2` if that is the integration branch).
   - `git merge lionpath/2.0.4 -m "Merge lionpath 2.0.4"`  
   - Expect conflicts in: `worker/src/index.ts`, `web/precall.js`, `worker/src/contact/enrich.ts`, `web/account-view.js`, `worker/src/providers/gemini.ts`, possibly `web/domain/account-service.js`.

3. **Resolve worker routing first**
   - Accept **2.0.4** `routes.ts` + thin `index.ts`.
   - From stash: copy **`worker/src/kaia/`**, **`enrich-limits.ts`**, **`prep/input-hash.ts`**.
   - Add route handler(s) in **`routes.ts`**: prefer **`POST /api/kaia/share-content`**; optional backward-compatible alias for **`/api/fetch-kaia-summary`** mapping to same handler.

4. **Replay Kaia through prep + enrich**
   - Merge **`precall.js`**: 2.0.4 customer refs + labels + local bundle fetch / `kaiaContent`.
   - Merge **`prep-contact-enrich.js`** + **`kaia-prospect-match.js`**.
   - Merge **`enrich.ts`** with **`enrich-limits.ts`**.

5. **Unify input hash**
   - Pick **one** of: shared **`prep-input-hash.js` + `input-hash.ts`** (local) vs **`account-service.js`** helpers (2.0.4).
   - Update **`test-prep-input-hash`** on both sides; remove duplicate hash logic.

6. **Accounts / SSO**
   - Take **2.0.4** **`account-view.js`** SSO/empty-state behavior.
   - Re-apply **`account-service.js`** cache/load changes from WIP.

7. **Docs & package scripts**
   - Merge **`docs/CONTACT_ENRICHMENT.md`** with README Kaia section.
   - Update **`web/package.json`** / **`worker/package.json`** `test` scripts to include **both** customer-reference tests (2.0.4) and enrich-gate/hash/kaia-prospect tests (local).
   - Keep **`docs/FULLSTACK_REVIEW_BRIEF.md`** if still useful; do not add **`singapaathai-source-*.zip`**.

8. **Validate**
   - `cd worker && npm test`
   - `cd web && npm test`
   - Manual: Firebase SSO → Accounts; precall with Kaia share URL; contact enrich DISC sources; prep synthesize end-to-end.

9. **Optional follow-up**
   - Run 2.0.4 dashboard/prod scripts against staging VPS or Cloud Run.
   - **`fw-review`** / fullstack review of merged tree before production deploy.

---

## Appendix: key commit range (2.0.3 → 2.0.4)

From `bd752d6..lionpath/2.0.4` (82 commits), release-oriented head:

- `9dde6c8` — Fix blank Accounts panel after SSO session sync  
- `ae1228e` — Accounts page auth gate for Firebase SSO  
- `0f10c1d` — Release 2.0.4 (Kaia DISC, customer refs, Gemini/SSO, boot perf)  
- `1102ce2` — Worker route map refactor  
- `452e234` / `43d08e7` — Kaia share fetch + DISC UI labels  
- `632671e` / `d2f5563` / `8939a0a` — Firestore/store perf  

Local WIP tracked diff vs `lionpath/2.0.3`: **`docs/CONTACT_ENRICHMENT.md`**, **`web/precall.js`**, **`web/prep-contact-enrich.js`**, **`worker/src/contact/enrich.ts`**, **`worker/src/index.ts`**, **`worker/src/prep/*`**, **`web/domain/account-service.js`**, plus package.json test script changes.
