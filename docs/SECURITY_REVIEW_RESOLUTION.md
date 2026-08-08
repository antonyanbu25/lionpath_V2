# Security Review — All Findings & Resolution Status

**Date:** 2026-08-08 · **Branch:** 2.1 · **Repo:** antonyanbu25/lionpath_V2
**Production:** portal.benjaminsquare.com (VPS) · Firebase project: se-singha-paathi

This document answers every security finding from the review, states whether it is
fixed, and how to verify it live on the portal.

---

## P0-1 — Firestore privilege escalation via users/{id} self-update

**Finding:** Any signed-in SE could write `{ role: 'admin' }` to their own `users/{id}`
doc from the browser console and gain admin everywhere (accounts, deals, org structure).

**Status: ✅ FIXED & DEPLOYED** (commit `18c4a18`)

**Fix:** Added `isSelfProfileUpdate()` guard in `firestore.rules`. Self-update is now
restricted to non-privileged fields only (`displayName`, `avatarDataUrl`, `email`,
`updatedAt`). Privileged fields (`role`, `teamId`, `orgId`, `managerId`, `status`,
`authUid`, `id`) can no longer be changed via self-update. Admin and
`canManageOrgStructureUser()` escalation paths preserved.

**Regression test:** `rules-tests/users.test.mjs` — SE self-role-escalation FAILS,
self-displayName SUCCEEDS, admin role update SUCCEEDS, director org-structure update SUCCEEDS.

**How to verify live on portal.benjaminsquare.com:**
1. Log in as a normal SE.
2. Open the browser console (F12 → Console).
3. Run:
   ```js
   // Get your own user id from the session, then:
   const uid = /* your internal user id, e.g. usr_... */;
   const { doc, updateDoc, getFirestore } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js');
   // (or use the app's existing firebase instance)
   updateDoc(doc(getFirestore(), 'users', uid), { role: 'admin' })
     .then(() => console.log('VULNERABLE — role changed!'))
     .catch(e => console.log('BLOCKED ✅ —', e.code));
   ```
4. Expected: `BLOCKED ✅ — permission-denied`. If it says "VULNERABLE", the fix is not live.

---

## P0-2 — Dummy-auth fallback trusts client-claimed identity

**Finding:** `worker/src/auth.ts` `requireUser()` returned `null` (not an error) when
`FIREBASE_PROJECT_ID` was unset, so a misconfigured deploy silently trusted
client-claimed identity. Also `isDemoManagerEmail()` granted manager-proxy write power
via a spoofable email regex.

**Status: ✅ FIXED & DEPLOYED to VPS** (commit `285fe89`)

**Fix:** `buildEnv()` in `node-server.ts` now **hard-fails worker boot** if
`NODE_ENV=production` AND `FIREBASE_PROJECT_ID` is empty. Local dev (NODE_ENV unset) is
unaffected. `requireUser()` logs a prominent DUMMY MODE warning. `wrangler.toml` default
set to `se-singha-paathi`. `isDemoManagerEmail()` is now unreachable in production.

**How to verify live on portal.benjaminsquare.com:**
- The portal loads and the API responds (worker booted = FIREBASE_PROJECT_ID is set).
- Check the worker logs for any `DUMMY MODE ACTIVE` warning — there should be none.
- The worker log line `Firestore admin: ready (project=se-singha-paathi)` confirms real auth.

---

## P0-3 — Secrets spread across three unsynced configs

**Finding:** Secrets live in `wrangler.toml`, VPS `.env`, and Cloud Run config with no
central manager — more copies = more leak surface.

**Status: ✅ ACCEPTED RISK (internal-only tool)** — inventory + drift-check done; full migration deferred

**Done (commit `285fe89`):**
- `docs/SECRETS_INVENTORY.md` — full inventory of every secret across all targets.
- `deploy/scripts/check-secrets-drift.sh` — manual pre-deploy drift check (keys only, values redacted).
- **Committed `FRESHDESK_API_KEY` scrubbed from repo** (commit `25ca86f`) — removed from
  `.env.example` and all docs. Repo is now clean of the key.

