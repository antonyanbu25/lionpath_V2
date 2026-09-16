#!/usr/bin/env -S npx tsx
/**
 * ARR compute unit tests — ADDON_ARR §7 (1–8), ADDON_ARR_VOLUME §7 (9–18),
 * ADDON_ARR_MRR §7 (19–23).
 */

import {
  ADDON_PRICE_BOOK_SEED,
  ASSUMPTIONS_BOOK_SEED,
  PRICE_BOOK_SEED,
  PRICE_BOOK_VERSION,
} from "../src/price-book-seed.ts";
import {
  computeArr,
  displayMrr,
  mrrFromArr,
  normaliseConversationVolume,
  type ArrComputeInput,
  type ArrPriceBooks,
} from "../src/arr/compute.ts";

const BOOKS: ArrPriceBooks = {
  version: PRICE_BOOK_VERSION,
  priceBook: PRICE_BOOK_SEED,
  addonPriceBook: ADDON_PRICE_BOOK_SEED,
  assumptionsBook: ASSUMPTIONS_BOOK_SEED,
};

const AS_OF = "2026-07-24";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  OK  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function baseInput(
  overrides: Partial<ArrComputeInput> = {}
): ArrComputeInput {
  return {
    agents: 28,
    product: "freshdesk_omni",
    tier: "growth",
    term: "annual",
    currency: "USD",
    region: "US",
    addons: [],
    conversationVolume: null,
    accountAllowanceConsumed: false,
    ...overrides,
  };
}

console.log("test-arr-compute");

// --- ADDON_ARR.md §7 tests 1–8 ---

console.log("\n1. Base only — 28 agents, Omni Growth = $9,744");
{
  const r = computeArr(baseInput(), BOOKS, { asOf: AS_OF });
  ok("arrPoint === 9744", r.arrPoint === 9744, `got ${r.arrPoint}`);
  ok("product freshdesk_omni", r.product === "freshdesk_omni");
  ok("productLabel Freshdesk Omni", r.productLabel === "Freshdesk Omni");
  ok("tier growth", r.tier === "growth");
  ok("base line shows product", r.lines[0]?.product === "freshdesk_omni");
  ok("base line only included", r.lines.filter((l) => !l.excluded).length === 1);
}

