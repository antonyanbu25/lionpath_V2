/**
 * Unit tests for ARR input normalize helpers (no LLM).
 */
import { normalizeArrInputsOutput } from "../src/postcall/arr-inputs.ts";

const checks: [string, boolean][] = [];

const fullDeal = normalizeArrInputsOutput({
  agents: 40,
  product: "freshdesk_omni",
  tier: "pro",
  term: "annual",
  currency: "USD",
  region: "US",
  addons: [
    {
      addonKey: "freddy_ai_copilot",
      quantity: 14,
      unit: "agent_month",
      stated: true,
      inScope: true,
      evidence: "We want Copilot for 14 of our 40 agents",
      confidence: 0.9,
    },
    {
      addonKey: "freddy_ai_agent_sessions",
      quantity: 72000,
      unit: "per_year",
      stated: true,
      inScope: true,
      evidence: "model wrongly returned sessions",
      confidence: 0.9,
    },
  ],
  conversationVolume: {
    value: 12000,
    unit: "per_month",
    basis: "average",
    channelMix: [{ channel: "email", share: null }, { channel: "chat", share: null }],
    evidence: "We handle about 12,000 conversations a month",
    confidence: 0.85,
    inScope: true,
  },
});

checks.push(
  ["agents preserved", fullDeal.agents === 40],
  ["copilot subset seats", fullDeal.addons[0]?.quantity === 14],
  ["session addon quantity stripped", fullDeal.addons[1]?.quantity === null],
  ["session addon not stated", fullDeal.addons[1]?.stated === false],
  ["conversation volume kept", fullDeal.conversationVolume?.value === 12000],
  ["conversation unit", fullDeal.conversationVolume?.unit === "per_month"],
);

const inScopeOnly = normalizeArrInputsOutput({
  agents: null,
  product: "freshdesk_omni",
  tier: "pro",
  addons: [
    {
      addonKey: "freddy_ai_copilot",
      quantity: null,
      unit: null,
      stated: false,
      inScope: true,
      evidence: "We'll definitely want the AI agent on Pro",
      confidence: 0.6,
    },
  ],
  conversationVolume: {
    value: null,
    unit: null,
    basis: null,
    channelMix: [],
    evidence: "AI deflection came up but no volume stated",
    confidence: 0.5,
    inScope: true,
  },
});

checks.push(
  ["in-scope addon without quantity", inScopeOnly.addons[0]?.inScope === true && inScopeOnly.addons[0]?.quantity === null],
  ["in-scope volume without value", inScopeOnly.conversationVolume?.inScope === true && inScopeOnly.conversationVolume?.value === null],
);

const peakBasis = normalizeArrInputsOutput({
  conversationVolume: {
    value: 20000,
    unit: "per_month",
    basis: "peak",
    channelMix: [],
    evidence: "We peak at 20,000 in December",
    confidence: 0.8,
    inScope: true,
  },
});

checks.push(
  ["peak basis preserved", peakBasis.conversationVolume?.basis === "peak"],
  ["peak evidence kept", peakBasis.conversationVolume?.evidence.includes("December")],
);

const tierConflict = normalizeArrInputsOutput({
  product: "freshdesk_omni",
  tier: "growth",
  addons: [
    {
      addonKey: "freddy_ai_copilot",
      quantity: 10,
      unit: "agent_month",
      stated: true,
      inScope: true,
      evidence: "10 Copilot seats on Growth",
      confidence: 0.7,
    },
  ],
});

checks.push(["copilot on growth flagged", tierConflict.addons[0]?.tierConflict === true]);

const noEvidenceNumber = normalizeArrInputsOutput({
  agents: 200,
  addons: [
    {
      addonKey: "freddy_ai_copilot",
      quantity: 40,
      unit: "agent_month",
      stated: true,
      inScope: true,
      evidence: "",
      confidence: 0.9,
    },
  ],
  conversationVolume: {
    value: 5000,
    unit: "per_month",
    basis: "average",
    channelMix: [],
    evidence: "",
    confidence: 0.9,
    inScope: true,
  },
});

checks.push(
  ["addon without evidence nulls quantity", noEvidenceNumber.addons[0]?.quantity === null],
  ["volume without evidence nulls value", noEvidenceNumber.conversationVolume?.value === null],
);

const tierWithoutProduct = normalizeArrInputsOutput({
  product: null,
  tier: "growth",
});

checks.push(
  ["tier without product kept as growth", tierWithoutProduct.tier === "growth"],
  ["product stays null", tierWithoutProduct.product === null],
);

const freshsalesUser = normalizeArrInputsOutput({
  product: "freshsales",
  tier: "growth",
  agents: 25,
});

checks.push(["freshsales product accepted", freshsalesUser.product === "freshsales"]);

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    console.error("FAIL:", name);
    failed++;
  } else {
    console.log("ok:", name);
  }
}

if (failed) process.exit(1);
console.log(`\n${checks.length} postcall-arr-inputs checks passed.`);
