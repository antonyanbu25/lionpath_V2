# Branch note — QIP human calibration + discovery N/A

**Branch:** `feat/qip-human-calibration-discovery-na`
**Repo:** [Antony-sagayaraj/SE-Labs](https://github.com/Antony-sagayaraj/SE-Labs)
**Audience:** SE Labs reviewers (directors, SEs, implementers)
**Date:** 2026-09-03

This branch is the Lionpath working tree from the 2026-09 session: scorecards that match how humans actually score, plus the rest of the WIP that was sitting uncommitted (SQL cutover, se-motion, identity merge, Zoom messaging). Existing analyzed calls **do not** pick up the new scoring rules until they are **re-analysed**.

The spec-level QIP math still lives in [QIP_SCORING_V2_1.md](./QIP_SCORING_V2_1.md). This note is the product changelog for the branch.

---

## What changed for scoring

### Three QIP passes (score → verifier → golden set)

Every post-call scorecard now runs three LLM passes, in order:

| Pass | Module | Job |
|------|--------|-----|
| 1. Score | `worker/src/postcall/scorecard.ts` | First 0/1/2 per sub-parameter from the transcript + profile |
| 2. Verifier | `worker/src/postcall/scorecard-verify.ts` | Evidence check; gates `leadershipShareable` |
| 3. Golden set | `worker/src/postcall/scorecard-calibrate.ts` | Recalibrate every scorable QIP sub-parameter to the **human** bar |

Pass 3 is **not** a lookup of “this call equals Shamron’s demo.” It is a calibration pass: the model sees the human-scored examples **and** the distilled rules, then raises, lowers, or keeps each current 0/1/2. Quality Coach stays with the verifier; the golden pass only touches QIP lines.

**Flag:** `SCORECARD_GOLDEN_PASS` (default **on**). Set `0` / `false` / `off` in `worker/.dev.vars`, VPS env, or Wrangler to skip pass 3. See `worker/.dev.vars.example` and `deploy/vps/.env.example`.

Seed examples today: two hunting (new-business) demos (Shamron, Nitish) and three expansion calls (Pradeep plan-upgrade, Hussain AI vision, Nitish discovery). Discovery scoring uses **rules only** until discovery rows are added to the golden set — it must not inherit hunting-demo tables.

### How to add golden calls

1. Score the call on the team sheet (theme-level 0 / 1 / 2, not five sub-parameters).
2. Export:

   ```bash
   python3 tools/import-qip-golden-xlsx.py /path/to/sheet.xlsx \
     --motion new_business --source nb_eu_scoring_sheet
   ```

3. Paste the printed objects into `worker/src/postcall/golden-set/examples.ts`.
4. If the new calls teach a **global** bar (not “this one call”), add a rule in `worker/src/postcall/golden-set/rules.ts`.
5. Sanity-check reconstructed overall: `npx tsx worker/scripts/eval-qip-golden.ts`.
6. Unit tests: `npx tsx worker/scripts/test-qip-golden-set.ts` and `npx tsx worker/scripts/test-scorecard-calibrate.ts`.

Hunting = `new_business`. Theme keys must match the product profile for that call type.

### Discovery incident N/A

On **discovery** (new-business and expansion), `objections`, `comp_pitch`, and `case_study` measure **incidents**, not habits:

- If the moment never occurred → `evidenceUnavailable` (UI **N/A**, out of the denominator).
- A **0 stays in the denominator** only when the incident **did** happen and the SE fumbled it.

Deterministic (no extra LLM pass): any sub-parameter > 0 stays scored; all 0s plus quotes that cite pushback / competitor / case study stay a miss; all 0s with no incident evidence → N/A. Re-applied after golden polarization so courtesy 1s that collapse to 0s with no incident quotes become N/A.

Demo and other call types are unchanged: absence is 0 and stays in the denominator.

Implementation: `worker/src/postcall/discovery-incident-applicability.ts`. Spec: [QIP_SCORING_V2_1.md](./QIP_SCORING_V2_1.md) §1 / §3 / §6.

### Storytelling removed from NB discovery

New-business discovery no longer includes `storytelling` (was credit 1). Profile total credits **33 → 32**. Expansion discovery is unchanged on this point.

### Category N/A when every child theme is N/A

If every theme in a category is out of the denominator (`evidenceUnavailable` / omitted / not applicable), the **category** is `null` (UI N/A), not a scored 0. Overall already omits those credits. Stored scorecards that wrote `0` for a fully N/A category are corrected on read.

Code: `scoreCall` in `worker/src/quality-score.ts` / `web/quality-score.js`; `nullUnavailableCategoryScores` in `web/shared/qip-scorecard-normalize.js`. Radar and scorecard headers follow the same rule.

### Re-analyse existing scorecards

Already-saved analyses keep their old numbers until you run **re-analyse**. That is required for:

- Golden-set calibration (pass 3)
- Discovery incident N/A
- Storytelling removal on NB discovery
- Category N/A when all child themes are N/A
- SE motion catalog selection (`new_business` vs `expansion`)

New analyses pick this up automatically (`SCORECARD_GOLDEN_PASS` defaults on).

---

## Identity merge

Post-call confirm was splitting one person into two rows (Kaia typo vs typed email) and sometimes tagging the customer as the SE.

| Bug | Fix |
|-----|-----|
| Kaia **Andirius** vs typed **Andrius** / `andrius.salasevicius@…` | First-name typo merge when one side is first-name-only; last names must still agree if both have them |
| **Matt Newman** vs `matthewn@learnprogroup.com` | Email-local concatenations (`matthewn` / `mattnewman` / `mnewman`) match the spoken name |

Guards stay in place: do not merge `se` with `se@freshworks.com`; do not merge on a one-letter prefix (`An` ≠ Andrius).

`web/identity-merge.js`, tests in `web/scripts/test-identity-merge.mjs` and `worker/scripts/test-postcall-resolve.ts`.

---

## Zoom share-link messaging

Freshworks Zoom `rec/share` links often force a reCAPTCHA the worker cannot solve. The paste path now explains that clearly and points at **Zoom Server-to-Server OAuth** (`ZOOM_ACCOUNT_ID` / `ZOOM_CLIENT_ID` / `ZOOM_CLIENT_SECRET`) or uploading the VTT. Outlook Safe Links / urldefense wrappers are unwrapped before parse. Placeholders live in `worker/.dev.vars.example` — not real secrets.

---

## Also on this branch (not scoring, still real)

Do not review this as a scoring-only PR. The same working tree includes:

- **Firestore → Postgres wiring** — dual-write / read repository, history + tasks PG backends, schema phases `19_se_motion.sql` and `20_history_tasks_feedback.sql`, migration preflight / export / backfill scripts, [SQL_AGENT_VERIFICATION.md](./SQL_AGENT_VERIFICATION.md), cutover plans under `docs/plans/`. Default read/write remains Firestore until `PERSISTENCE_MODE` is flipped.
- **SE motion** — QIP catalogs keyed by `(callType, seMotion)`. `post_call.se_motion` / `scorecard.se_motion` are SQL columns; deal type stays CRM routing. Defaulted from the acting SE’s team.
- **Staging host** — `staging.benjaminsquare.com` → `staging-api.benjaminsquare.com` in shipped Firebase web config (client config, not a secret).
- Tests and UI polish across post-call, QIP radar, coach, dashboard, call view.

Plans in `docs/plans/2026-09-02-*` are the session’s migration/audit notes; they are included so the branch is complete.

---

## How to verify

```bash
# Web scoring / identity
cd web && npm test

# Worker QIP + discovery + golden set (subset)
cd worker
npx tsx scripts/test-qip-golden-set.ts
npx tsx scripts/test-scorecard-calibrate.ts
npx tsx scripts/test-postcall-scorecard.ts
npx tsx scripts/test-quality-score.ts
npx tsx scripts/test-postcall-resolve.ts
npx tsx scripts/eval-qip-golden.ts
```

Live Gemini is not required for the unit tests above. End-to-end: analyse a new discovery with no objections and confirm those three themes are N/A; re-analyse an old hunting demo and confirm pass 3 ran (`goldenCalibrated` on the scorecard).

---

## Secrets

Not committed: `worker/.dev.vars`, `deploy/vps/.env`, `web/firebase-config.local.js`, `credentials.json`, service-account JSON. Example env files only have placeholders (`YOUR_PASSWORD`, commented Zoom keys).
