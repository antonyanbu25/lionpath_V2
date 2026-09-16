# Remaining P0 Security Fixes — Implementation Plan for Codex (gpt-5.5)

**Scope:** Three remaining P0s from the security review (the self-role-escalation P0 is
ALREADY FIXED and deployed — commit 18c4a18, do NOT touch firestore.rules).

**Repo:** /root/lionpath_V2 · **Branch:** 2.1 · **Production Firebase project:** se-singha-paathi
**Deploy targets:** VPS (root@89.58.33.163, /opt/se-singha-paathai, docker-compose, file-based HISTORY_BACKEND)
AND GCP Cloud Run (prep-portal-api-781846715448.us-central1.run.app / yonus.benjaminsquare.com)
Worker runtime: Node server (worker/src/node-server.ts) via Docker on both targets.
Cloudflare Worker path (wrangler.toml / worker/src/index.ts) exists but is NOT the active production deploy.

---

## 1. RISK ASSESSMENT — "WILL DOING 1, 2, 3 BREAK OFF THE ENTIRE CODE?"

Direct answer: **Item 1 can break the app if done wrong. Items 2 and 3 cannot break the
app as scoped here (documentation only, no code changes to running paths).**

### ITEM 1 — dummy-auth hard-fail (worker/src/auth.ts + node-server.ts)

**What breaks if done wrong:** The worker refuses to boot. If FIREBASE_PROJECT_ID is
unset on ANY deploy target when the hard-fail is enabled, that target's container crashes
on startup (exit 1). The portal's API goes 502/down. Full blast radius: ALL API endpoints
(/api/generate-prep, /api/analyze-call, /api/history, etc.) — the entire app is unusable.

**Likelihood of breakage if the pre-checks in this plan are followed:** LOW.
- VPS .env.example already has FIREBASE_PROJECT_ID=se-singha-paathi (line 26).
- Cloud Run first-deploy.sh sets FIREBASE_PROJECT_ID=${PROJECT} where PROJECT=se-singha-paathi.
- Both Dockerfiles set ENV NODE_ENV=production.
- wrangler.toml has FIREBASE_PROJECT_ID="" (empty) — BUT the Cloudflare Worker path is not
  the active production deploy. The hard-fail must allow NODE_ENV != production (local dev)
  to bypass, so local `wrangler dev` is unaffected.

**Guard that prevents breakage:** The hard-fail ONLY triggers when BOTH:
(a) FIREBASE_PROJECT_ID is empty/unset, AND
(b) NODE_ENV === "production" (set by both Dockerfiles).
Local dev (npm run dev / dev:node) does NOT set NODE_ENV=production, so dummy mode stays
available for local development. The pre-deploy verification steps (§1a below) confirm the
env var is present on all targets BEFORE merging the hard-fail.

**Blast radius if it fires unexpectedly:** Single deploy target goes down. Recovery = unset
the hard-fail (revert) or set FIREBASE_PROJECT_ID and restart. Docker healthcheck catches
it within 15s (5 retries × 15s + 60s start_period).

**Risk verdict:** MEDIUM risk, HIGH reward. The pre-checks make it safe. Do it.

### ITEM 2 — centralize secrets (inventory + drift-check doc only — NO code changes to running paths)

**What breaks if done wrong:** NOTHING. This workstream produces a NEW documentation file
(secrets inventory) and a NEW drift-check script that is never invoked by the running app.
Zero changes to worker source, Dockerfiles, or deploy scripts. No runtime path is altered.

**Blast radius:** None. Cannot affect running deploys.

**Risk verdict:** ZERO risk. Pure documentation.

**Why NOT a full Secret Manager migration in this session:** A full migration requires:
- gcloud CLI access with project Owner/Editor on se-singha-paathi
- Creating secrets in Secret Manager, granting IAM roles to the Cloud Run service account
- Updating Cloud Run --set-env-vars to --set-secrets in first-deploy.sh
- Testing that the worker still boots with secrets mounted vs env vars
- VPS has NO Secret Manager equivalent (it uses .env files in Docker) — would need a
  different approach or accepting VPS stays on .env
This is a multi-day ops task with access requirements a coding agent does not have.
Honest scope: inventory + drift-check NOW, full migration LATER (separate ops task).

### ITEM 3 — data retention policy (documentation only — NO code changes, NO deletions)

**What breaks if done wrong:** NOTHING. This workstream produces a NEW policy document.
No Firestore TTL policies are added. No deletion jobs are created. No code changes.

**Blast radius:** None. Cannot affect running data.

**Risk verdict:** ZERO risk. Pure documentation.

**Why NOT a Firestore TTL / deletion job in this session:**
- ADR-006 (docs/adr/006-product-insight.md, line 373) explicitly states:
  "Legal review required before verbatim export and retention defaults ship."
- No retention/deletion code exists today (confirmed: grep for TTL/deleteOlder/purge/retention
  returned zero matches in worker/src).
- Adding a TTL policy without sign-off risks PREMATURE DELETION of call transcripts or
  contact PII — an unrecoverable data-loss event.
