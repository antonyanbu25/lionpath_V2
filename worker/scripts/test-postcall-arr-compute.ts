/**
 * Unit tests — arr-inputs → computeArr wiring (no LLM).
 */
import { mapArrInputsToComputeInput } from "../src/arr/map-inputs.ts";
import { runPostCallArrCompute } from "../src/postcall/arr-compute.ts";

const checks: [string, boolean][] = [];

const mapped = mapArrInputsToComputeInput({
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
      evidence: "14 of 40 agents",
      confidence: 0.9,
    },
  ],
  conversationVolume: {
    value: 12000,
    unit: "per_month",
    basis: "average",
    channelMix: [],
    evidence: "about 12,000 conversations a month",
    confidence: 0.85,
    inScope: true,
  },
  ticketVolume: null,
  connectorTasks: null,
});

checks.push(
  ["maps required base fields", mapped.input?.agents === 40 && mapped.input?.product === "freshdesk_omni"],
  ["maps copilot addon", mapped.input?.addons[0]?.addonKey === "freddy_ai_copilot" && mapped.input!.addons[0]?.quantity === 14],
  ["maps conversation volume", mapped.input?.conversationVolume?.value === 12000],
  ["no map errors", mapped.errors.length === 0],
);

const connectorMerge = mapArrInputsToComputeInput({
  agents: 28,
  product: "freshdesk_omni",
  tier: "growth",
  term: "annual",
  currency: "USD",
  region: "US",
  addons: [],
  conversationVolume: null,
  ticketVolume: null,
  connectorTasks: {
    value: 10000,
    unit: "per_month",
    basis: "average",
    channelMix: [],
    evidence: "10,000 connector tasks monthly",
    confidence: 0.8,
    inScope: true,
  },
});

checks.push(
  [
    "connectorTasks volume merges to addon",
    connectorMerge.input?.addons.some(
      (a) => a.addonKey === "connector_app_tasks" && a.quantity === 10000,
    ) === true,
  ],
);

const missingAgents = mapArrInputsToComputeInput({
  agents: null,
  product: "freshdesk_omni",
  tier: "pro",
  term: "annual",
  currency: "USD",
  region: "US",
  addons: [],
  conversationVolume: null,
  ticketVolume: null,
  connectorTasks: null,
});

checks.push(
  ["missing agents returns error", missingAgents.input === null && missingAgents.errors.some((e) => e.includes("agents"))],
);

const fullCompute = runPostCallArrCompute({
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
      evidence: "14 of 40",
      confidence: 0.9,
    },
  ],
  conversationVolume: {
    value: 12000,
    unit: "per_month",
    basis: "average",
    channelMix: [],
    evidence: "12,000 conversations/month",
    confidence: 0.85,
    inScope: true,
  },
  ticketVolume: null,
  connectorTasks: null,
});

checks.push(
  ["full deal arrPoint 77827", fullCompute.arrPoint === 77827],
  ["full deal product label", fullCompute.productLabel === "Freshdesk Omni"],
  ["echoes inputs", fullCompute.inputs.agents === 40],
  ["price book version set", !!fullCompute.priceBookVersion],
);

const inScopeAi = runPostCallArrCompute({
  agents: 28,
  product: "freshdesk_omni",
  tier: "growth",
  term: "annual",
  currency: "USD",
  region: "US",
  addons: [],
  conversationVolume: {
    value: null,
    unit: null,
    basis: null,
    channelMix: [],
    evidence: "AI agent discussed",
    confidence: 0.5,
    inScope: true,
  },
  ticketVolume: null,
  connectorTasks: null,
});

checks.push(
  ["in-scope AI unchanged total", inScopeAi.arrPoint === 9744],
  [
    "not_quantified sessions line",
    inScopeAi.lines.some(
      (l) => l.addonKey === "freddy_ai_agent_sessions" && l.exclusionReason === "not_quantified",
    ),
  ],
);

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
console.log(`\n${checks.length} postcall-arr-compute checks passed.`);
