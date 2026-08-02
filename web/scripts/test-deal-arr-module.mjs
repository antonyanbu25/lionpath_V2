/**
 * Unit tests for deal ARR derivation panel (task 2.6 read-only).
 */

import {
  displayMrrFromArr,
  formatUsd,
  renderDealArrModule,
  selectLatestArrLines,
} from "../deal-arr-module.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const ts = Date.now();
const callId = "call_arr_ui";
const dealId = "deal_arr_ui";

const fullDealLines = [
  {
    id: "arl_base",
    dealId,
    callId,
    kind: "base",
    addonKey: null,
    quantity: 40,
    unit: "agent_month",
    unitPrice: 79,
    annualValue: 37920,
    recurring: true,
    stated: true,
    inScope: true,
    excluded: false,
    exclusionReason: null,
    confidence: 1,
    evidence: "we need about 40 agents",
    derivationJson: [],
    computedAt: ts,
    priceBookVersion: "2026-07-24-usd-list",
    assumptionsBookVersion: "2026-07-24-usd-list",
  },
  {
    id: "arl_copilot",
    dealId,
    callId,
    kind: "addon",
    addonKey: "freddy_ai_copilot",
    quantity: 14,
    unit: "agent_month",
    unitPrice: 29,
    annualValue: 4872,
    recurring: true,
    stated: true,
    inScope: true,
    excluded: false,
    exclusionReason: null,
    confidence: 1,
    evidence: "14 of our 40",
    derivationJson: [{ step: "priced", unitPrice: 29, annualValue: 4872 }],
    computedAt: ts,
    priceBookVersion: "2026-07-24-usd-list",
    assumptionsBookVersion: "2026-07-24-usd-list",
  },
  {
    id: "arl_sessions",
    dealId,
    callId,
    kind: "addon",
    addonKey: "freddy_ai_agent_sessions",
    quantity: 715,
    unit: "per_100_sessions",
    unitPrice: 49,
    annualValue: 35035,
    recurring: false,
    stated: true,
    inScope: true,
    excluded: false,
    exclusionReason: null,
    confidence: 0.45,
    evidence: "we handle about 12,000 a month",
    derivationJson: [
      {
        step: "stated",
        value: 12000,
        unit: "per_month",
        evidence: "we handle about 12,000 a month",
        source: "call",
      },
      { step: "normalised", value: 144000, unit: "per_year" },
      {
        step: "sessions",
        value: 72000,
        assumptionKey: "ai_session_rate",
        assumptionValue: 0.5,
        assumptionSource: "internal_estimate",
      },
      { step: "billable", value: 71500, note: "less 500 account allowance" },
      { step: "priced", packs: 715, unitPrice: 49, annualValue: 35035 },
    ],
    computedAt: ts,
    priceBookVersion: "2026-07-24-usd-list",
    assumptionsBookVersion: "2026-07-24-usd-list",
  },
];

const deal = {
  id: dealId,
  arrEstimatePoint: 77827,
  arrPriceBookVersion: "2026-07-24-usd-list",
  assumptionsBookVersion: "2026-07-24-usd-list",
  arrComputedAt: ts,
  arrInputsJson: {
    agents: 40,
    product: "freshdesk_omni",
    tier: "pro",
    agentsEvidence: "we need about 40 agents",
  },
  postCallCount: 1,
};

assert(formatUsd(77827) === "$77,827", "formatUsd");
assert(displayMrrFromArr(77827) === 6486, "displayMrrFromArr");

const latest = selectLatestArrLines([
  ...fullDealLines,
  { ...fullDealLines[0], callId: "old_call", computedAt: ts - 1000 },
]);
assert(latest.length === 3, "selectLatestArrLines picks latest call set");
assert(latest.every((l) => l.callId === callId), "latest callId");

const html = renderDealArrModule(deal, fullDealLines);

