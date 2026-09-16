import { SIGNAL_LABELS } from "../src/schema.ts";
import {
  applySeContextToPrep,
  factsFromSeContext,
  parseSeContextSignals,
} from "../src/prep/se-context-facts.ts";

const notes = "Uses Zendesk, evaluating AI chatbot, 50 agents, Salesforce integration";

const hints = parseSeContextSignals(notes);
const facts = factsFromSeContext(notes);
const prep = applySeContextToPrep(
  {
    description: "test",
    about: "test",
    incumbent: { incumbent_name: "unknown", displacement: "unknown" },
    fitSnapshot: [],
    facts: [],
    signals: SIGNAL_LABELS.map((label) => ({ label, value: "unknown", sourceLabel: "S1" })),
    supportJD: { title: "unknown", sourceLabel: "S1", bullets: [] },
    likelyPains: [],
    industryUseCases: [],
    checklist: [],
    companySizeAgents: { agents: "unknown", estimated: false },
    businessContext: {
      market: "unknown",
      model: "unknown",
      users: "unknown",
      uptimeNeed: "unknown",
      fundingParent: "unknown",
      headOffice: "unknown",
      languages: "unknown",
    },
    discoveryKit: [],
    painCapabilityValue: [],
    attendees: [],
    prospects: [],
    icpFit: { product: "Freshdesk", verdict: "unknown", score: 0, highlights: [], gaps: [], frameworkRefs: [] },
    sources: [{ label: "S1", title: "Web", url: "https://example.com", confidence: 80 }],
  },
  notes,
);

const checks = [
  ["parses incumbent", hints["Incumbent tool"] === "Zendesk"],
  ["parses AI signal", Boolean(hints["AI in their current tech stack"])],
  ["parses integrations", hints["Integrations"]?.includes("Salesforce") === true],
  ["facts use signal keys", facts.facts.every((f) => SIGNAL_LABELS.includes(f.key as (typeof SIGNAL_LABELS)[number]))],
  ["prep fills incumbent", prep.signals.find((s) => s.label === "Incumbent tool")?.value === "Zendesk"],
  ["prep fills AI", !String(prep.signals.find((s) => s.label === "AI in their current tech stack")?.value).includes("unknown")],
  ["prep adds SE source", prep.sources.some((s) => s.label === "SE")],
  ["empty input noop", factsFromSeContext("").facts.length === 0],
];

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
console.log(`\n${checks.length} se-context-facts checks passed.`);