- The safe first step is: document the policy table, get sign-off, THEN implement TTL
  as a separate task after legal approval.

---

## 2. PARALLEL WORKSTREAM SPLIT — NO SHARED FILES

Three workstreams, three disjoint file sets. No two workstreams touch the same file.

### WORKSTREAM A — Item 1: dummy-auth hard-fail
**Files owned (exclusive):**
- worker/src/node-server.ts (modify buildEnv — add boot guard)
- worker/src/auth.ts (modify requireUser — tighten dummy-mode + isDemoManagerEmail)
- worker/scripts/test-node-boot.mjs (modify — add FIREBASE_PROJECT_ID + DEPLOY_ENV to test env)
- worker/wrangler.toml (modify — set FIREBASE_PROJECT_ID to "se-singha-paathi" so CF Worker
  path is not broken if anyone deploys it)

### WORKSTREAM B — Item 2: secrets inventory + drift-check
**Files owned (exclusive, all NEW):**
- docs/SECRETS_INVENTORY.md (NEW — inventory of all secrets across all targets)
- deploy/scripts/check-secrets-drift.sh (NEW — diff script comparing .env.example against
  Cloud Run env vars and wrangler.toml vars)

### WORKSTREAM C — Item 3: data retention policy
**Files owned (exclusive, all NEW):**
- docs/DATA_RETENTION_POLICY.md (NEW — retention table + sign-off section)

**Shared-file conflict check:**
- worker/src/env.ts — NOT touched by any workstream (Env interface already has
  FIREBASE_PROJECT_ID; no new fields needed).
- deploy/vps/.env.example — NOT touched by any workstream (Item 1 doesn't need it —
  FIREBASE_PROJECT_ID is already set there; Item 2 documents it in a separate file).
- deploy/vps/docker-compose.yml — NOT touched by any workstream.
- deploy/cloudrun/first-deploy.sh — NOT touched by any workstream (already sets
  FIREBASE_PROJECT_ID=${PROJECT}).
- deploy/cloudrun/README.md — NOT touched (already documents FIREBASE_PROJECT_ID).

**Verdict: ZERO file overlap. All three workstreams can run in parallel.**

---

## 3. PER-ITEM: EXACT FILES, EXACT CODE, VERIFICATION, COMMIT MESSAGE

---

### ITEM 1 — dummy-auth hard-fail (WORKSTREAM A)

#### 1a. PRE-DEPLOY VERIFICATION (do this BEFORE writing any code)

Confirm FIREBASE_PROJECT_ID is set on all deploy targets:

```bash
# 1. VPS .env (SSH into the VPS)
ssh root@89.58.33.163 "grep FIREBASE_PROJECT_ID /opt/se-singha-paathai/deploy/vps/.env"
# Expected output: FIREBASE_PROJECT_ID=se-singha-paathi

# 2. Cloud Run service env (requires gcloud auth)
gcloud run services describe prep-portal-api \
  --region us-central1 --project se-singha-paathi \
  --format 'value(spec.template.spec.containers[0].env)' \
  | grep FIREBASE_PROJECT_ID
# Expected: FIREBASE_PROJECT_ID=se-singha-paathi (or name/value pair containing it)

# 3. wrangler.toml (local repo)
grep FIREBASE_PROJECT_ID /root/lionpath_V2/worker/wrangler.toml
# Currently: FIREBASE_PROJECT_ID = "" (EMPTY — will be fixed in this workstream)
```

If ANY target shows empty/unset: STOP. Fix that target's config first, verify the
worker boots and serves /api/config with a valid auth response, THEN proceed.

#### 1b. FILE: worker/src/node-server.ts — add boot guard in buildEnv()

The hard-fail goes in buildEnv() because buildEnv() runs once at module load (line 113:
`const env = buildEnv();`) before the HTTP server starts listening. If it throws, the
process exits with a stack trace and the Docker healthcheck never passes.

In buildEnv(), AFTER the `const env: NodeEnv = { ... }` object is constructed (after line 72,
before the historyDir check on line 74), insert:

```typescript
  // --- P0 SECURITY: hard-fail boot if Firebase auth is not configured in production.
  // When FIREBASE_PROJECT_ID is empty, requireUser() returns null (not an error),
  // silently trusting client-claimed identity. This is acceptable ONLY for local dev.
  const isProduction = (process.env.NODE_ENV || "").toLowerCase() === "production";
  const firebaseProjectId = (env.FIREBASE_PROJECT_ID || "").trim();
  if (isProduction && !firebaseProjectId) {
    const msg =
      "[worker] FATAL: FIREBASE_PROJECT_ID is not set in a production environment (NODE_ENV=production). " +
      "Set FIREBASE_PROJECT_ID=se-singha-paathi in deploy/vps/.env or Cloud Run --set-env-vars, " +
      "or run with NODE_ENV unset for local dev. Refusing to boot — dummy auth is a " +
      "security hole in production (client-claimed identity is trusted without verification).";
    console.error(msg);
    throw new Error(msg);
  }
```