console.log("\n2. Base + copilot subset — 40 Omni Pro, 14 copilot = $42,792");
{
  const r = computeArr(
    baseInput({
      agents: 40,
      tier: "pro",
      addons: [
        {
          addonKey: "freddy_ai_copilot",
          quantity: 14,
          unit: "agent_month",
          stated: true,
          inScope: true,
        },
      ],
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  ok("product Freshdesk Omni", r.productLabel === "Freshdesk Omni");
  ok("base 37920", r.lines.find((l) => l.kind === "base")?.annualValue === 37920);
  ok("copilot 4872", r.lines.find((l) => l.addonKey === "freddy_ai_copilot")?.annualValue === 4872);
  ok("total 42792", r.arrPoint === 42792, `got ${r.arrPoint}`);
}

console.log("\n3. Full stack with allowance — case 2 + 2000 sessions/month = $54,307");
{
  const r = computeArr(
    baseInput({
      agents: 40,
      tier: "pro",
      addons: [
        {
          addonKey: "freddy_ai_copilot",
          quantity: 14,
          unit: "agent_month",
          stated: true,
          inScope: true,
        },
        {
          addonKey: "freddy_ai_agent_sessions",
          quantity: 2000,
          unit: "per_month",
          stated: true,
          inScope: true,
        },
      ],
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  const sessions = r.lines.find((l) => l.addonKey === "freddy_ai_agent_sessions");
  ok("sessions 11515", sessions?.annualValue === 11515, `got ${sessions?.annualValue}`);
  ok("235 packs", sessions?.quantity === 235);
  ok("total 54307", r.arrPoint === 54307, `got ${r.arrPoint}`);
  ok("addonArr 16387", r.addonArr === 16387, `got ${r.addonArr}`);
  ok(
    "add-on share 30.2%",
    r.addonShare !== null && Math.abs(r.addonShare - 0.302) < 0.001,
    `got ${r.addonShare}`
  );
}

console.log("\n4. Second deal — 1000 sessions/month, allowance already consumed = $5,880");
{
  const r = computeArr(
    baseInput({
      agents: 1,
      accountAllowanceConsumed: true,
      addons: [
        {
          addonKey: "freddy_ai_agent_sessions",
          quantity: 1000,
          unit: "per_month",
          stated: true,
          inScope: true,
        },
      ],
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  const sessions = r.lines.find((l) => l.addonKey === "freddy_ai_agent_sessions");
  ok("120 packs", sessions?.quantity === 120);
  ok("5880 sessions line", sessions?.annualValue === 5880, `got ${sessions?.annualValue}`);
  ok("no allowance deducted", sessions?.derivationJson.some((d) => d.step === "billable" && d.value === 12000));
}

console.log("\n5. Copilot on Growth — tierConflict, excluded from total");
{
  const r = computeArr(
    baseInput({
      addons: [
        {
          addonKey: "freddy_ai_copilot",
          quantity: 14,
          unit: "agent_month",
          stated: true,
          inScope: true,
        },
      ],
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  const copilot = r.lines.find((l) => l.addonKey === "freddy_ai_copilot");
  ok("tierConflict true", copilot?.tierConflict === true);
  ok("copilot excluded", copilot?.excluded === true);
  ok("arrPoint base only 9744", r.arrPoint === 9744, `got ${r.arrPoint}`);
}

console.log("\n6. Sessions discussed, no volume — not_quantified, total unchanged");
{
  const r = computeArr(
    baseInput({
      addons: [
        {
          addonKey: "freddy_ai_agent_sessions",
          quantity: null,
          unit: null,
          stated: false,
          inScope: true,
        },
      ],
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  const sessions = r.lines.find((l) => l.addonKey === "freddy_ai_agent_sessions");
  ok("quantity null", sessions?.quantity === null);
  ok("inScope true", sessions?.inScope === true);
  ok("excluded true", sessions?.excluded === true);
  ok("not_quantified", sessions?.exclusionReason === "not_quantified");
  ok("total unchanged 9744", r.arrPoint === 9744);
}

console.log("\n7. Freshservice Enterprise — null, no_list_price, no Pro fallback");
{
  const r = computeArr(
    baseInput({
      product: "freshservice",
      tier: "enterprise",
      agents: 50,
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  ok("product freshservice", r.product === "freshservice");
  ok("productLabel Freshservice", r.productLabel === "Freshservice");
  ok("arrPoint null", r.arrPoint === null);
  ok("reason no_list_price", r.nullReason === "no_list_price");
}

console.log("\n8. Rounding — 501 annual sessions, allowance consumed = 6 packs");
{
  const r = computeArr(
    baseInput({
      agents: 1,
      accountAllowanceConsumed: true,
      addons: [
        {
          addonKey: "freddy_ai_agent_sessions",
          quantity: 501,
          unit: "per_year",
          stated: true,
          inScope: true,
        },
      ],
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  const sessions = r.lines.find((l) => l.addonKey === "freddy_ai_agent_sessions");
  ok("6 packs not 5", sessions?.quantity === 6, `got ${sessions?.quantity}`);
  ok("294 annual value", sessions?.annualValue === 294, `got ${sessions?.annualValue}`);
}

// --- ADDON_ARR_VOLUME §7 tests 9–18 ---

console.log("\n9. Normalisation");
{
  ok("12000/month → 144000/yr", normaliseConversationVolume(12000, "per_month") === 144000);
  ok("400/day → 146000/yr", normaliseConversationVolume(400, "per_day") === 146000);
  ok("2500/week → 130000/yr", normaliseConversationVolume(2500, "per_week") === 130000);
}

console.log("\n10. Standard derivation — 144k × 0.5 − 500 → 715 packs × $49");
{
  const r = computeArr(
    baseInput({
      agents: 1,
      conversationVolume: {
        value: 144000,
        unit: "per_year",
        basis: "average",
      },
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  const sessions = r.lines.find((l) => l.addonKey === "freddy_ai_agent_sessions");
  ok("sessions line 35035", sessions?.annualValue === 35035, `got ${sessions?.annualValue}`);
  ok("715 packs", sessions?.quantity === 715);
  const billable = sessions?.derivationJson.find((d) => d.step === "billable");
  ok("billable 71500", billable?.value === 71500);
}

console.log("\n11. Full deal — 40 Omni Pro, 14 Copilot, 12000 conv/month = 77827");
{
  const r = computeArr(
    baseInput({
      agents: 40,
      tier: "pro",
      addons: [
        {
          addonKey: "freddy_ai_copilot",
          quantity: 14,
          unit: "agent_month",
          stated: true,
          inScope: true,
        },
      ],
      conversationVolume: {
        value: 12000,
        unit: "per_month",
        basis: "average",
      },
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  const base = r.lines.find((l) => l.kind === "base")?.annualValue ?? 0;
  const copilot = r.lines.find((l) => l.addonKey === "freddy_ai_copilot")?.annualValue ?? 0;
  const sessions = r.lines.find((l) => l.addonKey === "freddy_ai_agent_sessions")?.annualValue ?? 0;
  ok("base 37920", base === 37920);
  ok("copilot 4872", copilot === 4872);
  ok("sessions 35035", sessions === 35035);
  ok("total 77827", r.arrPoint === 77827, `got ${r.arrPoint}`);
  ok(
    "sessions ~45% of total",
    Math.abs(sessions / (r.arrPoint ?? 1) - 0.45) < 0.001
  );
}

console.log("\n12. Allowance already consumed — 60000/yr, no −500");
{
  const r = computeArr(
    baseInput({
      agents: 1,
      accountAllowanceConsumed: true,
      conversationVolume: {
        value: 60000,
        unit: "per_year",
        basis: "average",
      },
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  const sessions = r.lines.find((l) => l.addonKey === "freddy_ai_agent_sessions");
  ok("300 packs", sessions?.quantity === 300);
  ok("14700", sessions?.annualValue === 14700, `got ${sessions?.annualValue}`);
}

console.log("\n13. Peak basis — excluded, not annualised");
{
  const r = computeArr(
    baseInput({
      conversationVolume: {
        value: 20000,
        unit: "per_month",
        basis: "peak",
        evidence: "We peak at 20,000 in December",
      },
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  const sessions = r.lines.find((l) => l.addonKey === "freddy_ai_agent_sessions");
  ok("excluded", sessions?.excluded === true);
  ok("peak_basis_unresolved", sessions?.exclusionReason === "peak_basis_unresolved");
  ok("total unchanged base only", r.arrPoint === 9744);
}

console.log("\n14. Confidence compounding — 0.9 × 0.5 ≤ 0.45");
{
  const r = computeArr(
    baseInput({
      agents: 1,
      conversationVolume: {
        value: 12000,
        unit: "per_month",
        basis: "average",
        confidence: 0.9,
      },
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  const sessions = r.lines.find((l) => l.addonKey === "freddy_ai_agent_sessions");
  ok(
    "line confidence ≤ 0.45",
    (sessions?.confidence ?? 1) <= 0.45,
    `got ${sessions?.confidence}`
  );
  ok("never 0.9", sessions?.confidence !== 0.9);
}

console.log("\n15. SE override of rate — 0.7 → 1003 packs × $49 = $49,147");
{
  const r = computeArr(
    baseInput({
      agents: 1,
      aiSessionRateOverride: 0.7,
      conversationVolume: {
        value: 12000,
        unit: "per_month",
        basis: "average",
      },
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  const sessions = r.lines.find((l) => l.addonKey === "freddy_ai_agent_sessions");
  ok("100800 sessions", sessions?.derivationJson.find((d) => d.step === "sessions")?.value === 100800);
  ok("1003 packs", sessions?.quantity === 1003);
  ok("49147", sessions?.annualValue === 49147, `got ${sessions?.annualValue}`);
  ok("assumed false after override", sessions?.assumed === false);
}

console.log("\n15b. Confirm assumptions — clears assumed badge, raises confidence");
{
  const r = computeArr(
    baseInput({
      agents: 1,
      assumptionsConfirmed: true,
      conversationVolume: {
        value: 12000,
        unit: "per_month",
        basis: "average",
        confidence: 0.9,
      },
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  const sessions = r.lines.find((l) => l.addonKey === "freddy_ai_agent_sessions");
  ok("assumed false after confirm", sessions?.assumed === false);
  ok(
    "confidence uses stated 0.9 after confirm",
    sessions?.confidence === 0.9,
    `got ${sessions?.confidence}`
  );
}

console.log("\n16. Direct session override — bypasses chain");
{
  const r = computeArr(
    baseInput({
      agents: 1,
      sessionDirectOverride: {
        annualSessions: 72000,
        by: "se@example.com",
        at: "2026-07-24T10:00:00Z",
      },
      conversationVolume: {
        value: 12000,
        unit: "per_month",
        basis: "average",
      },
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  const sessions = r.lines.find((l) => l.addonKey === "freddy_ai_agent_sessions");
  const bypass = sessions?.derivationJson.find((d) => d.step === "direct_override");
  ok("bypass step present", bypass?.bypass === true);
  ok("retains original chain", (bypass?.originalChain?.length ?? 0) > 0);
  ok("715 packs from 72000−500", sessions?.quantity === 715);
}

console.log("\n17. Pack rounding — 71501 billable → 716 packs");
{
  const r = computeArr(
    baseInput({
      agents: 1,
      accountAllowanceConsumed: true,
      sessionDirectOverride: {
        annualSessions: 71501,
        by: "test",
        at: "2026-07-24T10:00:00Z",
      },
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  const sessions = r.lines.find((l) => l.addonKey === "freddy_ai_agent_sessions");
  ok("716 packs not 715", sessions?.quantity === 716, `got ${sessions?.quantity}`);
}

console.log("\n18. No volume stated, AI in scope — not_quantified");
{
  const r = computeArr(
    baseInput({
      conversationVolume: {
        value: null,
        unit: "per_month",
        basis: "average",
        inScope: true,
      },
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  const sessions = r.lines.find((l) => l.addonKey === "freddy_ai_agent_sessions");
  ok("excluded", sessions?.excluded === true);
  ok("not_quantified", sessions?.exclusionReason === "not_quantified");
  ok("total unchanged", r.arrPoint === 9744);
}

// --- ADDON_ARR_MRR §7 tests 19–23 ---

console.log("\n19. Per-seat both directions — MRR × 12 === ARR");
{
  const r = computeArr(
    baseInput({ agents: 40, tier: "pro" }),
    BOOKS,
    { asOf: AS_OF }
  );
  ok("ARR 37920", r.arrPoint === 37920);
  ok("MRR 3160", r.mrr === 3160, `got ${r.mrr}`);
  ok("mrr × 12 === arr", (r.mrr ?? 0) * 12 === r.arrPoint);
}

console.log("\n20. Recurring vs consumption split");
{
  const r = computeArr(
    baseInput({
      agents: 40,
      tier: "pro",
      addons: [
        {
          addonKey: "freddy_ai_copilot",
          quantity: 14,
          unit: "agent_month",
          stated: true,
          inScope: true,
        },
      ],
      conversationVolume: {
        value: 12000,
        unit: "per_month",
        basis: "average",
      },
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  ok("recurringArr 42792", r.recurringArr === 42792, `got ${r.recurringArr}`);
  ok("consumptionArr 35035", r.consumptionArr === 35035, `got ${r.consumptionArr}`);
  ok("recurringMrr 3566", r.recurringMrr === 3566, `got ${r.recurringMrr}`);
  ok("consumptionMrr 2919.58", r.consumptionMrr === 35035 / 12, `got ${r.consumptionMrr}`);
  ok(
    "totalMrr 6485.58",
    Math.abs((r.mrr ?? 0) - 77827 / 12) < 0.001,
    `got ${r.mrr}`
  );
}

console.log("\n21. Rounding integrity — display MRR rounds, ARR exact");
{
  const r = computeArr(
    baseInput({
      agents: 40,
      tier: "pro",
      addons: [
        {
          addonKey: "freddy_ai_copilot",
          quantity: 14,
          unit: "agent_month",
          stated: true,
          inScope: true,
        },
      ],
      conversationVolume: {
        value: 12000,
        unit: "per_month",
        basis: "average",
      },
    }),
    BOOKS,
    { asOf: AS_OF }
  );
  ok("stored ARR 77827", r.arrPoint === 77827);
  ok("display MRR 6486", displayMrr(r.arrPoint!) === 6486);
  const lineSum = r.lines
    .filter((l) => !l.excluded)
    .reduce((s, l) => s + l.annualValue, 0);
  ok("line ARRs sum to total", lineSum === r.arrPoint);
}

console.log("\n22. Monthly term with no price row — no_monthly_price_row");
{
  const r = computeArr(
    baseInput({ term: "monthly" }),
    BOOKS,
    { asOf: AS_OF }
  );
  ok("arrPoint null", r.arrPoint === null);
  ok("reason no_monthly_price_row", r.nullReason === "no_monthly_price_row");
}

console.log("\n23. Sort equivalence — MRR order matches ARR order");
{
  const deals = [
    computeArr(baseInput({ agents: 10 }), BOOKS, { asOf: AS_OF }),
    computeArr(baseInput({ agents: 40, tier: "pro" }), BOOKS, { asOf: AS_OF }),
    computeArr(baseInput({ agents: 28 }), BOOKS, { asOf: AS_OF }),
  ];
  const byArr = [...deals].sort((a, b) => (b.arrPoint ?? 0) - (a.arrPoint ?? 0));
  const byMrr = [...deals].sort(
    (a, b) => mrrFromArr(b.arrPoint ?? 0) - mrrFromArr(a.arrPoint ?? 0)
  );
  ok(
    "identical sort order",
    byArr.every((d, i) => d.arrPoint === byMrr[i]?.arrPoint)
  );
}

console.log(`\ntest-arr-compute: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
