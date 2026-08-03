import { normalizePrepOutput, confidenceBand, clampConfidence } from "../src/word-limits.ts";
import { FIT_LABELS } from "../src/schema.ts";
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
      priorEmployers: ["Globex"],
      competitorTouchpoints: ["Zendesk"],
      sourceLabel: "S2",
    },
  ],
  icpFit: {
    product: "Freshdesk",
    verdict: "Strong",
    highlights: ["Winning Zone: 50–500 employees"],
    gaps: ["Confirm agent count"],
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
  // Axes are fixed and keyed: exactly one row per FIT_LABEL, in order, never a duplicate.
  ["fit rows are the fixed axis set", JSON.stringify(out.fitSnapshot.map((r) => r.label)) === JSON.stringify([...FIT_LABELS])],
  ["fit legacy Omnichannel Support maps to Channel coverage", out.fitSnapshot[0]?.label === "Channel coverage" && out.fitSnapshot[0]?.thisCompany === "Email"],
  // The fixture sends both "AI Deflection" and "Agent Assist"; both map to AI adoption, so the
  // second must be dropped rather than producing a second AI adoption row.
  ["fit legacy collision does not duplicate an axis", out.fitSnapshot.filter((r) => r.label === "AI adoption").length === 1],
  // An axis research said nothing about is present and honest, not absent.
  ["unsourced axis is present as unknown", out.fitSnapshot.find((r) => r.label === "Routing")?.thisCompany === "unknown"],
  ["prospects normalized", out.prospects.length >= 1],
  ["icpFit normalized", out.icpFit?.product === "Freshdesk" && out.icpFit.verdict === "Strong"],
  // No criteria on this fixture, so it takes the legacy path: the stored verdict survives
  // and no zone is claimed. frameworkRefs was removed — the zone is server-derived now.
  ["icpFit no zone claimed without criteria", out.icpFit?.zone === undefined],
  ["icpFit carries no score", (out.icpFit as Record<string, unknown>)?.score === undefined],
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