This is placed AFTER `const env = buildEnv()` returns (line 113), but the check is inside
buildEnv before the return. So the exact insertion point is between line 72 (closing `};`
of the env object) and line 74 (`const historyDir = ...`).

EXACT patch:

old_string (node-server.ts, lines 72-74):
```
  };

  const historyDir = (process.env.HISTORY_FILE_DIR || "").trim();
```

new_string:
```
  };

  // --- P0 SECURITY: hard-fail boot if Firebase auth is not configured in production.
  // When FIREBASE_PROJECT_ID is empty, requireUser() returns null (not an error),
  // silently trusting client-claimed identity. This is acceptable ONLY for local dev.
  {
    const isProduction = (process.env.NODE_ENV || "").toLowerCase() === "production";
    const firebaseProjectId = (env.FIREBASE_PROJECT_ID || "").trim();
    if (isProduction && !firebaseProjectId) {
      const msg =
        "[worker] FATAL: FIREBASE_PROJECT_ID is not set in a production environment (NODE_ENV=production). " +
        "Set FIREBASE_PROJECT_ID=se-singha-paathi in deploy/vps/.env or Cloud Run --set-env-vars, " +
        "or run with NODE_ENV unset for local dev. Refusing to boot — dummy auth is a " +
        "security hole in production (client-claimed identity is trusted without verification).";
      console.error(msg);
      throw new Error(msg);
    }
  }

  const historyDir = (process.env.HISTORY_FILE_DIR || "").trim();
```

NOTE: The block is wrapped in `{ }` to create a scope so the `const` declarations
(`isProduction`, `firebaseProjectId`) don't collide with anything else in buildEnv().

#### 1c. FILE: worker/src/auth.ts — add defence-in-depth guard in requireUser()

The boot guard in node-server.ts covers the Node/Docker path (VPS + Cloud Run).
The Cloudflare Worker path (index.ts) receives `env` from the CF runtime, NOT from
buildEnv(). As a defence-in-depth measure, add a runtime warning to requireUser() so
that even on the CF Worker path, dummy mode is explicitly logged as a security warning.

In requireUser(), BEFORE the `if (!env.FIREBASE_PROJECT_ID) return null;` line (line 72),
insert a console.warn:

old_string (auth.ts, line 71-72):
```
export async function requireUser(request: Request, env: Env): Promise<VerifiedUser | null> {
  if (!env.FIREBASE_PROJECT_ID) return null;
```

new_string:
```
export async function requireUser(request: Request, env: Env): Promise<VerifiedUser | null> {
  if (!env.FIREBASE_PROJECT_ID) {
    // P0 SECURITY: dummy auth mode — client-claimed identity is trusted without
    // Firebase token verification. This is only acceptable for local development.
    // The boot guard in node-server.ts hard-fails if NODE_ENV=production.
    console.warn(
      "[auth] DUMMY MODE ACTIVE: FIREBASE_PROJECT_ID is not set. " +
        "Client-claimed identity is trusted without verification. " +
        "Do NOT use in production.",
    );
    return null;
  }
```

This does NOT change behavior (still returns null), but it ensures every request in dummy
mode produces a visible warning in logs — making it impossible to accidentally run dummy
mode in production without seeing warnings flood the logs.

#### 1d. FILE: worker/src/auth.ts — tighten isDemoManagerEmail() logging

The isDemoManagerEmail() function itself is only callable when FIREBASE_PROJECT_ID is
unset (the caller checks `if (env.FIREBASE_PROJECT_ID) return target;` before calling it).
With the boot guard, this path is unreachable in production. No code change needed to the
regex itself — the boot guard eliminates the attack surface. But add a comment for clarity:

old_string (auth.ts, lines 108-111):
```
function isDemoManagerEmail(email: string): boolean {
  const e = normalizeHistoryEmail(email);
  return e.startsWith("manager@") || /^ajay\.|^antony\.|^vipin\./.test(e.split("@")[0] || "");
}
```

new_string:
```
/**
 * Demo-mode-only manager check. Only reachable when FIREBASE_PROJECT_ID is unset
 * (dummy auth mode). The boot guard in node-server.ts (buildEnv) hard-fails if
 * NODE_ENV=production and FIREBASE_PROJECT_ID is empty, so this code path is
 * unreachable in production. Kept for local dev convenience.
 */
function isDemoManagerEmail(email: string): boolean {
  const e = normalizeHistoryEmail(email);
  return e.startsWith("manager@") || /^ajay\.|^antony\.|^vipin\./.test(e.split("@")[0] || "");
}
```

#### 1e. FILE: worker/scripts/test-node-boot.mjs — add FIREBASE_PROJECT_ID to test env

The smoke test sets `GEMINI_API_KEY: "test-key"` but does NOT set FIREBASE_PROJECT_ID or
NODE_ENV. With the boot guard, this test would still pass (NODE_ENV is unset = not
production). But to make the test explicit and avoid future confusion, set both:

old_string (test-node-boot.mjs, line 13):
```
  env: { ...process.env, GEMINI_API_KEY: "test-key", HOST: "127.0.0.1", PORT: "18788" },
```

new_string:
```
  env: { ...process.env, GEMINI_API_KEY: "test-key", HOST: "127.0.0.1", PORT: "18788", FIREBASE_PROJECT_ID: "", NODE_ENV: "development" },
```

This explicitly sets dummy mode for the smoke test. NODE_ENV=development ensures the boot
guard does NOT fire. FIREBASE_PROJECT_ID="" is the dummy-mode trigger.

#### 1f. FILE: worker/wrangler.toml — set FIREBASE_PROJECT_ID for CF Worker path

Currently `FIREBASE_PROJECT_ID = ""` (line 29). If anyone deploys the CF Worker path in
production with this empty, dummy auth is active. Set it to the production project:

old_string (wrangler.toml, line 29):
```
FIREBASE_PROJECT_ID = ""
```

new_string:
```
FIREBASE_PROJECT_ID = "se-singha-paathi"
```

This ensures the CF Worker entry point (if ever deployed) defaults to real auth.
Local dev uses `wrangler dev` which reads `.dev.vars` (where FIREBASE_PROJECT_ID can be
empty for demo mode) — the toml value is overridden by `.dev.vars` in local dev, OR
developers can set NODE_ENV=development in their local environment.

IMPORTANT: Note that `wrangler dev` does NOT set NODE_ENV=production, so the boot guard
won't fire even if FIREBASE_PROJECT_ID is empty in local dev. The toml change is a
defence-in-depth default for the deploy path.

#### 1g. Verification steps for Item 1

```bash
# 1. Typecheck
cd /root/lionpath_V2/worker && npx tsc --noEmit

# 2. Boot smoke test (must pass — tests dummy mode explicitly)
cd /root/lionpath_V2/worker && node scripts/test-node-boot.mjs
# Expected: "OK — worker boot smoke test passed"

# 3. Verify boot guard fires in production mode with missing FIREBASE_PROJECT_ID:
cd /root/lionpath_V2/worker
NODE_ENV=production FIREBASE_PROJECT_ID="" GEMINI_API_KEY=test npx tsx -e "
  try { require('./src/node-server.ts'); } catch(e) { console.log('GUARD FIRED:', e.message.slice(0,80)); process.exit(0); }
" 2>&1 | head -5
# Expected: "GUARD FIRED: [worker] FATAL: FIREBASE_PROJECT_ID is not set..."

# 4. Verify boot guard DOES NOT fire in production mode WITH FIREBASE_PROJECT_ID set:
cd /root/lionpath_V2/worker
NODE_ENV=production FIREBASE_PROJECT_ID=se-singha-paathi GEMINI_API_KEY=test \
  timeout 5 npx tsx src/node-server.ts 2>&1 | grep -i "listening\|FATAL" | head -2
# Expected: "SE Paathai worker listening" (boots OK, then timeout kills it)

# 5. Verify boot guard DOES NOT fire in dev mode without FIREBASE_PROJECT_ID:
cd /root/lionpath_V2/worker
GEMINI_API_KEY=test FIREBASE_PROJECT_ID="" \
  timeout 5 npx tsx src/node-server.ts 2>&1 | grep -i "listening\|FATAL\|DUMMY" | head -3
# Expected: "listening" + "DUMMY MODE ACTIVE" warning

# 6. Run full worker test suite (catches any import/route breakage)
cd /root/lionpath_V2/worker && npm test 2>&1 | tail -5
```

#### 1h. Commit message for Item 1

```
fix(P0): hard-fail worker boot when FIREBASE_PROJECT_ID unset in production

requireUser() returned null (not an error) when FIREBASE_PROJECT_ID was
unset, silently trusting client-claimed identity. Now buildEnv() in
node-server.ts throws on boot if NODE_ENV=production AND
FIREBASE_PROJECT_ID is empty — making it impossible to accidentally
ship dummy auth to a real deploy. Local dev (NODE_ENV unset/development)
is unaffected.

Defence-in-depth: requireUser() now logs a prominent DUMMY MODE warning
on every request when Firebase auth is not configured. wrangler.toml
default updated to se-singha-paathi so the CF Worker path defaults to
real auth. isDemoManagerEmail() documented as local-dev-only (unreachable
in production with the boot guard).
```

---

### ITEM 2 — centralize secrets: inventory + drift-check (WORKSTREAM B)

#### 2a. FILE (NEW): docs/SECRETS_INVENTORY.md

Create this file with the following content:

