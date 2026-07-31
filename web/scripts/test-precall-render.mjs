import {
  isV8Prep,
  isV7Prep,
  renderResultHeader,
  confidenceMeta,
  discInferredLabel,
  discConfidenceLabel,
  SIGNAL_TOOLTIPS,
  isSeNotesSource,
  countPopulatedSignals,
  resolveDisplayFacts,
  isLinkedInEnrichedProspect,
} from "../precall-render.js";
import { renderKnowTab, renderDemoPrepTab } from "../precall-brief-v9.js";
import { CUSTOMER_REFERENCE_BY_INDUSTRY } from "../customer-reference-links.js";

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
  assets: [
    { label: "Demo script", ext: "ENV", url: "https://example.com/sheet" },
    { label: "Customer reference", ext: "PPT", url: "https://example.com/old-customer-ref" },
    { label: "Slide pack", ext: "PPT", url: "https://example.com/slides" },
  ],
};

const meta = { company: "Endurance Doors", domain: "endurancedoors.com" };

const discovery = renderKnowTab(sampleV8, false);
const discoveryWithSeSignal = renderKnowTab(
  {
    ...sampleV8,
    signals: [
      { label: "Incumbent tool", value: "Zendesk", sourceLabel: "SE" },
      ...sampleV8.signals.slice(1),
    ],
  },
  false,
);
const discoveryWithUnverifiedSignal = renderKnowTab(
  {
    ...sampleV8,
    signals: [{ label: "Incumbent tool", value: "Made Up CRM", sourceLabel: "S3" }, ...sampleV8.signals.slice(1)],
  },
  false,
);
const discoveryWithEmptySignal = renderKnowTab(
  {
    ...sampleV8,
    signals: [{ label: "Incumbent tool", value: "—", sourceLabel: "S1" }, ...sampleV8.signals.slice(1)],
  },
  false,
);
const discoverySourcesOpen = renderKnowTab(sampleV8, true);
const discoveryMulti = renderKnowTab(
  { ...sampleV8, prospects: [...sampleV8.prospects, sampleV8.prospects[1]] },
  false,
);
const discoveryMultiTab1 = renderKnowTab(
  { ...sampleV8, prospects: [...sampleV8.prospects, sampleV8.prospects[1]] },
  false,
  { peopleProspectTab: "prospect-1" },
);
const demo = renderDemoPrepTab(sampleV8, {}, "endurance-doors");
const header = renderResultHeader(sampleV8, meta);

const discoveryKaia = renderKnowTab(
  {
    ...sampleV8,
    prospects: [
      {
        ...sampleV8.prospects[0],
        sourceLabel: "Kaia",
        discHint: {
          primary: "I",
          confidence: "medium",
          evidence: ["Asked detailed questions in meeting"],
          inferred: true,
          source: "kaia",
        },
      },
    ],
  },
  false,
  { kaiaFetched: true },
);
const discoveryMerged = renderKnowTab(
  {
    ...sampleV8,
    prospects: [
      {
        ...sampleV8.prospects[0],
        sourceLabel: "LinkedIn + Kaia",
        discHint: {
          primary: "D",
          confidence: "medium",
          evidence: ["Direct tone in Kaia call", "Leadership on LinkedIn"],
          inferred: true,
          source: "merged",
        },
      },
    ],
  },
  false,
);
const discoveryLinkedInProspect = renderKnowTab(
  {
    ...sampleV8,
    prospects: [
      {
        ...sampleV8.prospects[0],
        sourceLabel: "LinkedIn PDF",
        competitorTouchpoints: ["Zendesk admin"],
        discHint: {
          primary: "D",
          confidence: "medium",
          evidence: ["Leadership"],
          inferred: true,
          source: "linkedin_pdf",
        },
      },
    ],
  },
  false,
);
const discoveryLlmCompetitorHidden = renderKnowTab(
  {
    ...sampleV8,
    prospects: [
      {
        ...sampleV8.prospects[0],
        sourceLabel: "S2",
        competitorTouchpoints: ["Hallucinated Vendor"],
        discHint: { primary: "D", confidence: "medium", evidence: ["Guess"], inferred: true },
      },
    ],
  },
  false,
);

