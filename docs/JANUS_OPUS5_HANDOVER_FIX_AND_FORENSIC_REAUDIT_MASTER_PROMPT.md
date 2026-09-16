# JANUS OPUS 5 MASTER PROMPT

## Finish the handover fixes, then perform a full PostgreSQL-first forensic re-audit

Use this prompt in Claude Code with **Opus 5 Extra** on the new laptop that has authenticated access to the repository and the staging environment.

---

## Your role

Act as the principal engineer, database reliability engineer, application security reviewer, performance engineer, test architect, and release guardian for Janus.

This is not a normal code-review pass. You are taking custody of a high-risk integration branch that combines recent database work with functional fixes from an earlier forensic audit. Your work must establish whether the resulting application is genuinely correct from browser action to final durable PostgreSQL state.

Be sceptical of comments, old reports, green test summaries, HTTP 200 responses, UI success states, and handover claims. Treat them as leads to verify against the current commit, current runtime configuration, current PostgreSQL schema, and current staging behaviour.

Do not optimise for speed of completion. Optimise for correctness, evidence, reversibility, and a clean handover.

---

## Mission

Complete this in two strictly separated modes:

1. **Bounded implementation mode:** continue from the existing handover and implement only the remaining unambiguous handover items listed in this prompt. Root-cause and fix the known triple-resolve defect first.
2. **Forensic audit mode:** after the bounded fixes are complete and tested, freeze product-code changes. Audit the fully changed branch, produce a detailed evidence package and implementation prompts, then stop for human review.

The final result of this session is **not** permission to implement every newly discovered issue. Newly discovered issues belong in the audit package and later implementation prompts.

---

## Repository and branch direction

Repository:

```text
https://github.com/Antony-sagayaraj/SE-Labs
```

Authoritative source branch for this work:

```text
main-with-functional-fix
```

Create a new working branch from the latest remote version of that branch:

```text
fix/janus-handover-and-forensic-reaudit-YYYYMMDD
```

You may commit and push only this new branch.

You must never:

- push directly to `main`;
- push directly to `main-with-functional-fix`;
- force-push;
- rewrite shared history;
- merge into either protected branch;
- open or merge a PR unless the user separately asks;
- deploy to Cloud Run without asking first.

At the start, fetch all refs and record the exact values of:

```text
SOURCE_BRANCH
SOURCE_SHA
MAIN_SHA
MERGE_BASE_WITH_MAIN
WORKING_BRANCH
WORKING_BASE_SHA
```

If the working tree is dirty, either source ref is missing, authentication fails, or the source branch cannot be fetched, stop and report the blocker. Do not improvise around repository-access controls.

The earlier merge report mentioned `main-with-functional-fix @ 5121bc4`, `main @ a4d5cb7`, and Astra source `d99d82d`. These are historical identifiers only. **Do not assume they are still current.** Resolve the live refs yourself.

---

## Decisions that are already settled

Do not ask the user these questions again.

### Data architecture

- PostgreSQL is the **only authoritative application-data store**.
- Firebase remains only for user authentication.
- Firestore must not be a primary, fallback, mirror, recovery, analytics, history, or hidden write target for application data.
- A UI cache may exist, but localStorage, browser memory, Firestore, or a JSON blob must not be the sole durable source for any user-visible artefact.
- Do not blindly delete legacy Firestore paths during the audit. Prove their reachability, map their data contract, and prepare a safe decommission plan for later implementation.

### Runtime and database

- Cloud Run is the intended runtime.
- The currently available Cloud SQL environment is **staging**, not production.
- Production will be handled later.
- You may inspect Cloud Run configuration and logs.
- You must ask before every deployment, including staging deployments.
- Do not modify Cloud Run services, revisions, traffic, environment variables, secrets, IAM, scheduler jobs, probes, or networking without explicit approval.

### Staging database authority

The staging credential may technically have read/write capability. That capability is not broad authorization.

You may:

- inspect schema, migrations, settings, query plans, constraints, indexes, RLS, grants, row counts, and sanitized data distributions;
- create isolated synthetic records prefixed `JANUS_AUDIT_TEST` for end-to-end acceptance tests;
- operate only on the exact synthetic rows created by this session;
- clean up those exact synthetic rows using a reviewed, id-scoped cleanup script.

You may not:

- alter existing user or business records;
- run unbounded UPDATE or DELETE statements;
- truncate tables;
- apply DDL or migrations to staging;
- run a repair, backfill, reclassification, or bulk replay against existing data;
- disable RLS, constraints, triggers, or audit controls;
- use production credentials or contact production.

Run destructive, concurrency, failure-injection, rollback, migration, and replay tests against a disposable local PostgreSQL database. Staging is for read-only verification plus tightly scoped synthetic acceptance records.

Before any staging DML, print the exact test-record plan, prefix, target tables, and cleanup predicate. Confirm every predicate is tied to generated public IDs or an equally narrow unique marker. After cleanup, prove that the exact created rows are gone and unrelated row counts are unchanged.

### Authentication and secrets

- OAuth must occur through the normal user authorization flow.
- A real user may authorize through the UI when required.
- Never extract, display, print, copy, export, persist, or commit OAuth access tokens, refresh tokens, cookies, client secrets, database passwords, PATs, Zoom passcodes, or service-account material.
- Never move secrets between machines.
- Use already configured staging credentials where available.
- When an integration credential is unavailable, use a mock where meaningful and mark the real path `RUNTIME-BLOCKED` or `UNVERIFIED`; do not fake a pass.
- Redact secrets and PII from commands, logs, screenshots, reports, fixtures, and git history searches.

### SE motion

New Business versus Expansion is determined by the **call owner's configured profile**.