```markdown
# Secrets Inventory — SE Singha Paathai

**Last updated:** 2026-08-08
**Owner:** Security architect

## Current state

Secrets are spread across THREE unsynced locations. No centralized secret manager
is in use (except for firebase-config-local on Cloud Run builds).

## Inventory table

| Secret | VPS (.env) | Cloud Run (--set-env-vars) | Cloudflare (wrangler.toml / wrangler secret) | Notes |
|--------|-----------|---------------------------|----------------------------------------------|-------|
| GEMINI_API_KEY | .env (plaintext) | NOT set (uses Vertex AI via service account ADC) | wrangler secret put | Cloud Run uses Vertex (no key needed). Batch API still needs AI Studio key. |
| FIREBASE_PROJECT_ID | .env (plaintext) | --set-env-vars | wrangler.toml [vars] | SET on all targets (se-singha-paathi). |
| FIREBASE_SERVICE_ACCOUNT_JSON | .env (optional) | NOT set | wrangler secret (optional) | For Firestore admin reads on VPS. Cloud Run uses ADC. |
| ALLOWED_EMAIL_DOMAIN | .env | --set-env-vars | wrangler.toml [vars] | Non-secret config (freshworks.com). |
| ALLOWED_ORIGINS | .env | --set-env-vars | wrangler.toml [vars] | Non-secret config. |
| INTERNAL_CRON_SECRET | .env (commented out in example) | Secret Manager (documented, dormant) | N/A | Cloud Scheduler cron auth. Currently dormant. |
| FRESHDESK_API_KEY | .env (plaintext, committed in .env.example!) | NOT set | N/A | HARDCODED in .env.example — should be removed from the example file. |
| FRESHDESK_DOMAIN | .env | NOT set | N/A | Non-secret (janus.freshdesk.com). |
| ANTHROPIC_API_KEY | .env (optional) | optional (Secret Manager) | wrangler secret (optional) | Optional fallback provider. |
| ZOOM_CLIENT_ID | .env (optional) | optional | wrangler.toml [vars] (optional) | Zoom OAuth phase 2. |
| ZOOM_CLIENT_SECRET | .env (optional) | Secret Manager (optional) | wrangler secret put | Zoom OAuth phase 2. |
| ZOOM_REDIRECT_URI | .env (optional) | optional | wrangler.toml [vars] | Non-secret. |
| APOLLO_API_KEY | N/A | N/A | wrangler secret (optional) | Optional enrichment. |
| firebase-config-local | N/A | Secret Manager secret "firebase-config-local" | N/A | Web SSO config. Only secret using Secret Manager today. |
| GOOGLE_CLOUD_PROJECT | N/A | --set-env-vars | N/A | Non-secret (se-singha-paathi). |
| VERTEX_LOCATION | N/A | --set-env-vars | N/A | Non-secret (us-central1). |

## Known issues

1. **FRESHDESK_API_KEY is committed in deploy/vps/.env.example** (line 79:
   `FRESHDESK_API_KEY=<REDACTED>`). This is a real API key committed to the
   repo. ACTION: rotate this key in Freshdesk, replace the .env.example line with a
   placeholder, and update the real VPS .env with the new key. This is a separate
   remediation task — flag it to the team immediately.

2. **No secret rotation policy** — keys have no documented expiry or rotation schedule.

3. **VPS .env is plaintext on disk** at /opt/se-singha-paathai/deploy/vps/.env (chmod 600
   per .env.example). No encryption at rest beyond filesystem permissions.

4. **Cloud Run uses --set-env-vars (plaintext in the gcloud command/revision spec)** for
   most values. Only firebase-config-local uses Secret Manager.

## Recommendations (phased, NOT this session)

### Phase 1 (this session): inventory + drift check
- This document.
- deploy/scripts/check-secrets-drift.sh: compares .env.example keys against Cloud Run
  env vars and wrangler.toml vars to detect drift.

### Phase 2 (ops task, requires gcloud access): Secret Manager migration for Cloud Run
- Move GEMINI_API_KEY, INTERNAL_CRON_SECRET, ANTHROPIC_API_KEY, ZOOM_CLIENT_SECRET to
  Secret Manager.
- Update first-deploy.sh to use --set-secrets instead of --set-env-vars for those keys.
- Grant Cloud Run service account roles/secretmanager.secretAccessor on each secret.
- Test: redeploy, verify /api/config still returns correct provider status.

### Phase 3 (ops task): VPS secret management
- VPS has no Secret Manager equivalent. Options:
  a. Accept .env files with chmod 600 + audit access (current state, documented).
  b. Docker secrets (docker-compose secrets with files mounted at /run/secrets/).
  c. Migrate VPS off Docker Compose to Cloud Run (per FULLSTACK_REVIEW_BRIEF §6 Option C).

### Phase 4 (ops task): rotation policy
- Document rotation cadence for each secret.
- Automate rotation where possible (gcloud secrets rotate).
```

#### 2b. FILE (NEW): deploy/scripts/check-secrets-drift.sh

Create this file with the following content. It does NOT run by default — it is a manual
tool the team runs before deploying to catch config drift:

```bash
#!/usr/bin/env bash
# Secrets drift check — compares env var KEYS across all deploy targets (values are NOT printed).
# Run manually before deploying: bash deploy/scripts/check-secrets-drift.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "=== Secrets drift check (KEYS only, values redacted) ==="
echo ""

# 1. VPS .env.example keys
VPS_KEYS=$(grep -oE '^[A-Z_]+=' "$REPO_ROOT/deploy/vps/.env.example" | sed 's/=//' | sort -u)
echo "--- VPS .env.example keys ---"
echo "$VPS_KEYS"
echo ""

# 2. Cloud Run first-deploy.sh env var keys (extract from --set-env-vars string)
CR_KEYS=$(grep -oE '[A-Z_]+=' "$REPO_ROOT/deploy/cloudrun/first-deploy.sh" | sed 's/=//' | sort -u)
echo "--- Cloud Run first-deploy.sh keys ---"
echo "$CR_KEYS"
echo ""

# 3. wrangler.toml [vars] keys
CF_KEYS=$(grep -oE '^[A-Z_]+ = ' "$REPO_ROOT/worker/wrangler.toml" | sed 's/ = //' | sort -u)
echo "--- Cloudflare wrangler.toml [vars] keys ---"
echo "$CF_KEYS"
echo ""

# 4. Drift report
echo "=== DRIFT REPORT ==="
echo ""
echo "Keys in VPS .env.example but NOT in Cloud Run first-deploy.sh:"
comm -23 <(echo "$VPS_KEYS") <(echo "$CR_KEYS") || true
echo ""
echo "Keys in Cloud Run first-deploy.sh but NOT in VPS .env.example:"
comm -13 <(echo "$VPS_KEYS") <(echo "$CR_KEYS") || true
echo ""
echo "Keys in wrangler.toml but NOT in VPS .env.example:"
comm -13 <(echo "$CF_KEYS") <(echo "$VPS_KEYS") || true
echo ""
echo "Keys in wrangler.toml but NOT in Cloud Run first-deploy.sh:"
comm -13 <(echo "$CF_KEYS") <(echo "$CR_KEYS") || true
echo ""
echo "=== End drift report ==="
echo "Review any unexpected keys above. Secrets should be consistent across targets"
echo "(except where a target genuinely doesn't need a secret, e.g. VPS doesn't need"
echo "GOOGLE_CLOUD_PROJECT since it uses GEMINI_API_KEY instead of Vertex AI)."
```

Make it executable (the Codex agent should run):
```bash
chmod +x deploy/scripts/check-secrets-drift.sh
```

#### 2c. Verification steps for Item 2

```bash
# 1. Drift check runs without error
cd /root/lionpath_V2 && bash deploy/scripts/check-secrets-drift.sh
# Expected: prints key lists + drift report, exits 0

# 2. Verify the FRESHDESK_API_KEY issue is documented
grep "FRESHDESK_API_KEY=P4Xy8" docs/SECRETS_INVENTORY.md
# Expected: match on the "Known issues" section

# 3. Verify no worker source files were changed
cd /root/lionpath_V2 && git diff --name-only | grep -E "worker/src|deploy/vps/Dockerfile|deploy/cloudrun/Dockerfile|deploy/cloudrun/first-deploy" || echo "No running-path files changed — correct"
# Expected: "No running-path files changed — correct"
```

#### 2d. Commit message for Item 2

```
docs(P0): secrets inventory + drift-check script for multi-target deploy

Documents all secrets across VPS .env, Cloud Run --set-env-vars, and
wrangler.toml. Flags FRESHDESK_API_KEY committed in .env.example as
an immediate remediation item. Adds deploy/scripts/check-secrets-drift.sh
for manual pre-deploy config drift detection. No runtime changes —
full Secret Manager migration deferred to a separate ops task.
```

---

### ITEM 3 — data retention policy (WORKSTREAM C)

#### 3a. FILE (NEW): docs/DATA_RETENTION_POLICY.md

Create this file with the following content:

```markdown
# Data Retention Policy — SE Singha Paathai

**Status:** DRAFT — requires legal/team sign-off before any retention code ships.
**Date:** 2026-08-08
**Owner:** Security architect

## Purpose

No retention or deletion policy exists today. All data written to Firestore
(transcripts, contact PII, call analyses, account/deal records) persists
indefinitely with no automated expiry. This document proposes a retention
schedule and the safe implementation path.

IMPORTANT: No data will be deleted until this policy is signed off and
implemented as a separate, tested task. This document is the FIRST step only.

## Data categories and proposed retention

| Data category | Firestore location | Proposed retention | Rationale | Deletion trigger |
|---|---|---|---|---|
| Call transcripts (raw) | postCalls/{id}.transcript | 24 months from call date | Transcripts contain customer PII; 24mo covers coaching cycle + deal cycle. | TTL on createdAt field. |
| Call analysis artifacts (scorecards, summaries, gaps) | postCalls/{id} sub-fields | 24 months from call date | Derivative of transcript — same lifecycle. | Same TTL as parent postCalls doc. |
| Contact PII (name, email, phone, LinkedIn) | contacts/{id} | Tied to account lifecycle | Contacts exist in context of an account/deal; expire with account, not independently. | Cascade delete when account archived + retention period expires. |
| Account records | accounts/{id} | Life of account + 90 days after archival | Active accounts retained indefinitely. Archived accounts kept 90 days for recovery, then soft-deleted. | Manual archive → 90-day retention → delete. |
| Deal records (MEDDPICC, stage, ARR) | deals/{id} | Life of account + 90 days | Deal data is tied to account lifecycle. | Cascade with account. |
| Lifecycle events | lifecycles/{id}/events | Life of account + 90 days | Activity timeline — part of account record. | Cascade with account. |
| Prep briefs | prepBriefs/{id} | 24 months from creation | Derivative research; may contain prospect PII. | TTL on createdAt field. |
| Tasks | tasks/{id} | Life of account + 90 days | Actionable items tied to lifecycle. | Cascade with account. |
| User records | users/{id} | Indefinite (employee data) | Employee directory — managed by admin, not auto-deleted. | Manual admin deletion only. |
| Team/org structure | teams/{id}, orgs/{id} | Indefinite | Org structure — managed by admin. | Manual admin deletion only. |
| Feedback entries | feedback/{id} | 12 months | Internal feedback; contains SE email. | TTL on createdAt field. |
| Legacy history (file-based on VPS) | /var/lib/se-paathai/history/*.json | As above (match new policy) | Legacy storage — migrate to Firestore, then apply same TTLs. | Migration task (separate). |

## Implementation path (phased — NOT this session)

### Phase 1 (this session): policy document + sign-off
- This document.
- Required sign-offs: team lead, legal/compliance (if applicable).

### Phase 2 (after sign-off): Firestore TTL policies
- Firestore native TTL: add a TTL field (e.g. `retentionExpiresAt`) to documents that
  should auto-expire.
- Set TTL policy via Firebase Console or gcloud:
  `gcloud firestore fields ttl update retentionExpiresAt --collection-group postCalls`
- TTL fires after the timestamp passes — documents are permanently deleted.
- CRITICAL: test on a STAGING project first. Verify no premature deletion.

### Phase 3 (after sign-off): scheduled deletion job for account-cascade
- Accounts don't auto-expire independently — they cascade.
- Implement a Cloud Run Job (not Cloud Function) that:
  1. Finds accounts archived > 90 days ago.
  2. Deletes dependent contacts, deals, lifecycles, events, tasks.
  3. Soft-deletes the account doc.
- Run weekly via Cloud Scheduler.
- CRITICAL: dry-run mode for the first 30 days (log what WOULD be deleted, delete nothing).

### Phase 4 (after sign-off): legacy history migration
- Migrate /var/lib/se-paathai/history/*.json to Firestore.
- Apply same TTLs to migrated data.
- Decommission file-based history (remove HISTORY_FILE_DIR from VPS docker-compose).

## What NOT to do

- Do NOT add TTL policies without sign-off. Premature deletion of call transcripts or
  contact PII is an unrecoverable data-loss event.
- Do NOT delete legacy history files — they are the only copy of some older call data.
- Do NOT auto-delete user records — employees may still be active even if their calls
  are old.

## Sign-off

| Role | Name | Date | Status |
|------|------|------|--------|
| Team lead | ____ | ____ | PENDING |
| Legal/compliance | ____ | ____ | PENDING |
| Security architect | ____ | ____ | PENDING |

## Reference

- docs/adr/006-product-insight.md §"Active retention" — proposes 24-month retention for
  product gaps/verbatims, "Legal review required before verbatim export and retention
  defaults ship."
- docs/FULLSTACK_REVIEW_BRIEF.md §2.3 — data layer parallel stores (legacy + Firestore).
```

#### 3b. Verification steps for Item 3

```bash
# 1. Verify the policy file exists and is well-formed markdown
cd /root/lionpath_V2 && head -5 docs/DATA_RETENTION_POLICY.md
# Expected: "# Data Retention Policy — SE Singha Paathai"

# 2. Verify no deletion code or TTL was added
cd /root/lionpath_V2 && git diff --name-only | grep -E "\.ts$|\.js$|\.mjs$|firestore\.rules" || echo "No code files changed — correct"
# Expected: "No code files changed — correct"

# 3. Verify the "NOT to do" section is present
grep -c "Do NOT add TTL policies without sign-off" docs/DATA_RETENTION_POLICY.md
# Expected: 1
```

#### 3c. Commit message for Item 3

```
docs(P0): data retention policy draft — sign-off required before implementation

No retention or deletion policy existed. This draft proposes a 24-month
TTL for call transcripts/analysis, contact PII tied to account lifecycle,
and account archival + 90-day retention before deletion. Explicitly states
NO TTL or deletion code is added — the policy must be signed off first.
Implementation (Firestore TTL + scheduled deletion job) is a separate
task after legal/team approval.
```

---

## 4. DEPLOY SEQUENCE

### Deploy order — nothing breaks if followed in this order