const checks = [
  ["isV8Prep accepts v8 shape", isV8Prep(sampleV8)],
  ["isV7Prep accepts v8 shape", isV7Prep(sampleV8)],
  ["header has company name", header.includes("Endurance Doors")],
  ["header no prospect chip", !header.includes("prep-contact-chip")],
  ["know tab has About the company", discovery.includes("About the company")],
  ["know tab has maturity chart", discovery.includes("Where they sit versus their industry")],
  ["know tab maturity axis labels", discovery.includes("Manual") && discovery.includes("AI-assisted")],
  ["know tab has support stack", discovery.includes("Their support stack")],
  ["know tab has unknowns gaps", discovery.includes("What we could not find")],
  ["know tab has Who is in the room", discovery.includes("Who is in the room")],
  ["know tab has signals accordion", discovery.includes("prep-signals-details") && discovery.includes("Tech stack &amp; signals")],
  ["know tab 2-column grid", discovery.includes("prep-v9-grid-2")],
  [
    "know tab section order stack unknowns attendees",
    discovery.indexOf("Their support stack") >= 0 &&
      discovery.indexOf("What we could not find") >= 0 &&
      discovery.indexOf("Who is in the room") >= 0 &&
      discovery.indexOf("Their support stack") < discovery.indexOf("What we could not find") &&
      discovery.indexOf("What we could not find") < discovery.indexOf("Who is in the room"),
  ],
  [
    "know tab maturity before discovery kit",
    discovery.indexOf("Where they sit versus their industry") >= 0 &&
      discovery.indexOf("Discovery kit") >= 0 &&
      discovery.indexOf("Where they sit versus their industry") < discovery.indexOf("Discovery kit"),
  ],
  ["know tab signals collapsed by default", discovery.includes("prep-signals-details") && !discovery.includes('class="prep-signals-details" open')],
  ["know tab signals grid layout", discovery.includes("prep-signals-grid") && discovery.includes("prep-signal-cell")],
  [
    "know tab section order jd kit extras",
    discovery.indexOf("prep-jd-full") < discovery.indexOf("Discovery kit") &&
      discovery.indexOf("Discovery kit") < discovery.indexOf("prep-research-extras") &&
      discovery.indexOf("Their support stack") < discovery.indexOf("prep-jd-full"),
  ],
  ["know tab support JD present", discovery.includes("prep-jd-full")],
  ["know tab research extras collapsed", discovery.includes("prep-research-extras") && !discovery.includes('class="prep-research-extras" open')],
  ["know tab research extras open when requested", discoverySourcesOpen.includes('class="prep-research-extras" open')],
  ["know tab no verbatim notes card", !renderKnowTab(sampleV8, false, { additionalContext: "AE says Zendesk incumbent" }).includes("prep-se-notes-card")],
  ["know tab no standalone sources accordion", !discovery.includes("prep-sources-card")],
  ["know tab about text", discovery.includes("prep-v9-about")],
  ["know tab fact fallback from businessContext", (() => {
    const html = renderKnowTab({
      ...sampleV8,
      facts: [{ key: "Company size", value: "unknown", sourceLabel: "S1" }],
      businessContext: { ...sampleV8.businessContext, users: "500 employees" },
    }, false);
    return html.includes("500 employees");
  })()],
  ["know tab attendee summary", discovery.includes("Seasoned support leader")],
  ["know tab single prospect", !discovery.includes("prep-people-tabs")],
  ["demo has checklist", demo.includes("Sandbox setup")],
  ["demo has call plan", demo.includes("Your call plan")],
  ["demo has demo moments", demo.includes("prep-v9-moment")],
  ["demo has sixty second hero", demo.includes("Sixty seconds before the call")],
  ["demo rows match pcv count", (demo.match(/class="prep-v9-moment"/g) || []).length === sampleV8.painCapabilityValue.length],
  ["demo value bullets", demo.includes("prep-v9-value-row")],
  ["demo no use cases", !demo.includes("prep-uc-grid")],
  ["demo assets title", demo.includes("Bring these")],
  ["isLinkedInEnrichedProspect matched email", isLinkedInEnrichedProspect(
    { sourceLabel: "S6" },
    { linkedinMatchedEmails: ["pat@acme.com"], prospectEmails: ["pat@acme.com"] },
    0,
  )],
  ["resolveDisplayFacts fills company size", resolveDisplayFacts({
    facts: [{ key: "Company size", value: "unknown" }],
    businessContext: { users: "200 staff" },
  })[0].value === "200 staff"],
  ["know tab empty signal not found", discoveryWithEmptySignal.includes("prep-signal-empty")],
  ["know tab linkedin competitor touchpoints shown", discoveryLinkedInProspect.includes("Zendesk admin")],
  ["know tab llm competitor touchpoints hidden", !discoveryLlmCompetitorHidden.includes("Hallucinated Vendor")],
  ["isSeNotesSource SE", isSeNotesSource("SE")],
  ["countPopulatedSignals", countPopulatedSignals(sampleV8.signals, sampleV8.sources) === 4],
  ["know tab AI banner", discovery.includes("prep-ai-banner")],
  ["know tab ICP fitment", discovery.includes("ICP fitment")],
  ["know tab kaia section note", discoveryKaia.includes("prep-kaia-result-note")],
  ["know tab DISC svg", discovery.includes("prep-v9-disc")],
  ["discConfidenceLabel low", discConfidenceLabel("low") === "Confident - Low"],
  ["discInferredLabel linkedin_pdf", discInferredLabel("linkedin_pdf").includes("LinkedIn PDF")],
  [
    "demo customer reference industry url",
    demo.includes(encodeURI(CUSTOMER_REFERENCE_BY_INDUSTRY.manufacturing)) ||
      demo.includes(CUSTOMER_REFERENCE_BY_INDUSTRY.manufacturing),
  ],
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