- In a normal flow, the logged-in SE and the call owner are usually the same person.
- In a manager/admin proxy flow, the selected call owner's profile controls the motion. The manager's or admin's own motion must not leak into the call.
- Resolve motion server-side from the canonical user/profile data. Do not trust a client-supplied motion as authority.
- Persist the resolved motion and its provenance using the schema's real enum/value conventions.
- The same resolved motion must be consistent across `activity`, `post_call`, `scorecard`, rubric selection, leaderboards, and downstream summaries wherever those contracts require it.
- Missing or invalid motion configuration must fail loudly or enter a clearly distinguishable unresolved state. It must never silently default to New Business.
- Historical calls must retain their persisted motion snapshot unless an explicit, separately approved backfill changes them.

### Work boundary

- First implement every **unambiguous remaining handover item** identified below.
- Stop and document anything requiring an architectural guess, destructive migration, mutation of existing staging data, production action, or credential rotation.
- After the bounded handover implementation passes its gates, enter audit-only mode.
- During audit-only mode, do not modify product code, tests, schema, migrations, dependencies, infrastructure, deployment files, environment files, or CI.
- Audit-only mode may create documentation, evidence, disposable local test fixtures, and approved `JANUS_AUDIT_TEST` staging records.
- At the end, generate implementation prompts for the next session and stop for user review.

---

## Evidence vocabulary

Every important claim must carry exactly one status:

| Status | Meaning |
|---|---|
| `CODE-PROVEN` | Proven by a complete current-code trace with file and line references |
| `TEST-REPRODUCED` | Reproduced in an isolated local test |
| `STAGING-VERIFIED` | Verified through staging runtime or direct staging SQL evidence |
| `FIXED-AND-VERIFIED` | Previously present, changed in this branch, and proven by a failing-before/passing-after test |
| `PARTIAL` | Some required paths are proven and others are not |
| `STALE` | A prior claim no longer describes the current branch |
| `HYPOTHESIS` | Plausible but not yet proven |
| `RUNTIME-BLOCKED` | Requires unavailable runtime, access, credentials, or approval |
| `NOT-APPLICABLE` | Proven irrelevant to the actual deployed architecture |

Never use `fixed`, `working`, `safe`, `SQL-only`, `secure`, `atomic`, or `production-ready` without evidence that satisfies one of the first four statuses.

For every finding include:

- stable finding ID;
- severity and user/business impact;
- current status;
- affected runtime and flows;
- exact file:line evidence;
- exact database objects and fields;
- reproduction or verification command;
- sanitized observed result;
- root cause;
- false-success surface;
- repair dependency;
- rollback considerations;
- confidence and remaining uncertainty.

---

## Long-run operating protocol

This is expected to be a long Opus session.

1. Create `docs/janus-forensic-reaudit-YYYYMMDD/_audit-state.md` immediately.
2. Record the current phase, completed coverage, commands run, test counts, blockers, and next exact action after every substantial checkpoint.
3. Create `_evidence-index.md` immediately and append evidence IDs as you work.
4. Keep a redacted command log. Never rely on terminal scrollback as the only evidence.
5. If context becomes tight, update the state and evidence files before continuing.
6. You may delegate bounded inventories if subagents are available, but the primary Opus agent must personally verify every accepted claim against source or runtime evidence.
7. Never let a delegated summary become evidence by itself.
8. Do not hide failures by adding waits, weakening assertions, changing fixtures to fit output, marking tests flaky, or converting failures into warnings.
9. Distinguish environment failures from product failures and prove the distinction.
10. Check for stale dev servers, wrong branches, cached assets, and mismatched builds before treating unexpected behaviour as a code defect.

---

# MODE 1: BOUNDED HANDOVER IMPLEMENTATION

## Phase 0 - Immutable baseline and safety capture

Before modifying code:

1. Read all applicable repository instruction files, including `AGENTS.md`, `CLAUDE.md`, `.claude/settings*`, repository git workflow rules, and directory-specific instructions. Record which apply.
2. Fetch the repository and create the working branch from the exact latest `origin/main-with-functional-fix`.
3. Confirm the worktree is clean.
4. Record runtime versions, OS, architecture, Node/package-manager versions, Java, browser/Playwright availability, PostgreSQL tooling, Cloud SQL proxy/connector availability, and GCP authentication state without printing secrets.
5. Install dependencies strictly from lockfiles.
6. Capture baseline build, typecheck, unit, integration, E2E, schema, SQL, RLS, and security-test results before changing code.
7. Start a disposable local PostgreSQL instance using the repository-supported mechanism. Do not rewrite `.dev.vars`.
8. Apply the schema from scratch, reapply it to test idempotency, and record object counts and migration order.
9. If any baseline gate cannot run, mark it `RUNTIME-BLOCKED`; do not count it as passed.
10. Inspect the current branch rather than assuming the older merge report's numbers still apply.

Baseline evidence must include:

- exact commands;
- pass/fail/skip counts;
- reasons for every skip;
- bundle/build sizes;
- current schema/migration file list;
- current tables, views, functions, triggers, policies, indexes, and enum values;
- current deployment configuration as code;
- staging runtime configuration visible through approved inspection, redacted.

Commit no baseline-generated caches, dependencies, browser binaries, local databases, logs containing PII, or environment files.

---

## Phase 1 - Read and reconcile the inherited evidence

Read the current versions of all of the following before implementing anything:

- `docs/astra-audit/00-executive-summary.md` through `13-handoff-next-session.md`, if present;
- `docs/astra-audit/11-implementation-prompts.md` in full;
- `docs/astra-audit/_audit-state.md` and `_evidence-index.md`;
- `docs/astra-audit/repros/**`;
- `docs/merge-audit/**`;
- `docs/datamodel/**`, especially the branch re-audit, decisions log, build/run logs, Firestore-removal gap, field map, and acceptance tests;
- `docs/CUTOVER_SQL.md`, `SQL_AGENT_VERIFICATION.md`, `CLOUDSQL_SECURITY.md`, `DATA_RETENTION_POLICY.md`, `SECRETS_INVENTORY.md`, `RBAC.md`, `ARCHITECTURE.md`, `HLD.md`, `LLD.md`, and current ADRs;
- current schema migrations and their application scripts;
- current route, persistence-port, repository, auth/session, post-call, pre-call, scoring, usage, and leaderboard implementations.

Create `prior-claim-reconciliation.md` with one row for every earlier P1-P15 item, every reported merge limitation, and every material database-work claim. Classify each as:

```text
FIXED-AND-VERIFIED
PARTIAL
REGRESSED
STALE
STILL-OPEN
RUNTIME-BLOCKED
```

Do not assume that:

- because the Astra branch implemented a prompt, the merged behaviour still works;
- because `main` contained database fixes, the current functional branch preserves them;
- because a method exists, a route reaches it;
- because a route returns 2xx, PostgreSQL committed;
- because PostgreSQL has rows, all fields and child artefacts are correct;
- because a test passed, it actually connected to PostgreSQL;
- because configuration says `sql`, no Firestore/local fallback remains;
- because a document says Firestore is removed, runtime code and deployed environment agree.

---

## Phase 2 - Root-cause and fix the triple `/api/postcall/resolve` defect first

Known report: one press of **Analyse call** produced three `POST /api/postcall/resolve` requests. One was identified as pre-resolve warm-up; the other two were not explained.

Do not guess. Instrument all current call sites of:

- `RESOLVE_URL`;
- `postJson(RESOLVE_URL, ...)`;
- form submission;
- `fwClick`, native `click`, and `submit` handlers;
- warm-up/pre-resolve;
- retries and Zoom-pending polling;
- view re-entry and initialization;
- any re-render or reconnect path capable of rebinding handlers.

For each request capture, without secrets or transcript content:

- normalized input key;
- request origin/call site;
- stack trace;
- event type;
- monotonic timestamp;
- in-flight state;
- retry reason;
- view instance/generation id;
- user action id.

Reproduce before changing behaviour. Establish exactly which logical paths issue the requests.

Required invariant:

> One user gesture creates at most one new submit-path resolve operation. Requests for the same normalized input and view generation must share one in-flight promise/result. A warm-up result should be reused when valid, not duplicated. A retry may occur only for a classified retryable outcome, with an explicit attempt number and backoff.

The `pass0Busy` flag alone is not proof. Verify event binding, form semantics, component custom events, async re-entry, and initialization order.

Acceptance tests:

- one click with ordinary input;
- one Enter-key submit;
- rapid double click;
- `fwClick` plus native `click` emission;
- warm-up already complete;
- warm-up in flight when clicked;
- Zoom transcript pending and later ready;
- hard Zoom OAuth/configuration error;
- route timeout;
- view navigation away and back;
- manager proxy flow;
- browser back/forward restoration.

Assert request counts, not merely UI output. Leave no `console.trace`, raw payload logging, or temporary instrumentation in the final code.

---

## Phase 3 - Fix the transiently enabled Analyse button

The earlier merge report proved that the Analyse button could briefly become enabled on view entry and only settle to disabled about 2.5 seconds later. Do not mask the test with a delay.

Establish one explicit initial-state model so the button is disabled before the first paint unless all required local fields and owner/proxy conditions are already valid.

The button must not wait for a completed CRM lookup, but it also must not become clickable during uninitialized state.

Test:

- first DOM frame;
- hydration/initialization in progress;
- empty required fields;
- valid fields;
- invalid URL/passcode combination;
- manager proxy selector missing/present;
- slow and failed CRM preview;
- repeated navigation into the screen.

The existing failing E2E must fail before the fix and pass after it without adding an arbitrary wait.

---

## Phase 4 - Complete the unambiguous remaining handover items

Read the full current prompt text and evidence before acting. The summaries below define the allowed scope but do not replace source inspection.

### 4.1 P1: purge the committed Zoom recording credential

- Re-prove that the reported `debug-zoom*.mjs` files are unreferenced before deleting them.
- Delete only files proven dead and containing the exposed recording URL/passcode pattern.
- Search the full working tree and git history without printing the literal.
- Add or repair secret scanning in CI.
- Do not rewrite git history.
- Do not attempt credential/passcode rotation. Report it as a mandatory external action.
- Do not delete legitimate manual Zoom test tools that accept secrets only at runtime.

### 4.2 P15: establish trustworthy CI

- Run PostgreSQL-backed gates in CI.
- Run TypeScript typechecking for all applicable workspaces.
- Make requested SQL tests fail loudly when `DATABASE_URL` is absent; permit only explicit local skip flags.
- Ensure every test file is registered or deliberately and visibly classified.
- Run every manifest tag somewhere appropriate.
- Add the required Java runtime for emulator tests.
- Prevent a unit-test failure from silently suppressing E2E execution/reporting.
- Compare all schema-application paths and fail on migration drift.
- Fix or remove tautological tests and cross-platform harness failures.
- Preserve `manual-only` and `live-api` exclusions; never run paid or destructive tests in CI.
- Include Linux CI as the release authority while making local tooling work on the new laptop's OS.

### 4.3 P4: close the known authorization holes

Re-verify and fix, if still present:

