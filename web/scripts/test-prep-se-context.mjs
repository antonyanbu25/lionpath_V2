import { applySeContextToFacts, applySeContextToPrep, parseSeContextSignals } from "../prep-se-context.js";

const notes = "Uses Zendesk, evaluating AI chatbot, 50 agents";
const hints = parseSeContextSignals(notes);
const prep = applySeContextToPrep(
  {
    signals: [
      { label: "Incumbent tool", value: "unknown", sourceLabel: "S1" },
      { label: "Integrations", value: "unknown", sourceLabel: "S1" },
      { label: "Web chat widget", value: "unknown", sourceLabel: "S1" },
      { label: "AI in their current tech stack", value: "unknown", sourceLabel: "S1" },
      { label: "Support portal", value: "unknown", sourceLabel: "S1" },
      { label: "Hiring support roles", value: "unknown", sourceLabel: "S1" },
    ],
    sources: [{ label: "S1", title: "Web", url: "https://example.com", confidence: 80 }],
  },
  notes,
);

const checks = [
  ["parses zendesk", hints["Incumbent tool"] === "Zendesk"],
  ["fills incumbent", prep.signals.find((s) => s.label === "Incumbent tool")?.value === "Zendesk"],
  ["fills hiring", prep.signals.find((s) => s.label === "Hiring support roles")?.value === "50 agents"],
  ["adds SE source", prep.sources.some((s) => s.label === "SE")],
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
console.log(`\n${checks.length} prep-se-context checks passed.`);

const supportNotes = "support users 40-50 on Zendesk";
const supportPrep = applySeContextToFacts(
  {
    facts: [{ key: "Company size", value: "40-50 support users", sourceLabel: "SE" }],
    companySizeAgents: { agents: "unknown", estimated: false },
    businessContext: { users: "40-50 support users" },
  },
  supportNotes,
);
const supportChecks = [
  ["routes support to agents", supportPrep.companySizeAgents?.agents === "40-50"],
  ["Support team fact", supportPrep.facts.find((f) => f.key === "Support team")?.value === "40-50"],
  ["clears wrong company size", supportPrep.facts.find((f) => f.key === "Company size")?.value === "unknown"],
];
let supportFailed = 0;
for (const [name, ok] of supportChecks) {
  if (!ok) {
    console.error("FAIL:", name);
    supportFailed++;
  } else {
    console.log("ok:", name);
  }
}
if (supportFailed) process.exit(1);
console.log(`\n${supportChecks.length} applySeContextToFacts checks passed.`);
