import { isV8Prep, isV7Prep, isV6Prep } from "../precall-render.js";

const v6 = {
  description: "Legacy one pager",
  incumbent: { incumbent_name: "Zendesk", displacement: "entrenched" },
  companySizeAgents: { agents: "10", estimated: false },
  businessContext: {
    market: "SaaS",
    model: "B2B",
    users: "Teams",
    uptimeNeed: "24/7",
    fundingParent: "VC",
    headOffice: "SF",
    languages: "English",
  },
  fitSnapshot: [
    { label: "Support channels", thisCompany: "Email", industryNorm: "Omni", gap: "large", gapVerdict: "Behind" },
    { label: "Self Serve", thisCompany: "None", industryNorm: "AI", gap: "large", gapVerdict: "Behind" },
    { label: "Agent Assist", thisCompany: "None", industryNorm: "Assist", gap: "partial", gapVerdict: "Partial" },
  ],
  industryUseCases: ["Billing help"],
  discoveryKit: [{ question: "Q?", because: "Because" }],
  painCapabilityValue: [{ pain: "P", capability: "C", value: "V" }],
  attendees: [],
  sources: [{ claim: "Site", url: "https://x.com" }],
};

const v7only = {
  description: "V7 brief",
  about: "About text",
  facts: [{ key: "Industry", value: "SaaS", sourceLabel: "S1" }],
  signals: [{ label: "Incumbent tool", value: "Zendesk", sourceLabel: "S1" }],
  incumbent: { incumbent_name: "Zendesk", displacement: "entrenched" },
  fitSnapshot: [],
  supportJD: { title: "Agent", sourceLabel: "S1", bullets: [] },
  likelyPains: [],
  industryUseCases: [],
  checklist: [],
  companySizeAgents: { agents: "10", estimated: false },
  businessContext: {
    market: "SaaS",
    model: "B2B",
    users: "Teams",
    uptimeNeed: "24/7",
    fundingParent: "VC",
    headOffice: "SF",
    languages: "English",
  },
  discoveryKit: [],
  painCapabilityValue: [],
  attendees: [],
  sources: [
    { label: "S1", title: "Site", url: "https://x.com", confidence: 80 },
    { label: "S2", title: "LI", url: "unknown", confidence: 50 },
    { label: "S3", title: "Jobs", url: "unknown", confidence: 40 },
  ],
};

const checks = [
  ["isV6Prep accepts legacy", isV6Prep(v6)],
  ["isV7Prep rejects v6", !isV7Prep(v6)],
  ["isV8Prep rejects v6", !isV8Prep(v6)],
  ["isV7Prep accepts v7only", isV7Prep(v7only)],
  ["isV8Prep rejects v7 without prospects", !isV8Prep(v7only)],
  ["isV7Prep rejects old supportMaturity", !isV7Prep({ ...v6, supportMaturity: { selfServicePortal: "Y" } })],
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
console.log(`\n${checks.length} prep shape checks passed.`);