- resource ownership/tenant authorization for `POST /api/calls/:id/offload-payload`;
- authentication plus admin authorization for global feedback reads;
- authentication and rate/cost controls for `/api/search/rag`;
- call-owner authorization for `/api/read-models/schedule`;
- any unsafe route registration introduced or preserved by the functional merge.

Keep the director analytics route unreachable unless it has a correct role check and tenant/org scope. Do not trade security for route reachability.

Add positive and negative tests, including two users in different org subtrees. Unknown resources should not leak their existence.

### 4.4 P5: make failed durable writes observable

Re-evaluate the old P5 mechanics against the current SQL-only target. Preserve the invariant, not stale Firestore-era implementation details:

> Every requested durable write either commits to PostgreSQL or produces a queryable, attributable failure and a truthful user-visible state.

- Record failures and deliberate skips with method, reason, entity public id, request correlation id, actor, owner, and timestamp, without sensitive payloads.
- Do not swallow the original error.
- Do not let a 2xx or successful UI state imply that PostgreSQL committed when it did not.
- Keep non-blocking UX only for genuinely asynchronous recoverable work; durable failures must be recoverable and visible.
- Do not add Firestore fallback.
- If the exact historical `POST /api/history` 200 contract conflicts with the present PostgreSQL-only architecture, stop and document the conflict instead of guessing.

### 4.5 P10: provider timeouts and pass classification

- Ensure every external provider call has an explicit timeout, abort propagation, bounded retry policy, classified retryability, and telemetry.
- Reconcile every actual pass name with its timeout/workload class.
- Cover Zoom, LLM generation, embeddings, enrichment, transcript inference, and any current provider introduced since the old audit.
- Do not retry non-idempotent operations blindly.
- Simulate hung sockets and cancellation.
- Preserve established quality safeguards unless evidence proves a change is safe.

### 4.6 Merge limitations that require closure or a documented stop

- Validate whether `nodejs_compat` is relevant to the actual Cloud Run runtime. If it applies only to an unused Cloudflare target, classify it; do not remove it during this phase unless it is unambiguously dead.
- Verify Cloud Run liveness/readiness paths against actual service configuration through read-only inspection.
- Verify every route added by the functional branch is authorized and reachable.
- Confirm the process-level error handlers do not hide request failures or leave the process in an unsafe state.
- Confirm history merge semantics really use recency/version rather than argument order.
- Confirm duplicate UI bindings are removed without breaking keyboard, accessibility, or custom-element events.

### 4.7 Change discipline for bounded implementation

For each logical change:

1. Reproduce or prove the defect first.
2. Write or repair the failing test.
3. Make the smallest coherent implementation.
4. Run focused tests.
5. Run the relevant regression lane.
6. Review the diff for unrelated edits.
7. Commit separately with a precise message.
8. Record evidence and rollback.

If a handover item requires a schema redesign, destructive migration, architectural guess, existing-data repair, production action, or unavailable secret, do not implement it. Mark it `BLOCKED-FOR-DECISION` with the exact question and evidence.

---

## Phase 5 - Post-fix release gate

Before entering audit mode:

- rerun clean install and build;
- rerun typechecking;
- rerun every unit/integration/E2E lane;
- rerun PostgreSQL schema-from-zero and idempotent-reapply gates;
- rerun grants, RLS fail-closed, view-RLS, transaction, and persistence tests;
- rerun triple-resolve request-count E2E tests;
- rerun Analyse-button first-frame E2E tests;
- run secret scanning;
- compare bundle size and critical request counts with baseline;
- inspect all staged/committed files and confirm they map to approved handover items;
- confirm no environment or secret file is tracked;
- confirm no unapproved staging or Cloud Run mutation occurred.

Create `bounded-fix-validation.md` containing baseline-versus-final counts and remaining blockers.

Push the working branch only after these gates. Do not open or merge a PR and do not deploy.

Then write the exact marker below to `_audit-state.md`:

```text
AUDIT_ONLY_MODE_STARTED_AT=<commit sha>
```

From that point onward, product-code changes are prohibited in this session.

---

# MODE 2: FORENSIC AUDIT OF THE FULLY CHANGED BRANCH

## Phase 6 - Rebuild the current as-built architecture

Do not copy the old architecture diagram. Reconstruct the current one.

Inventory and connect:

- browser entry points, pages, components, service workers, and event bindings;
- web stores, repositories, read services, write services, caches, and local persistence;
- worker route registration, dispatch tables, middleware, auth, rate limits, and error handling;
- synchronous APIs, detached work, background work, schedulers, cron jobs, outbox/projectors, and recovery routes;
- LLM, embeddings, Zoom, CRM, OAuth, email, and enrichment providers;
- PostgreSQL pools, roles, session context, transactions, RLS, schema objects, migrations, triggers, constraints, functions, views, and indexes;
- Cloud Run services, revisions, concurrency, connection pooling, health probes, timeouts, environment modes, secrets, and network path to Cloud SQL;
- CI/CD, deployment scripts, local development overrides, and alternate runtimes.

Produce current architecture and deployment diagrams. Clearly label code paths that exist but are not reachable in the actual Cloud Run deployment.

---

## Phase 7 - Full PostgreSQL wiring and parity audit

This is a primary deliverable.

Create a field-level, bidirectional wiring matrix for every application feature, including:

- authentication identity mapping;
- user and profile configuration;
- org, BU, segment, team, manager, and role hierarchy;
- accounts, deals, contacts, deal contacts, and lifecycle events;
- pre-call creation, generation, reads, updates, retries, and history;
- post-call intake, resolve, confirmation, generation, hydration/finalization, scoring, and reads;
- transcripts and transcript references;
- narrative analysis and every `detail` artefact;
- scorecards, themes, lines, risks, rubric/profile selection, overrides, and disputes;
- participants and identities;
- qualification/MEDDPICC;
- technical commits;
- ARR inputs, lines, calculations, and overrides;
- product gaps, what worked, signals, clusters, and summaries;
- deal traction, deal summaries, and account summaries;
- tasks, feedback, recovery/import, and history;
- usage, AI runs, costs, tokens, latency, adoption, dashboards, and leaderboards;
- read models, cache invalidation, notifications, scheduled jobs, and telemetry.

For every UI/API/store method and every meaningful field, document:

```text
UI source
client method
request schema
route and authorization
server handler
validation
transaction boundary
repository method
SQL statement/function
table.column or JSON path
constraints and conflict target
idempotency key
owner/org derivation
write result handling
read path
cache/fallback behaviour
test coverage
runtime evidence
```

Also build the reverse matrix: for every application-owned table, column, JSON key, view, function, trigger, queue/outbox table, and index, identify all writers, readers, migrations, tests, and deployed callers.

Classify each surface:

```text
LIVE-READ-WRITE
LIVE-READ-ONLY
LIVE-WRITE-ONLY
UNREACHABLE
FIRESTORE-DEPENDENT
LOCAL-ONLY
MIGRATION-ONLY
TEST-ONLY
ORPHAN-CANDIDATE
UNKNOWN
```

Explicitly find:

- any Firestore application-data read or write;
- any `applyDomainWrite` or equivalent fallback;
- any local-host override that bypasses PostgreSQL;
- any localStorage/history blob acting as authority;
- any HTTP success that hides a missing commit;
- any SQL write with no product read;
- any product read with no SQL writer;
- any route or repository method whose names imply parity but whose semantics differ;
- any JSONB whole-object replacement that can erase concurrent fields;
- schema/runtime drift;
- enum/text mismatches and silent defaults;
- owner/account/deal joins that incorrectly bypass `activity`.

Historical documents conflict about whether Firestore is primary, dual-write remains, or SQL-only is complete. Resolve that conflict from current code, current configuration, and staging evidence.

### Mandatory re-verification of the database workstream

The earlier handover assigned P2, P3, P7, P8, P9, and P11 to the database branch. The functional merge report proved that it preserved selected database code during the merge, but it did not prove these six invariants end to end. Re-run them against the current branch:

| Workstream | Invariant to prove now |
|---|---|
| P2: non-destructive post-call UPSERT | Sparse/history writes cannot null hydrated `detail`, transcript references, shape versions, motion provenance, or regress `pipeline_state`; the operation remains atomic |
| P3: writer convergence | History, domain, retry, re-analysis, and concurrent writers converge on exactly one `post_call` for one call in either arrival order |
| P7: hydration/finalization persistence | Every generated post-call artefact reaches its intended PostgreSQL destination after the final merged record exists; Pass 8/9 never compute from empty current-call evidence |
| P8: pipeline state | State is derived from real persisted artefact presence, advances monotonically, and is truthful after partial failure and recovery |
| P9: AI-run attribution | Every post-call provider invocation is attributable to the verified user and final `activity`/`post_call`; no client body controls identity and no `call_pending_*` placeholder becomes permanent |
| P11: bulk/recovery projection | Recovery and bulk history paths project every valid call to PostgreSQL with bounded concurrency, idempotency, visible failures, and no Firestore dependency |

Also re-prove the database branch's broader claims rather than accepting its run log:

- all declared browser write methods have a real PostgreSQL path in SQL mode;
- all application-data reads required by live screens have PostgreSQL paths;
- SQL mode cannot fall through to Firestore;
- local development does not silently force Firestore;
- `HISTORY_BACKEND_MODE` or its successor is PostgreSQL-backed and not a hidden third authority;
- schema application paths agree and every intended migration is applied;
- score scale, rubric/profile parents, motion provenance, N/A semantics, current/provisional semantics, and leaderboard views match current product rules;
- user identity provisioning works for the actual active roster and does not cause silent write loss;
- RLS and grants operate as `janus_app`, not only as a superuser;
- API acceptance tests AT-1 through the latest AT-N exercise current HTTP handlers and current database code, not only direct repository methods;
- writes are verified by querying the exact resulting rows through the correct join path, especially `app_user -> activity -> post_call/scorecard/pre_call`.

For every one, record failing-before/passing-now evidence where history permits. If the old repro no longer fails, explain the current mechanism that prevents it and add a regression test if none protects that mechanism.

---

## Phase 8 - Trace critical journeys from gesture to durable read-back

For every critical journey, create a write ledger and a read-back ledger:

1. sign in and identity/session provisioning;
2. New Business SE pre-call;
3. Expansion SE pre-call;
4. New Business SE post-call;
5. Expansion SE post-call;
6. manager/admin proxy post-call;
7. Zoom transcript available;
8. Zoom transcript processing/polling;
9. Zoom hard error or revoked OAuth;
10. re-analysis of the same call;
11. page refresh during analysis;
12. two tabs processing the same call;
13. retry after partial provider failure;
14. account/deal/contact creation and linking;
15. scorecard and leaderboard appearance;
16. weekly usage and zero-adopter reporting;
17. recovery/import and replay;
18. hard refresh and a second browser/device reading the completed result.

For post-call, enumerate every generated artefact and prove its durable destination. Do not declare success because the UI renders it from memory.

The strongest persistence acceptance check is:

> Complete the operation, close the tab, clear local application cache, open a fresh authenticated browser session, and reconstruct the same result from PostgreSQL-backed APIs alone.

Capture request counts, dependency order, transaction boundaries, row/field deltas, state transitions, retries, and false-success sites.

---