assert(html.includes("$77,827 ARR"), "header ARR");
assert(html.includes("$6,486 MRR"), "header MRR");
assert(html.includes("Freshdesk Omni Pro"), "base product tier");
assert(html.includes("we need about 40 agents"), "base evidence quote");
assert(html.includes("Freddy AI Copilot"), "copilot row");
assert(html.includes("Freddy AI Agent sessions"), "sessions row");
assert(html.includes("⚠ assumed"), "assumed badge on sessions");
assert(html.includes("deal-arr-derivation"), "sessions expandable chain");
assert(html.includes("12,000 conversations/month"), "stated chain step");
assert(html.includes("144,000 / year"), "normalised chain step");
assert(html.includes("72,000"), "sessions chain step");
assert(html.includes("71,500"), "billable chain step");
assert(html.includes("Recurring"), "recurring subtotal");
assert(html.includes("$42,792 ARR"), "recurring ARR subtotal");
assert(html.includes("$3,566 MRR"), "recurring MRR subtotal");
assert(html.includes("Consumption"), "consumption subtotal");
assert(html.includes("$35,035 ARR"), "consumption ARR");
assert(html.includes("normalised, not a monthly bill"), "consumption note");
assert(html.includes("Add-on share of total: 51.3%"), "addon share");
assert(html.includes("Price book 2026-07-24-usd-list"), "footer price book");
assert(html.includes("Assumptions 2026-07-24-usd-list"), "footer assumptions book");

const editableHtml = renderDealArrModule(deal, fullDealLines, { editable: true, displayUnit: "MRR" });
assert(editableHtml.includes("deal-arr-module--editable"), "editable module class");
assert(editableHtml.includes("deal-arr-field-input"), "inline editable inputs");
assert(editableHtml.includes("deal-arr-unit-toggle"), "ARR/MRR unit toggle");
assert(editableHtml.includes('data-arr-field="agents"'), "agents field");
assert(editableHtml.includes('data-arr-field="conversationVolume"'), "conversation volume field");
assert(editableHtml.includes('data-arr-field="aiSessionRate"'), "session rate field");
assert(editableHtml.includes('data-arr-field="copilotSeats"'), "copilot seats field");
assert(editableHtml.includes('data-arr-field="sessionDirectOverride"'), "direct session override field");
assert(editableHtml.includes("Confirm assumptions"), "confirm assumptions action");
assert(editableHtml.includes("deal-arr-field-provenance"), "provenance display");
assert(editableHtml.includes("$6,486 MRR"), "MRR-primary header when toggled");

const excludedHtml = renderDealArrModule(deal, [
  {
    id: "arl_excl",
    dealId,
    callId,
    kind: "addon",
    addonKey: "freddy_ai_agent_sessions",
    quantity: null,
    unit: "per_100_sessions",
    unitPrice: 49,
    annualValue: 0,
    recurring: false,
    stated: false,
    inScope: true,
    excluded: true,
    exclusionReason: "not_quantified",
    evidence: "we'll definitely want the AI agent",
    derivationJson: [],
    computedAt: ts,
  },
]);

assert(
  excludedHtml.includes("Freddy AI Agent sessions. discussed, volume not stated. excluded"),
  "excluded row visible with reason",
);
assert(excludedHtml.includes("deal-arr-row--excluded"), "excluded styling");

const conflictHtml = renderDealArrModule(
  { ...deal, arrEstimatePoint: 9744 },
  [
    {
      id: "arl_base_g",
      dealId,
      callId,
      kind: "base",
      addonKey: null,
      quantity: 28,
      unit: "agent_month",
      unitPrice: 29,
      annualValue: 9744,
      recurring: true,
      stated: true,
      excluded: false,
      confidence: 1,
      computedAt: ts,
    },
    {
      id: "arl_copilot_bad",
      dealId,
      callId,
      kind: "addon",
      addonKey: "freddy_ai_copilot",
      quantity: 14,
      unit: "agent_month",
      unitPrice: 29,
      annualValue: 4872,
      recurring: true,
      stated: true,
      inScope: true,
      excluded: true,
      exclusionReason: "tier_conflict",
      tierConflict: true,
      confidence: null,
      derivationJson: [
        { step: "tier_conflict", note: "Copilot requires pro/enterprise; deal tier is growth" },
      ],
      computedAt: ts,
    },
  ],
);

assert(conflictHtml.includes("tier conflict"), "tier conflict exclusion phrase");
assert(conflictHtml.includes("deal-arr-row--conflict"), "tier conflict styling");

console.log("test-deal-arr-module: ok");
