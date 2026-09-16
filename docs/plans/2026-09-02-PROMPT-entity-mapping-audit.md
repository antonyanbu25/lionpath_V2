# PROMPT — Firestore → Postgres entity mapping audit

> **How to use this file.** Everything below the horizontal rule is the prompt. Paste it into a fresh LLM session that has read access to this repository. The output is a review artifact for a human, not code. Expect a long response — do not accept a short one.

---

## ROLE

You are performing a **database migration audit** on the Janus codebase. Your deliverable is a single exhaustive document that a human engineer will read line by line to certify that the Firestore → Cloud SQL Postgres structural mapping is correct and complete.

## CRITICAL FRAMING — read twice

This is a **database migration**, not a data migration.

- **In scope:** the structural correspondence. Which Firestore collection corresponds to which Postgres table. Which Firestore document field corresponds to which column, with what type and value transformation. Which code path writes and reads each one. What has no correspondence, and why.
- **Out of scope:** moving, copying, backfilling, exporting, or reconciling historical rows. Nobody is migrating documents. Postgres starts empty and accumulates new data. **Do not produce a backfill plan, an export script, a data-parity harness, or row counts as evidence of anything.**
- If you find yourself writing about "existing records", "historical data", or "how many rows", you have drifted out of scope. Stop and re-read this section.

The question you are answering is: **"if we switch the code to Postgres tomorrow, is every entity and every field accounted for, and do we know exactly what we are giving up?"**

## NON-NEGOTIABLE RULES

1. **Every claim needs a `file:line` citation.** No exceptions. A mapping row without a citation is worthless to the reviewer.
2. **Never state something you did not open and read.** Do not infer a column exists because the name is plausible. Do not infer a field maps because the names match. Open the DDL. Open the repository method. Read the actual `INSERT` statement.
3. **A prior audit of this codebase failed by asserting confident, well-formatted claims that turned out to be fabricated** — specifically live database row counts and the existence of rows that did not exist. You will be reviewed against source. Prefer "UNKNOWN — could not verify" over a plausible guess. Marking something UNKNOWN is a correct and valued answer; guessing is a failure.
4. **Do not connect to any database, and do not use row counts as evidence.** The mapping is a property of the schema and the code, not of the data. (Note also that `worker/.dev.vars` points at a disposable local embedded Postgres, not production — any count from it is meaningless.)
5. **Report ambiguity as ambiguity.** Where two readings are defensible, present both and say which evidence would settle it. Do not silently pick one.
6. **Completeness beats brevity.** Enumerate every collection and every table. If output limits force truncation, say so explicitly at the point of truncation and state what remains.

## STEP 1 — Enumerate both sides exhaustively

Do this before any mapping. Report the raw counts you find.

**Firestore side** — union of all of these, deduplicated:

```bash
grep -oE "match /[A-Za-z]+/" firestore.rules | sed 's|match /||;s|/||' | sort -u
node -e 'const j=require("./firestore.indexes.json");console.log([...new Set((j.indexes||[]).map(i=>i.collectionGroup))].sort().join("\n"))'
grep -oE '(upsert|delete)[A-Za-z]+: *"[a-zA-Z]+"' worker/src/routes.ts
grep -rnoE 'collection\(db, *"[a-zA-Z]+"' web/domain/firestore-store.js | sort -u
```

Note: `databases` from `firestore.rules` is a path artifact of `match /databases/{db}/documents`, not a collection. Exclude it and say you did. Watch for case-variant twins (e.g. `postCalls` vs `postcalls`, `prepBriefs` vs `preps`) — report them as separate entries and flag them.

**Postgres side:**

```bash
grep -rhoE "CREATE TABLE (IF NOT EXISTS )?[a-z_]+" janus/schema/*.sql | sed 's/.*EXISTS //;s/CREATE TABLE //' | sort -u
```

Distinguish **logical tables** from **partitions** (e.g. `audit_log_2026_08`, `webhook_event_default` are partitions of `audit_log` / `webhook_event`, not separate entities). The spec `Janus_Data_Model_Final.docx` claims 38 logical tables. Report the number you actually count, and if it differs from 38, reconcile the difference explicitly.

**Deliverable for this step:** two flat lists with counts, plus a note on anything excluded and why.

## STEP 2 — The mapping table (the core deliverable)

One row per Firestore collection. Every collection from Step 1 must appear exactly once. Sort by status, then alphabetically.

| # | Firestore collection | Postgres target | Status | Write path | Read path | Evidence |
|---|---|---|---|---|---|---|

Column definitions — use these exact values:

