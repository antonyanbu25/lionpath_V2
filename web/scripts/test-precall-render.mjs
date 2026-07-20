import {
  isV8Prep,
  isV7Prep,
  renderDiscoveryTab,
  renderDemoTab,
  renderResultHeader,
  confidenceMeta,
  SIGNAL_TOOLTIPS,
} from "../precall-render.js";

const sampleV8 = {
  description: "B2B SaaS customer support platform",
  about: "Endurance Doors manufactures commercial door systems for healthcare and education facilities across North America.",
  incumbent: { incumbent_name: "Zendesk", displacement: "entrenched" },
  fitSnapshot: [
    { label: "Support channels", thisCompany: "Email only", industryNorm: "Omnichannel", gap: "large", gapVerdict: "Behind" },
    { label: "Self Serve", thisCompany: "No AI", industryNorm: "AI chatbots", gap: "large", gapVerdict: "Behind" },
    { label: "Agent Assist", thisCompany: "Manual macros", industryNorm: "Copilot tools", gap: "partial", gapVerdict: "Partial" },
  ],
  facts: [
    { key: "Industry", value: "Manufacturing", sourceLabel: "S1" },
    { key: "Head office", value: "Chicago, IL", sourceLabel: "S2" },
  ],
  signals: [
    { label: "Incumbent tool", value: "Zendesk Suite", sourceLabel: "S1" },
    { label: "Integrations", value: "Salesforce CRM", sourceLabel: "S2" },
    { label: "Web chat widget", value: "Live chat enabled", sourceLabel: "S1" },
    { label: "AI in their current tech stack", value: "No public AI", sourceLabel: "S3" },
    { label: "Support portal", value: "Zendesk Help Center", sourceLabel: "S1" },
    { label: "Hiring support roles", value: "3 open roles", sourceLabel: "S4" },
  ],
  supportJD: { title: "Customer Support Specialist", sourceLabel: "S4", bullets: ["Handle tier-1 tickets", "Update KB articles"] },
  likelyPains: ["Slow ticket routing", "No self-service deflection", "Fragmented installer comms"],
  industryUseCases: [
    { name: "Order status", steps: ["Open portal", "Search order", "Escalate if delayed"] },
  ],
  checklist: ["Create demo account", "Load sample tickets"],
  companySizeAgents: { agents: "25 agents", estimated: true },
  businessContext: {
    market: "Manufacturing",
    model: "B2B direct",
    users: "Enterprise buyers",
    uptimeNeed: "Business hours",
    fundingParent: "Private equity",
    headOffice: "Chicago IL",
    languages: "English Spanish",
  },
  discoveryKit: [{ question: "How do you route urgent tickets?", because: "Routing gaps drive SLA misses" }],
  painCapabilityValue: [
    {
      pain: "Slow ticket routing",
      capability: "Auto-routing",
      values: ["Faster resolution", "Less manual routing"],
    },
    {
      pain: "No self-service deflection",
      capability: "KB widget",
      values: ["Fewer repeat contacts", "Higher deflection"],
    },
    {
      pain: "Fragmented installer comms",
      capability: "Omnichannel inbox",
      values: ["Single thread view", "Faster partner response"],
    },
  ],
  attendees: [{ name: "Jane Doe", role: "Support Director", decisionPower: "decision_maker" }],
  prospects: [
    {
      name: "Jane Doe",
      role: "Support Director",
      totalExperience: "12 years",
      priorEmployers: ["Globex", "Initech"],
      competitorTouchpoints: ["Zendesk admin"],
      sourceLabel: "S2",
      summary: "Seasoned support leader with multi-site operations experience.",
      skills: ["Leadership", "Zendesk"],
      discHint: {
        primary: "D",
        confidence: "medium",
        evidence: ["Led regional turnaround"],
        inferred: true,
      },
    },
    {
      name: "John Smith",
      role: "VP Customer Success",
      totalExperience: "18 years",
      priorEmployers: ["Acme Corp"],
      competitorTouchpoints: ["Intercom trials"],
      sourceLabel: "S3",
    },
  ],
  icpFit: {
    product: "Freshdesk Omni",
    verdict: "Moderate",
    score: 62,
    highlights: ["Multi-channel growth planned", "25+ agent team"],
    gaps: ["Confirm voice channel timeline", "Validate AI budget"],
    frameworkRefs: ["Winning Zone"],
  },
  sources: [
    { label: "S1", title: "Company website", url: "https://example.com", confidence: 85 },
    { label: "S2", title: "LinkedIn company", url: "https://linkedin.com", confidence: 72 },
    { label: "S3", title: "Job posting", url: "unknown", confidence: 45 },
  ],
  assets: [{ label: "Demo script", ext: "ENV", url: "https://example.com/sheet" }],
};