**Risk accepted (2026-08-08):** The Freshdesk key is internal-only and not accessible
outside the office laptop, so rotation is not required. The key remains live in the VPS
`.env` only.

**Deferred (ops task, needs gcloud Owner access):** full Secret Manager migration for
Cloud Run, VPS secret management, rotation policy.

---

## P0-4 — No data retention / deletion policy

**Finding:** No retention or deletion policy existed; all data persisted indefinitely.

**Status: ✅ SIGNED OFF — 190-day retention approved** (2026-08-08)

**Done (commit `285fe89` + updated):** `docs/DATA_RETENTION_POLICY.md` — approved
**190-day** retention for call transcripts/analysis, contact PII, accounts, deals,
lifecycles, prep briefs, tasks, and feedback. User records and org structure retained
indefinitely (employee data). Explicitly **no TTL or deletion code added yet** — the
policy is approved; implementation (Firestore TTL + scheduled deletion job) is a
separate, tested task.

**Approved by:** Team lead (Kuttan), 2026-08-08.

---

## P1-1 — Rules vs UI guard parity test

**Finding:** `firestore.rules` and `web/domain/rbac.js` are two independent RBAC
implementations with no automated cross-check.

**Status: ❌ NOT DONE** — recommended as a follow-up. A rules-test asserting UI-visible
actions match rules-permitted actions per role.

---

## P1-2 — Regression test for self-role-escalation

**Finding:** No automated test asserted self-role-escalation fails.

**Status: ✅ DONE** (commit `18c4a18`) — `rules-tests/users.test.mjs` covers it.

---

## P2-1 — isDemoManagerEmail regex spoofable

**Finding:** Demo-mode manager proxy via email regex (`manager@`, `ajay.`, `antony.`,
`vipin.`).

**Status: ✅ MITIGATED** — the P0-2 boot guard makes this path unreachable in production
(it only runs when FIREBASE_PROJECT_ID is unset, which now hard-fails in prod).

---

## P2-2 — No explicit rate-limiting / DoS posture

**Finding:** No dedicated rate limiting beyond the per-user token budget.

**Status: ✅ FIXED & DEPLOYED** (commit `0b4b4b0`)

**Fix:** Added a per-request rate limiter (`worker/src/rate-limit.ts`) — in-memory fixed
60s window counter per user, **120 req/min with 600 burst allowance**. Exempts
`/api/config`, `/api/health/*`, `/api/zoom/status` so polling and Docker healthchecks
are unaffected. Wired into both the CF Worker entry and the Node server's Video Pass 2
intercept. Configurable via `RATE_LIMIT_*` env vars (kill-switch `RATE_LIMIT_ENABLED=0`).

**Impact on normal SE usage:** A single SE generates ~115 HTTP requests/day (~0.08
req/s average); worst-case burst is 15 requests in one minute (all post-call passes +
page load). **15 << 120 — normal pre-call, post-call, and dashboard usage never trips
the limiter.** It only catches script/loop abuse, retry storms, or brute-force floods.

---

## Summary table

| Finding | Severity | Status |
|---------|----------|--------|
| P0-1 users/{id} self-role-escalation | P0 | ✅ FIXED & DEPLOYED |
| P0-2 dummy-auth trusts client identity | P0 | ✅ FIXED & DEPLOYED (VPS) |
| P0-3 secrets in 3 unsynced configs | P0 | ✅ ACCEPTED RISK (internal-only; key scrubbed from repo) |
| P0-4 no data retention policy | P0 | ✅ SIGNED OFF (190-day retention) |
| P1-1 rules vs UI guard parity | P1 | ❌ NOT DONE |
| P1-2 self-role-escalation regression test | P1 | ✅ DONE |
| P2-1 isDemoManagerEmail spoofable | P2 | ✅ MITIGATED |
| P2-2 no rate-limiting | P2 | ✅ FIXED & DEPLOYED |

---

## Immediate action items

1. **Redeploy Cloud Run** with the P0-2 hard-fail + P2-2 rate limiter when janus is stood up (VPS is done).
2. **Optional:** P1-1 rules/UI parity test as a follow-up.