- **Postgres target** — table name, or `<table>.<column>` for a JSONB destination, or `NONE`.
- **Status** — exactly one of:
  - `MAPPED` — target exists, write path exists, read path exists
  - `WRITE-ONLY` — writes reach Postgres, no Postgres read (data becomes invisible)
  - `READ-ONLY` — Postgres read exists, writes do not reach Postgres (screen stays empty)
  - `TARGET-ONLY` — table exists, neither path wired
  - `NO-TARGET` — no Postgres table or column exists for this
  - `INTENTIONALLY-DROPPED` — deliberately not migrated (say who decided, or mark the decision as missing)
- **Write path** — the function and `file:line` that writes Postgres, or `FIRESTORE ONLY` plus the `file:line` of the Firestore write.
- **Read path** — the repository method and `file:line`, or `NONE`, or `STUB` if it exists but returns a hardcoded empty value.
- **Evidence** — `file:line` for the claim.

Start from these anchors, then verify each independently — they are the routing seams:

- SQL write cases: the `switch` inside `trySqlDomainWrite`, `worker/src/routes.ts`
- Firestore write methods: the `applyDomainWrite` switch, plus the `UPSERT_COLLECTIONS` and `DELETE_COLLECTIONS` maps in the same file
- Postgres reads: `worker/src/data/persistence/read-repository.ts` (**check for `private` methods — several reads exist but are not on the public interface**)
- The read contract: `PersistenceReadPort` in `worker/src/data/persistence/types.ts`
- Browser demand surface: `web/domain/api-store.js`

**Precede the table with a summary count by status**, so the reviewer knows the shape before reading 40 rows.

## STEP 3 — Field-level mapping for every `MAPPED`, `WRITE-ONLY`, and `READ-ONLY` collection

The collection table is not sufficient. A collection can be "mapped" while silently dropping half its fields. For each such collection, produce:

### `<collection>` → `<table>`

| Firestore field | Postgres column | Type change | Transform | Lossy? | Evidence |
|---|---|---|---|---|---|

- **Transform** — one of `DIRECT`, `RENAME`, `VALUE-MAP`, `TYPE-COERCE`, `NESTED-INTO-JSONB`, `SYNTHESIZED`, `DROPPED`.
- For `VALUE-MAP`, give the complete mapping (e.g. `"postcall"|"prep" → "ai_generated"`), and state what happens to an unlisted value.
- **Lossy?** — `YES` if information cannot be recovered from the Postgres row: a dropped field, a narrowed type, a many-to-one value map, a truncated array, a timestamp losing precision. Justify every `YES` in one clause.
- Also list, at the end of each block:
  - **Postgres columns with no Firestore source** — and where the value comes from instead (default, trigger, generated, synthesized in code, or genuinely never populated).
  - **Firestore fields with no Postgres destination** — the silent drops. These matter most to the reviewer.

Read the actual `INSERT`/`UPDATE` statement to build this. Do not infer from the type definitions in `types.ts` — those describe the port's row shape, not what reaches the database.

## STEP 4 — What is NOT mapped, and why

For every `NO-TARGET`, `TARGET-ONLY`, and `INTENTIONALLY-DROPPED` collection, classify the reason using **exactly one** of these codes, and explain in 2–4 sentences:

| Code | Meaning |
|---|---|
| `R1-NO-TABLE` | No Postgres table or column exists anywhere in the schema. Requires a schema change or a decision to retire the feature. |
| `R2-JSONB-FOLD` | The target is a field inside a JSONB column, not a table. Requires a read-modify-write path, not a new table. |
| `R3-VIEW-REPLACED` | Superseded by a read-model view. Should be re-pointed, not reimplemented. |
| `R4-GREEN-FIELD` | The Postgres table exists but has no Firestore source — a new, unbuilt feature. Not a migration item at all. |
| `R5-LEGACY-DEAD` | Duplicate, superseded, or unreferenced collection. Should be deleted, not migrated. Prove it with a caller search. |
| `R6-NOT-WIRED` | Table and mapping both exist; nobody connected the code. Pure wiring work. |
| `R7-UNKNOWN` | You could not determine the answer. State precisely what you checked and what evidence would resolve it. |

For each, also state:

1. **User-visible consequence** if it ships unmapped — name the screen or feature that breaks or silently empties. Be concrete: "the task list renders empty", not "functionality may be affected".
2. **What it would take to map it** — one sentence.
3. **Whether a human decision is required**, and precisely what is being decided.

Group `R4-GREEN-FIELD` separately and clearly. Those are not migration work, and conflating them with real gaps inflates the apparent scope — a prior audit made exactly this mistake.

## STEP 5 — Structural mismatches

