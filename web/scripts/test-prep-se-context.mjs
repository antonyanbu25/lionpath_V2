import { applySeContextToPrep, parseSeContextSignals } from "../prep-se-context.js";

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
