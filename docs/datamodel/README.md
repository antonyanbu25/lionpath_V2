# Janus data model — NoSQL → PostgreSQL

**A database migration, not a data migration.** Postgres starts empty (D6); nothing is copied
out of Firestore. The goal is a SQL model in which every piece of functionality the code already
implements has a column to live in.

## Read in this order

| # | Document | What it is |
|---|---|---|
| 0 | [RUN_LOG.md](./RUN_LOG.md) | **What has actually been run against the real database, and what it returned.** Appended after every run. |
| 1 | [BUILD_PLAN.md](./BUILD_PLAN.md) | **Start here.** What is being built, the migration map, the two structural changes, and what still gates it. Also §2, where the source audits are corrected against the branch. |
| 2 | [FIELD_MAP.md](./FIELD_MAP.md) | Firestore field → SQL column, for every table the reshape touches. The answer to "where does this field live now". |
| 3 | [DECISIONS_LOG.md](./DECISIONS_LOG.md) | Authoritative. D1–D27. Where anything else contradicts this, this wins. |
| 4 | [BRANCH_REAUDIT_AND_ACCEPTANCE_TESTS.md](./BRANCH_REAUDIT_AND_ACCEPTANCE_TESTS.md) | The audit of record, and the source of AT-1…AT-5. |
| 5 | [IDENTITY_FIELD_PASS.md](./IDENTITY_FIELD_PASS.md) | Field-by-field pass over the identity tables. |

## What is in the repo

```
janus/schema/21..29_*.sql              the migrations (00–20 untouched)
janus/scripts/load-rubric-catalog.mjs  the only write path for scoring profiles (D17)
janus/tests/acceptance/                AT-1..AT-5, runnable
```

## ⚠️ DB build requires testing in staging

**Nothing here has been applied to any database.** No migration has been executed, no rubric row
has been written, and **not one acceptance test has ever run against a live schema.** The SQL is
structurally linted and all cross-file references resolve, but *written* is not *verified*.

Before this is relied on, on a **staging** instance:

1. Apply `00`–`29` and confirm every file reports `ok`.
2. Run the loader and confirm **19 profiles → 270 themes → 1350 sub-parameters**.
3. Run the acceptance suite as `janus_app` and read every `[FAIL]` and `[APP ]` line.
4. Re-run the apply script a second time — idempotency is written in but untested.

Do not point this at production, and do not flip `PERSISTENCE_MODE` until 1–4 pass. Several
migrations deliberately `RAISE EXCEPTION` on rows that predate the reshape; on a clean staging
database that path never fires, so it is untested too.

## Running it

In order:

```bash
node worker/scripts/apply-janus-schema.mjs --dry-run
```

```bash
node worker/scripts/apply-janus-schema.mjs
```

```bash
node janus/scripts/load-rubric-catalog.mjs --dry-run
```

```bash
node janus/scripts/load-rubric-catalog.mjs
```

```bash
node janus/tests/acceptance/run_acceptance.mjs
```

The loader must run before the tests: `scorecard.rubric_id` is a `NOT NULL` foreign key, so no
score can be saved until the 19 profiles exist as rows.

## Two numbers worth knowing

**19 profiles → 270 themes → 1350 sub-parameters.** The call-type × motion matrix is sparse —
19 valid combinations out of 24 — and that sparseness is enforced by the `rubric` table, not by
CHECK constraints. See [BUILD_PLAN.md §4.2](./BUILD_PLAN.md).

**Only 2 of the 19 are live.** `demo`/new_business and `discovery`/new_business. The other 17,
including every expansion profile, are `provisional` — shadow mode, deliberately out of
aggregates (D25). Day-one ranking therefore covers two call types in one motion until
calibration promotes more.
