# Lionpath (SE Singha Paathai) — Architecture Review Brief for Fullstack Dev

**Purpose of this doc:** We (non-fullstack-eng team) built this ourselves and need a sanity check. This doc lays out the use case, what we actually built, where we think it should go, and asks you to poke holes in it — especially the deployment/infra layer, which grew organically across three different targets. We specifically want your read on **going GCP-native** vs. staying where we are.

**What we want from you:**
1. Tell us if the current approach is reasonable for the use case, or a trap.
2. Tell us whether to pivot to a single, GCP-native stack (see Section 5) or consolidate on what we have.
3. Flag anything in Section 4 (current-state smells) that's a "fix now" vs. "fine for now."

---

## 1. The use case

**Who:** Freshworks Solution Engineers (SEs), their managers, and admins.

**Problem:** SEs walk into prospect calls under-prepared (no consistent research process) and walk out of calls with inconsistent, non-actionable notes and no coaching feedback loop. Managers have no visibility into call quality across their team.

**Two jobs to be done:**

| Workflow | Trigger | Input | Output | Latency target |
|---|---|---|---|---|
| **Pre-call prep** | Before a discovery/demo call | Company name, prospect email, optional context | One-pager: company-vs-industry comparison, business context, SE playbook (use cases, pain points, discovery questions, demo flow), cited sources | 15–45s |
| **Post-call analysis** | After a recorded Zoom call | Zoom cloud recording share link + passcode | One-pager debrief: call summary, next steps, follow-up email draft, CRM notes, **Quality Coach** scorecard (6-dimension rubric) | 10–25s |

**Secondary job (added later, still maturing):** Track the SE's relationship with an account over time — accounts, contacts, deal stage (MEDDPICC), tasks, activity timeline — so prep/post-call artifacts aren't just one-off documents but roll up into a per-account engagement history ("Lifecycle").

**Non-functional requirements that matter for the infra conversation:**
- Internal tool, Freshworks employees only (`@freshworks.com`), low-to-moderate concurrent usage (SE team size, not internet-scale).
- API keys (Gemini) must never touch the browser — server-side only.
- Manager/admin RBAC on top of per-SE data.
- Coaching data (Quality Coach scores) is semi-sensitive — internal performance data, not customer PII at scale.

---

## 2. How we're solving it today (current state)

### 2.1 Component diagram (as-built)

```
                         ┌─────────────────────────────────────────┐
                         │              Browser (SE)                │
                         │   web/  — static HTML/JS/CSS             │
                         │   Crayons "Dew" UI, vanilla JS (no build) │
                         └───────────────┬───────────────────────────┘
                                         │ HTTPS
                    ┌────────────────────┼─────────────────────────┐
                    │                    │                         │
                    ▼                    ▼                         ▼
          Firebase Auth (Google SSO)   Firestore (domain store)   Worker API
          restricted to @freshworks.com   accounts/contacts/       (TypeScript)
                                          lifecycles/prepBriefs/    /api/generate-prep
                                          postCalls/tasks/events    /api/analyze-call
                                                                    /api/contact/enrich
                                                                    /api/history (legacy)
                                                                          │
                                                                          ▼
                                                          Gemini API (Google AI Studio key)
                                                          + Zoom "share link" public API
```

### 2.2 The part that needs scrutiny: **three parallel deployment targets for the same app**

| Target | Web (`web/`) | API (`worker/`) | Data/history | Domain |
|---|---|---|---|---|
| **A — Cloudflare** | Cloudflare Pages (`wrangler pages deploy`) | Cloudflare Worker (`wrangler deploy`) | Cloudflare KV (`HISTORY_KV`) | *(not currently mapped to a live domain in docs)* |
| **B — VPS (current production)** | nginx container, static files | Node container (`tsx src/node-server.ts`) behind Caddy | Flat JSON files on disk (`/var/lib/se-paathai/history`, mode 600) | `lionpath.benjaminsquare.com` / `lionpathapi.benjaminsquare.com` |
| **C — GCP Cloud Run (in progress / partial)** | Static bundle zipped by `web/scripts/pack-web-cloudrun.mjs` for manual upload | *(no equivalent packaging script found for the worker yet)* | — | `portal.benjaminsquare.com` |