## Phase 9 - Motion, scoring, leaderboard, and usage correctness

### Motion tests

Prove all of these:

- a configured Expansion call owner produces an Expansion `post_call`;
- the matching scorecard uses Expansion motion and the correct Expansion rubric;
- a configured New Business call owner produces New Business;
- a manager running a call for an Expansion SE still produces Expansion;
- a manager running a call for a New Business SE still produces New Business;
- client-body motion tampering is rejected or ignored;
- missing configuration is visible and does not silently become New Business;
- retry, re-analysis, recovery, and bulk paths preserve the same motion;
- `se_motion_source` or its current equivalent is populated with the real resolution provenance;
- historical motion does not change merely because a user's current profile changes.

Inspect existing staging distributions for configured-vs-stored motion using read-only queries. Earlier evidence found all human post-calls stored as New Business, nine confirmed Expansion-owner mismatches, dozens of unconfigured users, and missing motion provenance. Treat those numbers as historical leads only. Recalculate the current counts and do not repair existing rows.

### Scorecard and leaderboard tests

Prove:

- one current scorecard per eligible call;
- correct call owner and org assignment;
- correct motion and rubric/profile;
- real score scale and category values round-trip;
- provisional and current semantics are coherent;
- leadership cap/shareability behaviour matches the current approved product rule;
- New Business and Expansion leaderboards do not mix;
- the leaderboard uses stored call-owner motion, not the viewer's or actor's motion;
- missing scorecards are visible as pipeline defects, not silently excluded;
- the UI presents a top three when only a top three is requested and does not fabricate additional ranked people;
- current eligibility does not reintroduce an unapproved confidence threshold.

### Weekly usage tests

Verify daily rollups against raw source tables for the same window. Distinguish:

- per-person login events and days logged in;
- pre-call runs;
- post-call runs;
- total pre + post runs;
- AI runs and attributed tokens/cost;
- people with zero usage;
- team-level distinct-user summary counts.

Do not use the ambiguous word `workflows` in user-facing output unless the UI defines it. Prefer `Total Pre + Post Runs`.

---

## Phase 10 - ACID, concurrency, idempotency, and recovery audit

For every multi-table operation, map what must succeed atomically and what is intentionally asynchronous.

Test and review:

- transaction start/commit/rollback ownership;
- isolation level and anomalies possible under current Cloud SQL settings;
- lost updates;
- write skew;
- duplicate inserts;
- idempotency-key and public-id convergence;
- uniqueness races;
- concurrent re-analysis;
- two-tab hydration/finalization;
- retry after timeout where the server may already have committed;
- monotonic pipeline-state transitions;
- whole-JSONB merge semantics;
- child replacement versus merge semantics;
- savepoints and partial failures;
- deadlocks and lock ordering;
- connection interruption and pool exhaustion;
- Cloud Run request cancellation after database commit;
- outbox/job delivery and replay;
- exactly-once claims versus actual at-least-once behaviour;
- recovery after browser close, worker restart, or Cloud Run revision change;
- migration atomicity, ordering, immutability, rollback, and drift;
- backup/restore assumptions and data-loss windows.

Run concurrency and failure-injection tests only on disposable local PostgreSQL. Use staging only for safe synthetic acceptance tests.

Every data-mutating API must have an explicit answer to:

```text
What happens if the request is repeated?
What happens if it times out after commit?
What happens if a child write fails?
What can the user safely retry?
How is incomplete state detected and resumed?
```

---

## Phase 11 - Security and privacy audit

Audit at minimum:

- authentication on every route;
- authorization against the specific resource;
- manager/admin proxy boundaries;
- RLS fail-closed behaviour and tenant/org isolation;
- server-side owner derivation;
- SQL injection and unsafe dynamic SQL;
- IDOR/BOLA;
- privilege escalation;
- SSRF and unsafe Zoom/URL fetching;
- CORS, CSRF, clickjacking, and security headers;
- XSS and unsafe HTML rendering;
- file upload, archive, path traversal, and content-type handling;
- OAuth state, redirect, token lifecycle, revocation, and logging;
- secret exposure in working tree, history, CI, logs, fixtures, screenshots, and docs;
- rate limits, denial of wallet, provider-token abuse, and expensive unauthenticated routes;
- prompt injection and untrusted transcript/document content reaching tools or model instructions;
- sensitive-data minimization, retention, deletion, transcript handling, and PII in telemetry;
- dependency and supply-chain risk;
- debug, admin, recovery, batch, and internal routes;
- Cloud Run IAM, service account privilege, Cloud SQL connectivity, and secret delivery as visible through approved read-only inspection.

Create a route authorization matrix and an RLS adversarial test matrix with at least:

- unauthenticated user;
- ordinary SE;
- manager within subtree;
- manager outside subtree;
- admin/director;
- two users in different org paths;
- unknown/deleted user;
- proxy action where actor differs from owner.

Do not include real tokens, transcript text, customer names, emails, recording URLs, or passcodes in evidence.

---

## Phase 12 - Latency, cost, and capacity audit

Measure rather than merely estimate wherever staging access permits.

Build browser network waterfalls and server spans for:

- first post-call page load;
- typing/CRM preview;
- Analyse click to confirmation;
- confirm to first useful result;
- full hydration/finalization;
- saved-call open;
- account and deal views;
- dashboards and leaderboards;
- Zoom transcript acquisition;
- pre-call generation.

Quantify:

- request count and duplicates;
- serial versus parallel barriers;
- browser re-renders and subscription churn;
- database queries, round trips, N+1 patterns, and rows scanned;
- `EXPLAIN (ANALYZE, BUFFERS)` on synthetic/local-safe data and non-mutating staging queries;
- missing/unused indexes;
- pool size versus Cloud Run concurrency;
- connection acquisition time;
- lock wait and transaction duration;
- payload sizes and JSON parse/render cost;
- cache hit/miss/staleness behaviour;
- provider call count, tokens, latency, timeout, retry, and cost per pass;
- cold-start and deployment-revision effects;
- p50, p95, and p99 where sufficient samples exist.

Do not optimise away verification, scoring quality, or security work just because it is slow. Identify safe parallelism, caching, batching, query changes, and architectural fixes with correctness constraints.

Revisit the old findings about serial scorecard/verify/calibration work, classification blocking confirmation, repeated call-view requests, unbounded Zoom fetches, contact loops, and unattributable `ai_run` records. Mark each current status with evidence.

---

## Phase 13 - Orphaned, duplicate, and dead-code audit

Do not delete code in audit mode.

Build reachability from all roots, including:

- HTML and browser entry points;
- static and dynamic imports;
- custom-element and string-based event handlers;
- route tables and regex dispatch;
- worker/server entry points;
- package scripts and test manifests;
- CI workflows;
- deployment scripts and container commands;
- Cloud Scheduler/cron targets;
- external webhooks and documented operator commands;
- migrations, functions, triggers, views, and seed/load scripts;
- feature flags and environment-gated paths;
- recovery/debug/manual tools;
- generated files and their generators.

Classify every candidate:

```text
LIVE
TEST-ONLY
OPERATOR-ONLY
DEPLOYMENT-ONLY
MIGRATION/HISTORY
GENERATED
DUPLICATE-ACTIVE
DEAD-PROVEN
DEAD-SUSPECTED
UNKNOWN
```

To call something `DEAD-PROVEN`, require negative evidence from imports/references, routes, manifests, package scripts, CI, deployment configuration, feature flags, runtime telemetry where available, and git history intent. A grep with zero matches is not enough.

For each dead-proven item, provide:

- exact path/symbol/SQL object;
- proof of non-reachability;
- historical purpose;
- data or migration dependency;
- removal blast radius;
- tests required before deletion;
- recommended deletion group and rollback.

For duplicate implementations, identify which one is canonical and whether their semantics differ. Pay special attention to duplicate post-call writers, stores, SQL helpers, route handlers, motion logic, history/recovery paths, and test harnesses.

---

## Phase 14 - Tests, observability, deployment parity, and operations

Audit whether the test suite genuinely protects the architecture:

- manifest completeness;
- meaningful assertions versus tautologies;
- unit/integration/E2E/database/contract/security/performance coverage;
- local, CI, and operating-system parity;
- hidden skips;
- live-api and manual exclusions;
- deterministic fixtures and cleanup;
- flaky timing assumptions;
- coverage of negative and failure paths;
- schema-from-zero and upgrade-path testing;
- rollback testing;
- query-plan regressions;
- browser request-count assertions;
- Cloud Run configuration parity with repository configuration.

Audit observability:

- correlation from user gesture to request to `activity`/`post_call`/`scorecard`/`ai_run`;
- actor versus owner identity;
- per-pass latency/cost/errors;
- database commit/failure metrics;
- fallback/skip counters;
- pipeline-state distribution;
- missing-child-row detection;
- retry/replay counters;
- RLS/authz rejection metrics;
- logs that are actionable without containing sensitive data;
- alerts, dashboards, SLOs, and runbooks.

Audit operational readiness:

- health/readiness truthfulness;
- Cloud Run timeout/concurrency/min/max instances;
- PostgreSQL pool sizing and connection limits;
- migrations and release ordering;
- feature flags and rollback controls;
- scheduler/outbox ownership;
- backup/restore validation;
- data retention and deletion jobs;
- incident response and credential-rotation procedures;
- disaster recovery, RPO, and RTO assumptions.

---

## Phase 15 - Controlled staging acceptance

Use a dedicated test namespace and unique ids, for example:

```text
JANUS_AUDIT_TEST_<UTC timestamp>_<random suffix>
```

Before tests, record relevant table counts and identify every table the fixtures may touch.

Using the normal OAuth UI flow and the staging Cloud SQL path, verify at least:

1. New Business owner, ordinary flow.
2. Expansion owner, ordinary flow.
3. Manager proxy for an Expansion owner.
4. One Zoom-ready flow if a user authorizes it.
5. One Zoom-pending or mocked-pending flow.
6. Repeated submit and re-analysis idempotency.
7. Page refresh/reopen from PostgreSQL-only reads.
8. Scorecard/rubric/motion consistency.
9. Leaderboard placement.
10. Weekly usage/raw-data reconciliation.
11. Deliberate safe failure showing truthful persistence error state.

For every case:

- capture the browser request ledger;
- capture sanitized server correlation ids;
- query the exact SQL rows afterward;
- verify child content, not just row counts;
- verify actor, owner, org, motion, provenance, and timestamps;
- verify a second read session reconstructs the result;
- record cleanup ids.

Clean up only the synthetic rows, in dependency-safe order, with exact predicates. Prove cleanup. Do not clean up logs if retaining sanitized audit telemetry is intentional; document that choice.

If real integration credentials are missing, run mocks and mark the true integration path unverified. Never claim mocked evidence as staging verification.

---

# REQUIRED AUDIT PACKAGE

Create this directory:

```text
docs/janus-forensic-reaudit-YYYYMMDD/
```

Create at least these files:

| File | Required contents |
|---|---|
| `00-master-index.md` | Navigation, snapshot, verdict, limitations, and completeness status |
| `01-executive-summary.md` | Direct answer: is Janus correctly wired, safe, fast enough, and ready for wider use? |
| `02-prior-claim-reconciliation.md` | Every old audit, database, handover, and merge claim with current status |
| `03-current-architecture.md` | As-built browser/worker/PostgreSQL/provider/deployment topology |
| `04-postgresql-wiring-matrix.md` | Field-level forward and reverse persistence/read parity |
| `05-critical-journey-ledgers.md` | Gesture-to-commit-to-fresh-read traces and request/write counts |
| `06-motion-scoring-usage.md` | Motion, scorecard, leaderboards, and weekly usage proof |
| `07-acid-concurrency-recovery.md` | Transactions, races, idempotency, retries, replay, and recovery |
| `08-security-privacy.md` | Route auth matrix, RLS adversarial results, secrets, PII, and dependency risks |
| `09-latency-cost-capacity.md` | Measured waterfalls, query plans, provider work, bottlenecks, and capacity risks |
| `10-dead-code-inventory.md` | Live/test/operator/dead classifications and deletion proof |
| `11-test-deployment-observability.md` | Test trustworthiness, Cloud Run parity, telemetry, operations, and DR |
| `12-findings-ledger.md` | Prioritized findings with stable IDs, evidence, dependencies, and confidence |
| `13-remediation-roadmap.md` | Ordered phases, risk, blast radius, flags, rollback, and acceptance gates |
| `14-implementation-prompts.md` | Self-contained prompts for the next Opus implementation session |
| `15-final-handoff.md` | Exact branch/SHA, completed work, blockers, commands, and next action |
| `_audit-state.md` | Long-run checkpoint and coverage state |
| `_evidence-index.md` | Evidence IDs mapped to file/line, command, test, SQL, or sanitized runtime result |

Store redacted machine-readable inventories and test outputs beneath `evidence/` where useful.

### Implementation prompt requirements

Each prompt in `14-implementation-prompts.md` must be independently executable and include:

- finding IDs and evidence;
- user-visible and data-integrity impact;
- invariant to establish;
- exact current files/symbols and database objects;
- desired implementation boundaries;
- what must remain unchanged;
- dependencies and required order;
- schema/migration considerations;
- transaction, concurrency, idempotency, and retry requirements;
- security and privacy requirements;
- tests that fail before and pass after;
- local and staging acceptance steps;
- telemetry;
- rollout, feature flag, rollback, and cleanup;
- explicit non-goals;
- stop conditions requiring human approval.

Generate prompts, but do not execute them in audit mode.

---

## Completeness gates

Do not call the audit complete until every gate is either passed or explicitly `RUNTIME-BLOCKED` with a closure step.

### Gate A - Snapshot and provenance

- Exact current branch and SHA recorded.
- All inherited evidence reconciled rather than copied.
- Worktree and change boundaries proven.

### Gate B - Bounded handover fixes

- Triple-resolve root-caused and request-count tested.
- Transient Analyse enable fixed without arbitrary waits.
- Every unambiguous P1/P4/P5/P10/P15 item implemented or specifically blocked.
- Known merge limitations closed or documented.
- No new regression against baseline.

### Gate C - PostgreSQL authority

- Every application data read/write mapped.
- No hidden Firestore application-data dependency remains unreported.
- No local-only durable truth remains unreported.
- Every critical operation proven by post-write SQL and fresh-session read-back.

### Gate D - Motion and scoring

- Expansion, New Business, and proxy flows verified.
- Missing motion cannot silently default.
- Post-call, scorecard, rubric, leaderboard, and usage data reconcile.

### Gate E - ACID and recovery

- Critical transaction boundaries identified.
- Retry/idempotency and concurrency cases tested.
- Partial failure and resume behaviour proven or blocked.

### Gate F - Security

- Every reachable route classified for authn/authz/tenant scope.
- RLS tested adversarially.
- Secrets and PII handling reviewed.
- High-risk findings have reproductions and containment actions.

### Gate G - Latency and capacity

- Critical browser journeys measured.
- Database and provider bottlenecks quantified.
- Request duplication, N+1, pool/concurrency, and timeout risks covered.

### Gate H - Dead code and tests

- All roots and dynamic paths included in reachability.
- Dead-proven and dead-suspected kept distinct.
- No test silently skips or passes without exercising its claimed layer.

### Gate I - Deliverables

- All required files exist and cross-link correctly.
- Every material claim cites evidence.
- Implementation prompts are ordered and self-contained.
- Final handoff gives the next exact action.

---

## Hard stop conditions

Stop and ask the user before:

- any Cloud Run deployment or configuration change;
- any staging DDL or migration;
- any mutation of existing staging data;
- any repair/backfill/replay of historical records;
- any production access or action;
- any credential/passcode/token rotation;
- any architectural decision not settled above;
- any direct push to or merge into protected branches;
- any history rewrite or force push;
- any action requiring secrets not already configured through approved mechanisms;
- any destructive deletion whose target cannot be proven exact and isolated.

A blocker is not permission to bypass a control. Document the smallest concrete decision needed.

---

## Final response format

When finished, report only:

1. repository, source SHA, working branch, and final SHA;
2. bounded fixes completed and their verification results;
3. direct architecture verdict;
4. count of findings by severity and evidence status;
5. whether PostgreSQL-only behaviour is actually proven;
6. whether Expansion/New Business motion is proven end to end;
7. the five highest-risk remaining issues;
8. blocked runtime/deployment checks;
9. audit-package paths;
10. exact next action for the user.

Do not merge, deploy, or begin the generated implementation prompts.

---

## Start now

Begin with the immutable baseline. Print the live branch/SHA facts, create the audit state and evidence index, run the clean baseline gates, and reconcile the current repository against the inherited handover before making the first code change.
