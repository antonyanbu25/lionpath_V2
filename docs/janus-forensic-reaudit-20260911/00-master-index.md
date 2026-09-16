# 00 — Master index

Forensic re-audit of Janus, **2026-09-11**.
Branch `fix/janus-handover-and-forensic-reaudit-20260911`, base `5121bc4`, head `a10c6ed`.

---

## Verdict in one line

**PostgreSQL is write-only by default and Firestore is read-authoritative** (J-028) — which
reframes every other finding and is settled by one `gcloud` command. Motion is broken for
Expansion SEs and root-caused. 1015 writes are lost and still accruing, with the fix in this
branch undeployed.

---

## Navigation

| File | Contents |
|---|---|
| [01-executive-summary.md](01-executive-summary.md) | the direct answer, findings by severity, **where I was wrong** |
| [02-prior-claim-reconciliation.md](02-prior-claim-reconciliation.md) | every inherited claim, reconciled. Leads with the corpus contradicting itself |
| [03-current-architecture.md](03-current-architecture.md) | as-built request path, four storage targets, deployment |
| [04-postgresql-wiring-matrix.md](04-postgresql-wiring-matrix.md) | forward/reverse parity, classifications reconciled against live row counts |
| [05-critical-journey-ledgers.md](05-critical-journey-ledgers.md) | 18 journeys. **Not one proven end to end**, with the reasons |
| [06-motion-scoring-usage.md](06-motion-scoring-usage.md) | motion, scorecards, leaderboards, weekly usage |
| [07-acid-concurrency-recovery.md](07-acid-concurrency-recovery.md) | transactions, isolation, idempotency, recovery |
| [08-security-privacy.md](08-security-privacy.md) | route auth matrix, RLS, secrets, PII, denial of wallet |
| [09-latency-cost-capacity.md](09-latency-cost-capacity.md) | measured per-pass latency, cost, capacity |
| [10-dead-code-inventory.md](10-dead-code-inventory.md) | reachability, duplicates, 8 deletion groups |
| [11-test-deployment-observability.md](11-test-deployment-observability.md) | suite trustworthiness, deployment parity, operations |
| [12-findings-ledger.md](12-findings-ledger.md) | **J-001 … J-030**, the primary record |
| [13-remediation-roadmap.md](13-remediation-roadmap.md) | ordered phases, **including the identity-before-motion trap** |
| [14-implementation-prompts.md](14-implementation-prompts.md) | P-A1 … P-E1, self-contained, not executed |
| [15-final-handoff.md](15-final-handoff.md) | exact SHAs, first five actions, blockers |
| [bounded-fix-validation.md](bounded-fix-validation.md) | Phase 5 release gate, baseline vs final |
| [_audit-state.md](_audit-state.md) | phase state, blockers, `AUDIT_ONLY_MODE_STARTED_AT` |
| [_evidence-index.md](_evidence-index.md) | **E-001 … E-106**, every claim's source |

---

## Completeness gates

| Gate | Status |
|---|---|
| **A** — snapshot and provenance | **PASS** — SHAs recorded; inherited evidence reconciled, not copied; change boundary proven (51 files, all mapped) |
| **B** — bounded handover fixes | **PASS** — Phase 2 root-caused, Phase 3 fixed, P1/P4/P5/P10/P15 implemented, J-010 pulled in on authorisation. No regression against baseline |
| **C** — PostgreSQL authority | **FAIL, conclusively** — PostgreSQL is write-only by default (J-028); four write targets exist; ~9,662 rows written and read by nothing |
| **D** — motion and scoring | **FAIL, root-caused** — 345/345 New Business, 9 provably mis-stamped, J-025 |
| **E** — ACID and recovery | **PARTIAL** — boundaries mapped and hazards identified; **fault injection did not run** |
| **F** — security | **PARTIAL** — 4 holes closed with tests; ~20 unscoped routes flagged not verified; no staging RLS proof (B-07) |
| **G** — latency and capacity | **PARTIAL** — per-pass latency measured; browser waterfalls and Cloud Run spans blocked |
| **H** — dead code and tests | **PASS** — reachability from all roots; DEAD-PROVEN vs DEAD-SUSPECTED kept distinct; 13 orphan tests registered; no silent skips remain |
| **I** — deliverables | **PASS** — all 17 files present and cross-linked; every material claim carries an evidence ID; prompts ordered and self-contained |

Three gates are honest FAILs or PARTIALs. They are not blocked for want of effort but for
want of four specific things: a deployed-config read, a `janus_app` credential, a live
authenticated session, and the concurrency suite nobody has written yet.

---

## How to read this package

Start with **01**. If you read only one other thing, read **J-028** in
[12-findings-ledger.md](12-findings-ledger.md) — it changes what every other finding means.
Then **13** for the order of work, where the **identity-before-motion** constraint is the
one thing most likely to be got wrong.

Evidence convention throughout: **VERIFIED** = I read the source or ran the query, with an
`E-nnn` id. **DELEGATED** = located by a read-only inventory and not independently
re-read, treated as a lead. Per the mandate, no delegated summary is evidence on its own,
and where a delegated claim conflicted with measurement, the measurement won — twice.
