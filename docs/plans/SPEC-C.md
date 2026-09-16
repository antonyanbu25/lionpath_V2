# LANE C SPEC — Prep-save data-loss fix (P0, staging pre-calls are losing data)

## Symptom (verified live, 2026-09-07 16:48 IST)
User made a pre-call in staging. 17 AI passes ran and are logged in ai_run with cost, but the brief was NEVER persisted: zero rows in pre_call, zero activity rows, zero prepBriefs in Firestore, and nothing in the history blob. Silent — no error reached the user, and sql_fallback_log has NO createPrepBrief rows today.

## Root causes (verified in code by Gideon — do not re-derive, but DO verify each before fixing)

### Root cause 1 — silent skip on missing companyDomain
`worker/src/routes.ts` function `tryPrepSynthesizeSqlWrite` (line ~2953), line ~2965:
```ts
const companyDomain = nullableString(input.companyDomain);
if (!companyDomain) return;
```
If the client does not send `companyDomain`, the ENTIRE server-side prep write silently returns. No log, no fallback entry, nothing. The prep brief is then Firestore-only via the client, and the client-side createPrepBrief dual-write "short-circuits" (see comment at line ~2941) so NOTHING lands anywhere when the client also skips it.

FIX: do NOT return when companyDomain is missing. Instead:
- If input.accountId is present → use it (current behavior).
- Else if companyDomain present → deterministic placeholder `acct_synth_<domainSlug>` (current behavior).
- Else if companyName present → placeholder `acct_synth_<slugified companyName>` and provision with name = companyName.
- Else → use a generic placeholder keyed on the synthesize request identity (e.g. `acct_synth_unknown` with name "Unknown Company") — still write the brief. Losing the brief is worse than a generic account.
- Log a console.warn whenever a non-explicit account id is derived, so future forensics can see it.

### Root cause 2 — SE-role updateAccount denials (115 today, ~every 17s)
`worker/src/routes.ts` `canWriteUnscopedResource` (line ~1705): for `update`, only admin/manager pass. SE-role updateAccount falls through to Firestore — but staging is SQL-mode read-primary, so those writes are effectively lost, and any flow that awaits them (account SE-team denorm refresh) hammers the API every ~17 seconds, flooding sql_fallback_log (307 rows since Sep 4).

Fix (minimal, correct):
- In `canWriteUnscopedResource`, allow SE `update` ONLY when the SQL session can prove write access to that account via RLS: run the same check the RLS policy uses — `SELECT account_writable_by_current_user($1)` — for the specific account being written. If true → allow (the RLS policy `account_se_team_owner_write` will still guard the actual write). If the account does not exist yet → allow create (INSERT policy is `current_user_id() IS NOT NULL OR is_admin()`).
- Implementation: the check needs the account public id; pass `doc.id` into the guard for updateAccount/updateContact. If doc.id is missing, keep current behavior (deny for SE update).
- This kills the Firestore fallthrough for accounts the SE legitimately can write (the RLS policy already encodes the team logic: member of account_se_team OR no mapping exists).

### Root cause 3 — client-side short-circuit drops the brief entirely
Read `web/domain/dual-write.js` (search for the prep brief / createPrepBrief short-circuit noted in worker/src/routes.ts line ~2941 comment) and `web/app.js` savePrep (line ~2192): the client writes the brief to Firestore `preps` collection and skips the domain-write when Firebase is enabled. In SQL-mode staging, Firestore is NOT the read source, so the brief vanishes from the UI history too (blob had 0 prep entries).

Fix (frontend, minimal): in the prep save path, ALWAYS attempt the `createPrepBrief` domain-write (POST /api/domain-write) after synthesize succeeds — even when Firebase is enabled — and keep the Firestore `preps` write as best-effort/secondary (do not make its failure abort the save). The server-side tryPrepSynthesizeSqlWrite (fixed per root cause 1) is the durable path; the client domain-write is belt-and-suspenders. Do not remove the Firestore write; just make its failure non-fatal and make the domain-write unconditional.

## Constraints
- Worktree: /tmp/usage-laneC (branch usage/laneC, already checked out).
- Do NOT touch the usage tables, rollup script, or login tracking (Lane A territory, already merged).
- Do NOT change RLS policies in this lane — the app-layer guard fix is sufficient and safer; account RLS already allows SE inserts.
- Keep tryPrepSynthesizeSqlWrite's contract: never throw to caller, never change the 200.
- `cd worker && npx tsc --noEmit` must be clean (node_modules already installed).
- Add a test: `worker/scripts/test-prep-save-fix.mjs` using npx tsx style like Lane B's test (mock fetch + mock pg client) proving: (a) prep write proceeds when companyDomain missing but accountId present; (b) placeholder account derived from companyName when both missing; (c) SE updateAccount allowed when account_writable_by_current_user returns true (mock), refused otherwise.
- Commit on usage/laneC, do NOT push. Write /tmp/usage-DONE-C.json with {"lane":"C","commit":"<sha>","tests":"<summary>"} when finished.