Same codebase, three build/deploy paths, three sets of hostnames. The Cloudflare path is Workers+Pages+KV; the VPS path is hand-rolled Docker Compose + Caddy + flat files; the Cloud Run path is a manual zip-and-upload script with a hardcoded debug-log write to a local absolute path (`/Users/ssunil/.../.cursor/debug-*.log`) baked into the packaging script — that line will throw/no-op unpredictably outside the original author's machine and should not ship as-is.

**Why this matters:** every environment-specific behavior (CORS origins, `WORKER_BASE_URL`, Firebase project id, history storage backend) has to be kept in sync by hand across `wrangler.toml`, `deploy/vps/.env`, and whatever Cloud Run env config exists. That's the single biggest thing we want a fullstack opinion on.

### 2.3 Data layer: **also running in parallel, not just deployment**

We're mid-migration from a flat "history" model to a proper domain model, and both are live simultaneously via a `dual-write.js` bridge:

| Store | What it holds | Where it lives | Status |
|---|---|---|---|
| **Legacy history** | Per-SE-email JSON blobs of prep/post-call results | Browser `localStorage` **+** worker-side file (VPS) or KV (Cloudflare) | Still the primary read path for sidebar/dashboard |
| **Domain store (target)** | Normalized `User / Team / Account / Contact / Lifecycle / PrepBrief / PostCall / Task / LifecycleEvent` | **Firestore** (or a `localStorage` shim when Firebase isn't configured, for local dev) | Written on every action; not yet the primary read path everywhere |

Every prep/post-call submission today writes to **both** systems. There's a documented migration runbook (`docs/DOMAIN_MODEL.md`) but the cutover hasn't happened.

### 2.4 Auth

- **Firebase Authentication**, Google SSO, restricted to `@freshworks.com` domain, enforced both client-side and worker-side (ID token verification against `FIREBASE_PROJECT_ID`).
- Falls back to a **hardcoded demo/dummy login** (`se@freshworks.com` / `se123`, etc.) when no Firebase project is configured — this is intentional for local dev/demos, but it's the same codebase, so it's a config flag away from being live anywhere.
- RBAC (SE / Manager / Admin) is enforced **twice**: once in `firestore.rules` (source of truth) and once in `web/domain/rbac.js` (UI guard). Standard defense-in-depth, but worth confirming both are actually kept in sync as roles evolve (org hierarchy, senior leader scopes, etc. — see `docs/adr/002-org-hierarchy.md`).

### 2.5 LLM / AI layer

- Provider abstraction exists (`worker/src/providers/{gemini,anthropic}.ts`) but **Gemini via a raw API key from Google AI Studio** is the default and only one actually used in production — **not Vertex AI**, i.e., not going through a GCP project/IAM/service account at all for inference.
- Pre-call uses Gemini's built-in `google_search` grounding tool for live web research; post-call is a closed-book structured-JSON extraction from a Zoom transcript.
- Model/effort are config values in `wrangler.toml` (`gemini-3.1-flash-lite`, effort `low`/`medium`), which is fine, but that config file is Cloudflare-specific, so the VPS/Cloud Run paths must be reading equivalent values from somewhere else (`.env` on VPS) — another sync point.

### 2.6 Secrets

- Gemini key, Firebase project id, allowed origins, allowed email domain: currently spread across `worker/wrangler.toml` (Cloudflare), `deploy/vps/.env` (VPS), and presumably a third config for Cloud Run — no centralized secret manager anywhere in the stack today.

---

## 3. Where we want to land (future state — what we're proposing)

**Goals, in priority order:**

1. **One deployment target**, not three. Pick a lane.
2. **One system of record for data.** Firestore already exists and is already the direction of travel (domain model, RBAC rules, lifecycle events) — finish the cutover, retire the legacy history path.
3. **One place for secrets**, with IAM-scoped access instead of `.env` files copied around by hand.
4. **CI/CD**, not manual `wrangler deploy` / SSH-and-`docker compose up` / manual zip upload.
5. **Observability** — right now, debugging production means SSH-ing into a VPS and reading `docker compose logs`. No structured logging, no error tracking, no metrics dashboard.
6. **Keep the "worker is stateless, browser talks to Firestore directly" pattern** — it's a reasonable design (see `docs/ARCHITECTURE.md`) and doesn't need to change; the LLM call is the only reason a server exists at all.

**Proposed target architecture (GCP-native):**

```
Browser (web/)  ──HTTPS──►  Firebase Hosting (static web/) or Cloud Run (containerized web)
       │
       ├──► Firebase Authentication (Google SSO, @freshworks.com)
       │
       ├──► Cloud Firestore (single system of record — accounts, contacts, lifecycles,
       │                       prepBriefs, postCalls, tasks, events)
       │
       └──► Cloud Run service (worker API, containerized, autoscale-to-zero)
                   │
                   ├──► Secret Manager (Gemini key, any provider keys)
                   ├──► Gemini API (direct key today; Vertex AI as a later option — see 5.9)
                   └──► Zoom public share-link API (unauthenticated, no change needed)

CI/CD:      GitHub → Cloud Build (or GitHub Actions + gcloud) → Artifact Registry → Cloud Run deploy
Observability: Cloud Logging + Cloud Monitoring + Error Reporting
```

This keeps the app's actual architecture (thin stateless API, fat client, Firestore as source of truth) exactly as documented — it only consolidates *where it runs* and *where secrets/data live*, onto one cloud instead of three.

---

## 4. Architecture by layer — current vs. proposed

| Layer | Current state | Proposed / target state | Change effort |
|---|---|---|---|
| **Presentation** | Static HTML/JS/CSS, no build step, Crayons "Dew" design system, served from nginx (VPS) / Cloudflare Pages / manually-zipped Cloud Run bundle | Same static assets, **one** hosting target: Firebase Hosting (simplest, free tier, CDN + SSL included) or Cloud Run container if you want it behind the same revision/rollback model as the API | Low — no code change, just pick one host |
| **API / application** | TypeScript worker with two runtimes: Cloudflare Worker (`src/index.ts` via `wrangler`) and a Node/`tsx` server (`src/node-server.ts`) for the VPS/Docker path | Collapse to **one runtime** — Node server on **Cloud Run**, delete the Cloudflare Worker entrypoint (or keep it behind a feature flag if Cloudflare stays as a CDN edge only) | Medium — code already has both entrypoints; it's a subtraction, not a rewrite |
| **Domain / business logic** | `worker/src/domain-model/*` (types + permissions) + `web/domain/*` (account/contact/lifecycle services, dual-write bridge) | Same — this layer is already well-factored and cloud-agnostic. Finish the dual-write cutover (retire legacy history read paths) | Medium — mostly a migration/testing effort, not new architecture |
| **Data / persistence** | **Three** stores in parallel: `localStorage`, Cloudflare KV / VPS flat files (legacy history), Firestore (domain model) | **One** store: Firestore. Legacy history collections retired per the existing runbook in `docs/DOMAIN_MODEL.md` | Medium-high — this is the real migration work, but it's already scoped |
| **Auth / identity** | Firebase Auth (Google SSO) + dummy email/password fallback; RBAC enforced in `firestore.rules` + UI guard | Keep as-is — Firebase Auth is already the right choice for a Google Workspace org restricted by domain | Low |
| **AI / LLM** | Direct Gemini API key (Google AI Studio), provider abstraction supports Anthropic too but unused in prod | Keep direct Gemini key for now (simplest); revisit Vertex AI only if you need per-project quota/billing isolation, VPC-SC, or centralized IAM audit trail on model calls | Low now / optional later |
| **Infra / deployment** | 3 targets (Cloudflare Workers+Pages+KV, VPS Docker Compose+Caddy, ad hoc Cloud Run zip) | 1 target: Cloud Run (API) + Firebase Hosting (web) | High — this is the actual pivot decision |
| **CI/CD** | Manual: `wrangler deploy`, SSH + `git pull` + `docker compose up`, manual zip upload | Cloud Build (or GitHub Actions) triggered on push → build container → push to Artifact Registry → deploy to Cloud Run; Firebase Hosting deploy via `firebase deploy` in the same pipeline | Medium — new but standard, well-trodden path |
| **Secrets** | `wrangler.toml` vars/secrets, `deploy/vps/.env`, unknown Cloud Run config | Secret Manager, referenced by the Cloud Run service directly (no `.env` files, no plaintext in repo-adjacent files) | Low-medium |
| **Observability** | `docker compose logs`, Cloudflare dashboard (if used) — no unified view | Cloud Logging (automatic for Cloud Run stdout/stderr) + Cloud Monitoring dashboards + Error Reporting (automatic for uncaught exceptions in supported runtimes) | Low — mostly comes free with Cloud Run |
| **DNS / networking** | Two live domains (`lionpath.*`, `lionpathapi.*`) + a third half-wired domain (`portal.*`) for the Cloud Run experiment | One domain pair, mapped via Cloud Run domain mapping or a load balancer + Firebase Hosting custom domain | Low — DNS change only |

---

## 5. GCP tech stack — detailed breakdown

Since Firebase Auth and Firestore are **already** in production use, the app is already half-committed to GCP whether that was explicit or not (Firebase *is* GCP — same underlying project, same IAM, same billing account, visible in the same GCP Console). Here's what going fully GCP-native would actually mean, service by service.

### 5.1 Cloud Firestore — *already in use*
- **Role:** Sole system of record for the domain model (`users`, `teams`, `accounts`, `contacts`, `lifecycles` + `events` subcollection, `prepBriefs`, `postCalls`, `tasks`) and `authIndex` (Firebase UID → internal user id mapping).
- **Mode:** Native mode, document/collection model — good fit here because the domain is naturally document-shaped (a `Lifecycle` with nested/related artifacts) rather than relational-join-heavy.
- **Security model:** `firestore.rules` is doing real work — role-based (`se`/`manager`/`admin`), team-scoped, and org-hierarchy-aware (director → senior leader → team manager → IC visibility, per `docs/adr/002-org-hierarchy.md`). This is enforced **at the database layer**, independent of the API — which is a strong pattern to keep regardless of where you deploy.
- **What's missing today:** the legacy parallel storage (localStorage / KV / flat files) undermines "Firestore is the source of truth." Finishing the cutover is the highest-value Firestore work, not new Firestore features.
- **Indexes:** `firestore.indexes.json` exists and is deployed via `firebase deploy --only firestore:indexes` — keep this in the CI/CD pipeline once one exists.

### 5.2 Firebase Authentication — *already in use*
- **Role:** Google SSO, hard-restricted to `@freshworks.com` in both the OAuth consent config and app-side checks (defense in depth).
- **Token flow:** client gets an ID token from Firebase Auth; worker verifies it against `FIREBASE_PROJECT_ID` (audience/issuer check) rather than trusting the client. This is correct and doesn't need to change.
- **Gotcha to flag:** the "dummy auth" fallback (hardcoded demo credentials) is convenient for local dev but lives in the *same* code path — worth an explicit build-time or env-time flag that makes it impossible to accidentally ship dummy auth to a real domain.

### 5.3 Cloud Run — *proposed, partially attempted*
- **Role (proposed):** Host the worker API as a container (it's already containerized for the VPS — `deploy/vps/Dockerfile.worker` — so this is close to a drop-in target, not a rewrite).
- **Why it fits:** scale-to-zero for a low/bursty-traffic internal tool (cost efficiency vs. an always-on VPS), managed HTTPS/TLS, automatic revision history + traffic splitting/rollback, no server patching.
- **Concurrency model to check with you:** the current worker is largely stateless per-request (LLM call out, response back) — that maps cleanly onto Cloud Run's request-based autoscaling. Confirm nothing in `history.ts` / `history-file.ts` (legacy file-based history) assumes a persistent local filesystem, since Cloud Run's local disk is ephemeral per instance (this is actually a good forcing function to finish the Firestore cutover).
- **What exists today:** only a *web static bundle* packaging script (`pack-web-cloudrun.mjs`) targeting `portal.benjaminsquare.com` — no equivalent container/deploy path for the worker API yet. That's the missing half.

### 5.4 Firebase Hosting (or Cloud Run for web) — *proposed*
- **Option A — Firebase Hosting:** simplest possible choice for a no-build-step static site (`web/` is plain HTML/JS/CSS today) — free SSL, global CDN, custom domain mapping, `firebase deploy` fits the same CLI already used for Firestore rules/indexes.
- **Option B — Cloud Run for web too:** only worth it if you want the web tier under the exact same CI/CD/revision/rollback model as the API, or need server-side logic (e.g., injecting config at request time instead of a build step). Given `web/` has zero server-side rendering needs today, this is probably over-engineering — flagging it because the `pack-web-cloudrun.mjs` script suggests someone already leaned this way; worth confirming *why* before committing to it.

### 5.5 Secret Manager — *not yet used, recommended*
- **Role (proposed):** Single home for `GEMINI_API_KEY` (and `ANTHROPIC_API_KEY` / `ZOOM_CLIENT_SECRET` if those providers go live), referenced by the Cloud Run service via a mounted/env secret reference — no `.env` files on disk, no secrets in `wrangler.toml`-style plaintext config.
- **Access control:** grant the Cloud Run service's runtime service account `roles/secretmanager.secretAccessor` scoped to just the secrets it needs — not project-wide.

### 5.6 Artifact Registry + Cloud Build (or GitHub Actions) — *not yet used, recommended*
- **Role (proposed):** Replace "SSH in, `git pull`, `docker compose up`" with: push to `main`/release branch → Cloud Build (or GitHub Actions using `google-github-actions/deploy-cloudrun`) builds the `worker/` image from the existing `Dockerfile.worker` → pushes to Artifact Registry → deploys a new Cloud Run revision.
- **Why this matters for an SE-facing internal tool:** rollbacks become "point traffic at the previous revision" instead of "SSH back in and `git checkout` the old commit."

### 5.7 IAM & service accounts — *implicit today, needs to be explicit*
- Right now, "who can deploy" is "who has the VPS root password" and "who has the `wrangler` Cloudflare token." Under GCP, this becomes real IAM: a deploy service account with least-privilege roles (`run.admin` on the specific service, `secretmanager.secretAccessor`, `artifactregistry.writer`), and human access controlled via GCP IAM roles instead of shared SSH credentials.

### 5.8 Cloud Logging / Cloud Monitoring / Error Reporting — *free with Cloud Run, not yet used*
- Cloud Run automatically ships stdout/stderr to Cloud Logging — the app's existing `console.log`/`console.error` calls (already following the security convention of logging IDs/status, not full payloads or secrets, per the repo's own lint conventions) need **zero code change** to start showing up there.
- Error Reporting picks up uncaught exceptions automatically for supported Node runtimes on Cloud Run — meaningful upgrade over "someone notices the VPS is returning 502s."

### 5.9 Vertex AI vs. direct Gemini API key — *decision point, not a default*
- **Current:** `GEMINI_API_KEY` from Google AI Studio, called directly over HTTPS from the worker. Simple, works, no GCP project/IAM ceremony required.
- **Vertex AI alternative:** calling Gemini through a GCP project via Vertex AI would buy you: per-project quota and billing isolation, IAM-scoped access to the model (instead of a bearer API key that works from anywhere), VPC Service Controls if you ever need network-level restriction, and a consistent audit trail alongside your other GCP activity (Cloud Logging/Cloud Audit Logs).
- **Recommendation to validate with you:** for an internal tool at this scale, the direct API key is probably fine and not worth the migration effort *unless* there's a compliance/security requirement (e.g., "no API keys, only IAM") — flagging this explicitly because it's the one place "GCP-native" and "what we have" genuinely diverge in effort-vs-benefit, and we want your take on whether that requirement exists or is coming.

### 5.10 Things we do **not** think we need
- ~~**Cloud SQL / any relational DB** — the domain is doc-shaped (Lifecycle as aggregate root with linked artifacts), Firestore already fits and is already built against.~~ **SUPERSEDED by [ADR-008](./adr/008-firestore-to-sql-decision.md) (2026-08-20):** the Lifecycle aggregate was retired by ADR-003; the heaviest data (MEDDPICC, scorecards, stage history, product signals) is relational, and Cloud SQL Postgres is now the system of record per the Janus v9.3 schema. The rest of this brief's recommendations (Auth, Cloud Run, Secret Manager) still stand.
- **Pub/Sub / Cloud Tasks** — everything today is synchronous request/response (SE waits 15–45s for a result in the UI). No background job queue exists or is architected for. Would only come up if async contact-enrichment or batch processing became a real requirement.
- **VPC / Cloud NAT / private networking** — Cloud Run's default networking (public HTTPS ingress, egress to Gemini/Zoom over the public internet) matches what the app already does; no internal-only services exist to protect with a VPC.

---

## 6. Deployment options — decision matrix

| Option | Description | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. Stay VPS** | Keep Docker Compose + Caddy + Netcup/VPS, retire the Cloudflare and Cloud Run experiments | Already working in prod; team knows it; zero migration cost | Manual ops (patching, SSH, no autoscaling, single point of failure, no managed rollback), secrets in `.env` files, no CI/CD | Fine as a stopgap, not where we want to end up |
| **B. Stay Cloudflare (Workers + Pages + KV)** | Retire VPS and Cloud Run, go all-in on the Cloudflare path that already exists in code | Cheap, fast edge network, `wrangler` already wired | Splits the stack across two clouds (Cloudflare for compute/hosting, Firebase/GCP for auth+data) — never fully consolidated; KV is a step backward from Firestore for history | Only makes sense if there's a hard reason to avoid GCP compute specifically |
| **C. Go GCP-native (Cloud Run + Firebase Hosting)** *(recommended, pending your review)* | Retire VPS and Cloudflare compute; keep Firebase Auth + Firestore (already there); add Cloud Run for the API, Firebase Hosting for the web, Secret Manager, Cloud Build | Everything (auth, data, compute, secrets, logs) in **one** project/console/IAM boundary; autoscale-to-zero cost model fits low/bursty internal-tool traffic; least code change since the worker is already containerized | Migration effort to finish (container deploy pipeline, DNS cutover, retire two other deploy paths); team needs to get comfortable with `gcloud`/Cloud Run if not already | **This is the one we want your gut check on** |

---

## 7. Specific questions for you

1. Given the worker is already Dockerized for the VPS, is there a reason **not** to point that same image at Cloud Run rather than maintaining a third bespoke deploy path?
2. Does `web/scripts/pack-web-cloudrun.mjs` (manual zip → Cloud Run, domain `portal.benjaminsquare.com`) reflect a decision already made to move web hosting to GCP, or was it an experiment we should just delete in favor of Firebase Hosting?
3. Is the dual-write (`localStorage`/KV/file history *and* Firestore) safe to cut over now, or is there a reason it's still running both? What's blocking finishing `docs/DOMAIN_MODEL.md`'s migration runbook?
4. For an internal tool restricted to `@freshworks.com`, is Secret Manager + Cloud Run IAM overkill, or the right minimum bar given it currently handles a live Gemini API key via `.env` files copied by hand onto a VPS?
5. Do you see a reason to move off a raw Gemini API key onto Vertex AI, or does that only become worth it if/when there's a compliance ask?
6. Should the Cloudflare Worker entrypoint (`src/index.ts`) be deleted outright, or kept as a documented "cheap edge fallback" option even if Cloud Run becomes primary?
7. Is Firestore's security-rules-as-enforcement pattern (RBAC at the DB layer, not just the API layer) something you'd keep as-is, or would you push more of that logic into the API layer once there's a real backend home (Cloud Run) instead of a stateless edge worker?

---

## 8. Reference — where things live in the repo

| Path | What it is |
|---|---|
| `web/` | Static frontend (no build step), Crayons Dew UI |
| `worker/src/index.ts` | Cloudflare Worker entrypoint |
| `worker/src/node-server.ts` | Node/Docker entrypoint (VPS today, proposed Cloud Run target) |
| `worker/wrangler.toml` | Cloudflare config (vars, KV binding, secrets via `wrangler secret put`) |
| `deploy/vps/` | Docker Compose, Caddy, nginx, systemd unit, VPS setup scripts |
| `web/scripts/pack-web-cloudrun.mjs` | Ad hoc Cloud Run web packaging script (domain: `portal.benjaminsquare.com`) |
| `firestore.rules` / `firestore.indexes.json` | Firestore security rules + indexes (deployed via Firebase CLI) |
| `web/domain/` | Domain model client layer (account/contact/lifecycle services, dual-write bridge) |
| `worker/src/domain-model/` | Domain model types + permissions (server-side) |
| `docs/ARCHITECTURE.md` | Core domain vs. extension-lane philosophy |
| `docs/DOMAIN_MODEL.md` | Firestore schema + migration runbook |
| `docs/RBAC.md`, `docs/adr/002-org-hierarchy.md` | Roles, visibility, org hierarchy |
| `docs/FIREBASE_SETUP.md` | How Firebase Auth/Firestore is wired today |
| `docs/VPS_DEPLOY.md` | Current production deploy (VPS) |
