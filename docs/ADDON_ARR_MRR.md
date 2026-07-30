# Addendum 3 — MRR alongside ARR

Amends `ADDON_ARR.md`, `ADDON_ARR_VOLUME.md` and tasks 2.5, 2.6, 2.7, 2.8, 3.7.

---

## 1. The rule

**ARR is canonical and stored. MRR is derived at render as `ARR ÷ 12`.**

Never store both as independent fields. They will drift the first time someone edits one, and
reconciling two sources of truth for the same money is a bug you will chase for months.

Everywhere a monetary figure appears, show both.

## 2. Seats recur. Consumption does not.

Per-seat lines are genuinely monthly — `$79/agent/month` *is* the MRR rate, and ARR is that × 12.
Clean in both directions.

Consumption lines are not. AI Agent sessions are bought in packs of 100 at $49, the 500-session
allowance lands once per account, and actual monthly spend is lumpy. Dividing by 12 gives a
**normalised** monthly figure, not a bill anyone will receive.

That distinction is worth surfacing, not hiding:

| | MRR | ARR |
|---|---|---|
| Base — 40 agents Omni Pro | $3,160 | $37,920 |
| Copilot — 14 seats | $406 | $4,872 |
| **Recurring subtotal** | **$3,566** | **$42,792** |
| AI sessions — normalised | $2,920 | $35,035 |
| **Total** | **$6,486** | **$77,827** |

"$3,566 committed recurring plus $2,920 usage-normalised" tells a deal review something the
blended number can't. Same total, more signal.

## 3. Amend task 2.5 — compute

```
Add to worker/src/arr/compute.ts. ARR remains the computed and stored value throughout.

  mrr(arr)                    = arr / 12
  recurringMrr(lines)         = sum(line.annualValue) / 12  over lines where recurring:true
  consumptionMrr(lines)       = sum(line.annualValue) / 12  over lines where recurring:false

Add `recurring: boolean` to arr_lines. True for per-seat units (agent_month, user_month),
false for consumption units (per_100_sessions, per_5000_tasks, per_pass, per_500_units).

ROUNDING. Always compute MRR from ARR, then round for display. Never round MRR and multiply back
— $6,485.58 × 12 is $77,826.96, and a deal record showing a total that doesn't match the sum of
its lines will be reported as a bug every single time.

Do NOT add mrr* columns to the Deal. Storage stays exactly as spec §7.7 defines it —
arrEstimateLow, arrEstimateHigh, arrEstimatePoint, arrActual, arrSource, arrPriceBookVersion,
arrInputsJson, arrComputedAt. MRR is a render-time function of arrEstimatePoint.
```

## 4. Display, everywhere

```
DEAL RECORD (2.6) — ARR module header shows both, ARR primary:
    $77,827 ARR  ·  $6,486 MRR
  Each line row shows both. The recurring/consumption subtotals from §2 appear above the total.

DEALS LIST (2.7) — two columns, both sortable. ARR default.

ACCOUNT RECORD (2.8) — both on the total, both in the add-on attach matrix.

PIPELINE REVIEW (3.7) — both columns. ARR remains the default descending sort.

PRODUCT SIGNAL (3.4) — gap clusters show ARR touched. Add MRR touched beside it.

CALL RECORD (1.8) — arrSnapshot displays both.

SORT ORDER IS IDENTICAL. MRR is ARR ÷ 12, so any ordering by one is the same ordering by the
other. Offer both as sort columns because people think in different units, but do not expect or
implement different rankings.
```

## 5. Amend task 2.5 §5 — the SE input surface

```
Add a unit toggle to the ARR module: ARR | MRR. It switches every figure in the panel, including
the editable fields.

Editing in either unit is allowed. An MRR edit is converted to ARR immediately and ARR is what gets
stored. The override log always records the ARR value, with the unit the SE typed in noted
alongside — so "SE entered 3,200 MRR" and "SE entered 38,400 ARR" are distinguishable in the log
even though they store the same number.

Toggle state is a user preference, not a deal property. An SE who thinks in MRR should not flip it
on every deal they open.
```

## 6. Two things to be careful of

```
MONTHLY-TERM DEALS. Freshworks charges roughly 20% more for monthly billing. A monthly-term deal's
real MRR is NOT its annual-term ARR ÷ 12 — it is the monthly price row × seats. The price book
already carries `term`, so look up the correct row rather than dividing. Until monthly rows are
seeded (see PRICE_BOOK_SEED.md §6), a monthly-term deal should fail loudly with
reason "no_monthly_price_row", not silently divide the annual figure.

THE ALLOWANCE. The 500 free sessions land once per account, not evenly across twelve months.
Spreading that benefit across the year is the correct normalisation for comparison purposes, but
it means month one's real bill differs from the displayed MRR. Note it in the derivation panel;
do not try to model it.
```

## 7. Unit tests

```
19. Per-seat both directions
    40 agents Omni Pro → MRR 3,160 · ARR 37,920 · mrr × 12 === arr exactly

20. Recurring vs consumption split
    Full deal → recurringMrr 3,566 · consumptionMrr 2,919.58 · totalMrr 6,485.58
    recurringArr 42,792 · consumptionArr 35,035 · totalArr 77,827

21. Rounding integrity
    Displayed MRR rounds to 6,486. Stored ARR stays 77,827. Sum of displayed line ARRs
    equals the displayed total ARR — no drift from MRR rounding.

22. Monthly term with no price row
    Returns null, reason "no_monthly_price_row". Does not divide the annual figure.

23. Sort equivalence
    A list sorted by MRR descending returns the identical order as sorted by ARR descending.
```
