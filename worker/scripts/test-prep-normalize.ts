import { normalizePrepOutput, confidenceBand, clampConfidence } from "../src/word-limits.ts";
import type { Prep } from "../src/schema.ts";

const raw = {
  description: "Test company one liner",
  about: "About paragraph for the test company.",
  incumbent: { incumbent_name: "Zendesk", displacement: "entrenched" },
  fitSnapshot: [
    { label: "Omnichannel Support", thisCompany: "Email", industryNorm: "Omnichannel", gap: "large", gapVerdict: "Behind" },
    { label: "AI Deflection", thisCompany: "None", industryNorm: "AI bots", gap: "large", gapVerdict: "Behind" },
    { label: "Agent Assist", thisCompany: "Macros", industryNorm: "Copilot", gap: "partial", gapVerdict: "Partial" },
  ],
  facts: [{ key: "Industry", value: "SaaS", sourceLabel: "S1" }],
  signals: [
    { label: "Incumbent tool", value: "Zendesk", sourceLabel: "S1" },
    { label: "Integrations", value: "Salesforce", sourceLabel: "S2" },
    { label: "Web chat widget", value: "Yes", sourceLabel: "S1" },
    { label: "Uses AI already", value: "No", sourceLabel: "S3" },
    { label: "Support portal", value: "Help center", sourceLabel: "S1" },
    { label: "Hiring support roles", value: "2 roles", sourceLabel: "S3" },
  ],
  supportJD: { title: "Support Agent", sourceLabel: "S3", bullets: ["Answer tickets"] },
  evaluatorJD: { tools: ["Zendesk"] },
  likelyPains: ["Slow routing", "No self-service deflection"],
  industryUseCases: [{ name: "Billing help", steps: ["Open ticket", "Verify account"] }],
  checklist: ["Setup sandbox"],
  companySizeAgents: { agents: "10", estimated: false },
  businessContext: {
    market: "SaaS",
    model: "Subscription",
    users: "SMB teams",
    uptimeNeed: "24/7",
    fundingParent: "VC backed",
    headOffice: "SF CA",
    languages: "English",
  },
  discoveryKit: [{ question: "How do you triage?", because: "Routing pain" }],
  painCapabilityValue: [
    {
      pain: "Slow routing",
      capability: "Auto route",
      values: ["Faster SLAs", "Less queue backlog"],
    },
    {
      pain: "No self-service deflection",
      capability: "Unified inbox",
      value: "Faster response",
    },
  ],
  attendees: [{ name: "Alex", role: "Director", decisionPower: "decision_maker" }],
  prospects: [
    {
      name: "Alex",
      role: "Director",
      totalExperience: "10 years",
      experienceSummary: "10 years B2B support leadership in SaaS",
      priorEmployers: ["Globex"],
      competitorTouchpoints: ["Zendesk"],
      sourceLabel: "S2",
    },
  ],
  icpFit: {
    product: "Freshdesk",
    verdict: "Strong",
    score: 78,
    highlights: ["Winning Zone: 50–500 employees"],
    gaps: ["Confirm agent count"],
    frameworkRefs: ["Winning Zone"],
  },
  sources: [
    { label: "S1", title: "Website", url: "https://example.com", confidence: 90 },
    { label: "S2", title: "LinkedIn", url: "https://linkedin.com", confidence: 60 },
    { label: "S3", title: "Jobs", url: "unknown", confidence: 40 },
  ],
} as Prep;

const out = normalizePrepOutput(raw);

const checks: [string, boolean][] = [
  ["has about", !!out.about],
  ["facts normalized", out.facts.length >= 1],
  ["six signals", out.signals.length === 6],
  ["legacy AI signal renamed", out.signals.some((s) => s.label === "AI in their current tech stack")],
  ["fit labels renamed", out.fitSnapshot[0]?.label === "Support channels"],
  ["fit legacy AI Deflection", out.fitSnapshot[1]?.label === "Self Serve"],
  ["prospects normalized", out.prospects.length >= 1],
  ["prospect experienceSummary", out.prospects[0]?.experienceSummary !== "unknown"],
  ["evaluatorJD tools normalized", Array.isArray(out.evaluatorJD?.tools)],
  ["icpFit normalized", out.icpFit?.product === "Freshdesk" && out.icpFit.verdict === "Strong"],
  ["icpFit frameworkRefs", (out.icpFit?.frameworkRefs?.length || 0) >= 1],
  ["use cases empty", out.industryUseCases.length === 0],
  ["demo script rows match pains", out.painCapabilityValue.length === out.likelyPains.length],
  ["demo script pain from likelyPains", out.painCapabilityValue[0]?.pain === "Slow routing"],
  ["demo script values per row", out.painCapabilityValue.every((r) => r.values.length >= 2)],
  ["legacy value migrated", out.painCapabilityValue[1]?.values.length >= 2],
  ["sources have confidence", out.sources.every((s) => typeof s.confidence === "number")],
  ["assets attached", Array.isArray(out.assets) && out.assets.length >= 1],
  ["confidenceBand high", confidenceBand(85) === "High"],
  ["confidenceBand medium", confidenceBand(60) === "Medium"],
  ["clampConfidence defaults", clampConfidence(undefined) === 50],
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
console.log(`\n${checks.length} worker prep normalize checks passed.`);