Call out, with citations, every place where the two models disagree in **shape** rather than in naming. These are the highest-risk items because they cannot be fixed by a rename. For each: the Firestore shape, the Postgres shape, and what the transformation must do.

Look specifically for, and confirm or refute each:

- Multiple top-level Firestore collections that become **array fields inside one JSONB column**
- Flat Firestore relationships that become a **self-referencing tree with a materialized path**
- A single Firestore string field that becomes **temporal rows** with validity ranges
- Firestore documents split across **two Postgres tables** (a parent row plus a child row)
- Firestore entities **folded into another entity** entirely
- **Enum/CHECK constraints** in Postgres that have no equivalent constraint in Firestore, where an out-of-range Firestore value would be rejected or silently coerced
- JSONB **shape validators** that would reject a field the Firestore document contains

## STEP 6 — Verification checklist for the human reviewer

Produce a numbered list of concrete checks the reviewer can run to falsify your findings — commands or `file:line` references, not advice. The reviewer must be able to spot-check any claim in under a minute. Include at least one check per `MAPPED` collection that would reveal an incorrect mapping.

## KNOWN GROUND TRUTH — do not contradict without citing contrary evidence

These were verified against source in this repo. If your analysis disagrees with any of them, that is interesting and worth reporting — but you must cite the specific `file:line` that contradicts it, not merely assert a different conclusion.

1. The v9.3 Postgres schema is **already fully applied** — `janus/schema/00`–`20`, with RLS enabled and forced on 13 tables (25 policies). This audit is about correspondence and wiring, **not** about designing or creating the schema.
2. **`PERSISTENCE_MODE` is checked before the user session** in `trySqlDomainWrite`. In `firestore` mode, no SQL write path executes at all, regardless of correctness. Every config default in the repo is `firestore`.
3. **`getPostCallDetail` in `read-repository.ts` already projects roughly nine detail arrays** out of `post_call.detail` using an `arrayFromDetail` helper. A read that appears missing may already be served by this bulk call. Check before declaring it unmapped.
4. **Some read methods exist but are declared `private`** and are absent from `PersistenceReadPort`. Those are exposure gaps, not mapping gaps. Classify them accordingly.
5. **At least one read is a hardcoded stub** returning an empty value while a write path populates the table. Find every instance of this pattern — it is the most dangerous category, because both halves look implemented.
6. **`arrLines` and `arrOverrides` are allowed keys in the `post_call.detail` JSONB shape.** Verify before concluding ARR has no Postgres home.
7. **`whatWorks` is NOT an allowed key in the `post_call.detail` v1 shape**, so writing it would be rejected by the shape validator. Verify against `shapes.ts` and report the consequence.
8. **Lifecycles are folded into `deal`** — there is no `lifecycle` table. Confirm and document the fold.
9. Several Firestore write failures **fall back to Firestore silently** with only a `console.warn`, including JSONB shape-validation failures. A write can appear to succeed while landing in the abandoned store. Identify every such gate.
10. Reference data (`app_role`, `rubric`, `rubric_theme`) is seeded **only** by a backfill script, not by the schema DDL. Since no data migration is happening, verify whether anything else seeds it.

## OUTPUT FORMAT

Markdown. Section order exactly as the steps above. Begin with:

1. **Verdict** — three sentences: is the mapping complete enough to switch the code over, yes or no, and the single largest gap.
2. **Summary counts** — total Firestore collections, total Postgres logical tables, and a count per status code.
3. **Confidence statement** — what you verified by reading source, what you could not verify, and what a human must decide.

Then Steps 1–6 in full.

## DO NOT

- Do not produce a data backfill, export, or row-parity plan. This is not data migration.
- Do not recommend creating tables for JSONB sub-shapes. Verify the intended destination first.
- Do not present green-field features as migration gaps.
- Do not cite a row count as evidence of a mapping.
- Do not write an implementation plan, a phase schedule, or effort estimates. Those exist elsewhere. Your job is the mapping and the gaps — the factual substrate a human will review.
- Do not summarize or sample. Every collection appears in the Step 2 table. If you cannot finish, say where you stopped.

## SELF-CHECK BEFORE YOU SUBMIT

Confirm each, in a short closing section:

1. Does every collection from Step 1 appear exactly once in Step 2?
2. Does every non-obvious claim carry a `file:line`?
3. Does every `NO-TARGET` / `TARGET-ONLY` / `INTENTIONALLY-DROPPED` row have a reason code and a named user-visible consequence?
4. Did you open the actual DDL and the actual `INSERT` statements for every field-level table, rather than inferring from type definitions?
5. Is anything in your output stated more confidently than the evidence supports? Downgrade it to `R7-UNKNOWN` now.
6. Did you avoid every item in DO NOT?
