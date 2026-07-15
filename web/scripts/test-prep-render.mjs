import { pickDemoLinks } from "../demo-links.js";

const samplePrep = {
  description: "Online learning platform for students worldwide",
  incumbent: { incumbent_name: "Zendesk", displacement: "entrenched" },
  fitSnapshot: [
    { label: "Omnichannel Support", thisCompany: "Email only", industryNorm: "Omnichannel expected", gap: "large", gapVerdict: "Behind" },
    { label: "AI Deflection", thisCompany: "Basic FAQ", industryNorm: "AI self-service", gap: "partial", gapVerdict: "Partial" },
    { label: "Agent Assist", thisCompany: "No copilot", industryNorm: "AI assist common", gap: "large", gapVerdict: "Behind" },
  ],
  industryUseCases: ["Student account help", "Billing disputes", "Content access issues"],
  companySizeAgents: { agents: "40-60", estimated: true },
  businessContext: {
    market: "EdTech nonprofit",
    model: "Donation-funded free",
    users: "150M learners",
    uptimeNeed: "24/7 global",
    fundingParent: "Nonprofit grants",
    headOffice: "Mountain View CA",
    languages: "40+ languages",
  },
  discoveryKit: [
    { question: "How do agents route tickets today?", because: "Maps omnichannel gap" },
    { question: "What deflection rate do you target?", because: "Sizes AI opportunity" },
  ],
  painCapabilityValue: [
    { pain: "Slow email queues", capability: "Unified inbox", value: "Faster student replies" },
  ],
  attendees: [{ name: "Jane Doe", role: "VP Support", decisionPower: "decision_maker" }],
  sources: [{ claim: "Uses Zendesk help center", url: "https://example.com" }],
};

function isV5Prep(p) {
  if (p?.supportMaturity || p?.businessContext?.signals || p?.businessContext?.workflows) return false;
  return !!(
    p?.incumbent?.displacement &&
    p?.companySizeAgents &&
    p?.businessContext?.market &&
    Array.isArray(p?.fitSnapshot) &&
    p.fitSnapshot.length >= 1
  );
}

const checks = [
  ["isV5Prep accepts new shape", isV5Prep(samplePrep)],
  ["isV5Prep rejects old supportMaturity", !isV5Prep({ ...samplePrep, supportMaturity: { selfServicePortal: "Y" } })],
  ["pickDemoLinks returns links", pickDemoLinks(samplePrep).length > 0],
  ["fitSnapshot has 3 rows", samplePrep.fitSnapshot.length === 3],
  ["no signals in businessContext", !samplePrep.businessContext.signals],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) {
    console.error(`FAIL: ${name}`);
    failed++;
  } else {
    console.log(`ok: ${name}`);
  }
}

if (failed) process.exit(1);
console.log("prep render contract checks passed");