const meta = { company: "Endurance Doors", domain: "endurancedoors.com" };

const discovery = renderDiscoveryTab(sampleV8, false);
const discoveryMulti = renderDiscoveryTab(
  { ...sampleV8, prospects: [...sampleV8.prospects, sampleV8.prospects[1]] },
  false,
);
const discoveryMultiTab1 = renderDiscoveryTab(
  { ...sampleV8, prospects: [...sampleV8.prospects, sampleV8.prospects[1]] },
  false,
  { peopleProspectTab: "prospect-1" },
);
const demo = renderDemoTab(sampleV8, {}, "endurance-doors");
const header = renderResultHeader(sampleV8, meta);

const checks = [
  ["isV8Prep accepts v8 shape", isV8Prep(sampleV8)],
  ["isV7Prep accepts v8 shape", isV7Prep(sampleV8)],
  ["header has company name", header.includes("Endurance Doors")],
  ["header no prospect chip", !header.includes("prep-contact-chip")],
  ["discovery has Account facts", discovery.includes("Account facts")],
  ["discovery has Signals", discovery.includes("Signals")],
  ["discovery people section", discovery.includes("People on this call") && discovery.includes("prep-people-section")],
  ["discovery 2-column account grid", discovery.includes("prep-grid-2") && !discovery.includes("prep-grid-3")],
  ["discovery DISC in hero before details", (() => {
    const hero = discovery.indexOf("prep-prospect-hero");
    const details = discovery.indexOf("prep-prospect-details");
    const inferred = discovery.indexOf("Inferred from LinkedIn");
    return hero >= 0 && inferred > hero && (details < 0 || inferred < details);
  })()],
  ["discovery AI banner", discovery.includes("prep-ai-banner")],
  ["discovery ICP fitment", discovery.includes("ICP fitment")],
  ["discovery ICP collapsed details", discovery.includes("prep-icp-details")],
  ["discovery signal tooltips", discovery.includes("fw-tooltip")],
  ["discovery new AI signal label", discovery.includes("AI in their current tech stack")],
  ["discovery has source badges", discovery.includes("prep-src-badge")],
  ["discovery has Fit grid", discovery.includes("prep-fit-grid")],
  ["discovery prospect DISC inferred label", discovery.includes("Inferred from LinkedIn")],
  ["discovery prospect summary", discovery.includes("Seasoned support leader")],
  ["discovery people tabs when 2 prospects", discoveryMulti.includes("prep-people-tabs")],
  ["discovery people tab persists prospect-1", discoveryMultiTab1.includes('active-tab-name="prospect-1"')],
  ["discovery support JD full width", discovery.includes("prep-jd-full")],
  ["demo has checklist", demo.includes("Sandbox setup")],
  ["demo has script", demo.includes("Demo script")],
  ["demo rows match likely pains", (demo.match(/prep-script-row/g) || []).length === sampleV8.likelyPains.length],
  ["demo value bullets", demo.includes("prep-script-values")],
  ["demo no use cases", !demo.includes("prep-uc-grid")],
  ["confidence high band", confidenceMeta(85).word === "High"],
  ["confidence low band", confidenceMeta(40).word === "Low"],
  ["signal tooltips map complete", Object.keys(SIGNAL_TOOLTIPS).length === 6],
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
console.log(`\n${checks.length} precall render checks passed.`);