**STEP 0 (PRE-FLIGHT, do before any merge):**
Run the pre-deploy verification from §1a. Confirm FIREBASE_PROJECT_ID is set on:
- VPS: `ssh root@89.58.33.163 "grep FIREBASE_PROJECT_ID /opt/se-singha-paathai/deploy/vps/.env"`
- Cloud Run: `gcloud run services describe prep-portal-api --region us-central1 --project se-singha-paathi --format 'value(spec.template.spec.containers[0].env)' | grep FIREBASE_PROJECT_ID`
- If EITHER is empty/unset: STOP. Fix that target first. The hard-fail WILL crash it.

**STEP 1: Items 2 and 3 (documentation only — deploy FIRST because they cannot break anything)**
- Merge to branch 2.1, push to origin (antonyanbu25/lionpath_V2).
- VPS: `cd /opt/se-singha-paathai/deploy/vps && bash upgrade-now.sh` — pulls the code
  (documentation files are harmless to the running app).
- Cloud Run: `gcloud builds submit . --config deploy/cloudrun/cloudbuild.yaml --project se-singha-paathi`
  then redeploy — or skip the redeploy entirely (docs don't affect the container).
- Verification: `bash deploy/scripts/check-secrets-drift.sh` runs clean. Done.

**STEP 2: Item 1 (dummy-auth hard-fail — deploy AFTER pre-flight verification passes)**
- Merge to branch 2.1, push to origin.
- VPS deploy:
  ```bash
  ssh root@89.58.33.163
  cd /opt/se-singha-paathai/deploy/vps
  # BEFORE running upgrade-now.sh, verify .env has FIREBASE_PROJECT_ID:
  grep FIREBASE_PROJECT_ID .env
  # Expected: FIREBASE_PROJECT_ID=se-singha-paathi (non-empty)
  # If empty: echo 'FIREBASE_PROJECT_ID=se-singha-paathi' >> .env (append or edit with nano)
  # THEN deploy:
  bash upgrade-now.sh
  # Verify the worker booted:
  curl -sf http://127.0.0.1:8787/api/config | head -c 100
  # Expected: JSON response with prep/postcall config (not a 502 or connection refused)
  ```
- Cloud Run deploy:
  ```bash
  gcloud builds submit . --config deploy/cloudrun/cloudbuild.yaml --project se-singha-paathi
  # Redeploy using first-deploy.sh OR manually:
  gcloud run deploy prep-portal-api \
    --image us-central1-docker.pkg.dev/se-singha-paathi/prep-portal/prep-portal-api:latest \
    --region us-central1 --project se-singha-paathi
  # Verify:
  curl -sf https://prep-portal-api-781846715448.us-central1.run.app/api/config | head -c 100
  # Expected: JSON response (not 502)
  ```

### Rollback if Item 1 breaks something

**VPS rollback:**
```bash
ssh root@89.58.33.163
cd /opt/se-singha-paathai
git log --oneline -5  # find the commit BEFORE the hard-fail
git reset --hard <previous-commit>
cd deploy/vps && bash update.sh
# OR if the container is crash-looping and you can't wait for a rebuild:
# Remove the hard-fail by setting FIREBASE_PROJECT_ID if it was missing:
echo 'FIREBASE_PROJECT_ID=se-singha-paathi' >> /opt/se-singha-paathai/deploy/vps/.env
cd deploy/vps && docker compose restart worker
```

**Cloud Run rollback:**
```bash
# Cloud Run keeps revision history — point traffic at the previous revision:
gcloud run services describe prep-portal-api --region us-central1 --project se-singha-paathi \
  --format='value(status.traffic)'
# Find the previous revision URL, then:
gcloud run services update-traffic prep-portal-api \
  --to-revisions <previous-revision>=100 \
  --region us-central1 --project se-singha-paathi
# OR if the env var was missing:
gcloud run services update prep-portal-api \
  --region us-central1 --project se-singha-paathi \
  --set-env-vars "FIREBASE_PROJECT_ID=se-singha-paathi"
```

**Emergency nuclear option (both targets):** Revert commit on branch 2.1, push, re-run
upgrade-now.sh (VPS) and gcloud builds submit (Cloud Run). The hard-fail is a ~15-line
block in node-server.ts buildEnv() — removing it restores the old behavior instantly.

---

## SUMMARY TABLE (for quick reference, not for terminal display — uses plain text)

Item 1 (dummy-auth hard-fail):
- Risk: MEDIUM (can crash boot if env var missing). Guard: pre-flight check + NODE_ENV gate.
- Files: node-server.ts, auth.ts, test-node-boot.mjs, wrangler.toml (4 files, all Workstream A).
- Deploy: AFTER Items 2/3. Rollback: git revert + redeploy, or set env var + restart.

Item 2 (secrets inventory):
- Risk: ZERO (new docs + new script only, no runtime changes).
- Files: SECRETS_INVENTORY.md, check-secrets-drift.sh (2 new files, all Workstream B).
- Deploy: FIRST (cannot break anything). Rollback: N/A (delete docs).

Item 3 (data retention policy):
- Risk: ZERO (new doc only, no code changes, no TTL, no deletions).
- Files: DATA_RETENTION_POLICY.md (1 new file, all Workstream C).
- Deploy: FIRST (cannot break anything). Rollback: N/A (delete doc).
