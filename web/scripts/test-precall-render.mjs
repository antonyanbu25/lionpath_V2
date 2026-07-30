import {
  isV8Prep,
  isV7Prep,
  renderDiscoveryTab,
  renderDemoTab,
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

const discovery = renderDiscoveryTab(sampleV8, false);
const discoveryWithSeSignal = renderDiscoveryTab(
  {
    ...sampleV8,
    signals: [
      { label: "Incumbent tool", value: "Zendesk", sourceLabel: "SE" },
      ...sampleV8.signals.slice(1),
    ],
  },
  false,
);
const discoveryWithUnverifiedSignal = renderDiscoveryTab(
  {
    ...sampleV8,
    signals: [{ label: "Incumbent tool", value: "Made Up CRM", sourceLabel: "S3" }, ...sampleV8.signals.slice(1)],
  },
  false,
);
const discoveryWithEmptySignal = renderDiscoveryTab(
  {
    ...sampleV8,
    signals: [{ label: "Incumbent tool", value: "—", sourceLabel: "S1" }, ...sampleV8.signals.slice(1)],
  },
  false,
);
const discoverySourcesOpen = renderDiscoveryTab(sampleV8, true);
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

const discoveryKaia = renderDiscoveryTab(
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
const discoveryMerged = renderDiscoveryTab(
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
const discoveryLinkedInProspect = renderDiscoveryTab(
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
const discoveryLlmCompetitorHidden = renderDiscoveryTab(
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
  ["discovery has Account facts", discovery.includes("Account facts")],
  ["discovery has signals accordion", discovery.includes("prep-signals-details") && discovery.includes("Tech stack &amp; signals")],
  ["discovery people section", discovery.includes("People on this call") && discovery.includes("prep-people-section")],
  ["discovery 2-column account grid", discovery.includes("prep-grid-2") && !discovery.includes("prep-grid-3")],
  [
    "discovery people before signals",
    discovery.indexOf("People on this call") >= 0 &&
      discovery.indexOf("Tech stack &amp; signals") >= 0 &&
      discovery.indexOf("People on this call") < discovery.indexOf("Tech stack &amp; signals"),
  ],
  ["discovery signals collapsed by default", discovery.includes("prep-signals-details") && !discovery.includes('class="prep-signals-details" open')],
  ["discovery signals grid layout", discovery.includes("prep-signals-grid") && discovery.includes("prep-signal-cell")],
  ["discovery signals full width below grid", discovery.includes("prep-signals-section")],
  [
    "discovery section order jd fit kit extras",
    discovery.indexOf("prep-jd-full") < discovery.indexOf("prep-fit-grid") &&
      discovery.indexOf("prep-fit-grid") < discovery.indexOf("Discovery kit") &&
      discovery.indexOf("Discovery kit") < discovery.indexOf("prep-research-extras"),
  ],
  ["discovery support JD above fit", discovery.indexOf("prep-jd-full") < discovery.indexOf("prep-fit-grid")],
  ["discovery research extras collapsed", discovery.includes("prep-research-extras") && !discovery.includes('class="prep-research-extras" open')],
  ["discovery research extras open when requested", discoverySourcesOpen.includes('class="prep-research-extras" open')],
  ["discovery no verbatim notes card", !renderDiscoveryTab(sampleV8, false, { additionalContext: "AE says Zendesk incumbent" }).includes("prep-se-notes-card")],
  ["discovery no standalone sources accordion", !discovery.includes("prep-sources-card")],
  ["discovery about expandable", discovery.includes("prep-about") && !discovery.includes("prep-line-clamp-2")],
  ["discovery fact fallback from businessContext", (() => {
    const html = renderDiscoveryTab({
      ...sampleV8,
      facts: [{ key: "Company size", value: "unknown", sourceLabel: "S1" }],
      businessContext: { ...sampleV8.businessContext, users: "500 employees" },
    }, false);
    return html.includes("500 employees");
  })()],
  ["discovery linkedin about in hero", discovery.includes("prep-prospect-about") && discovery.includes("Seasoned support leader")],
  ["discovery hides competitor touchpoints without linkedin enrich", (() => {
    const html = renderDiscoveryTab({
      ...sampleV8,
      prospects: [{ ...sampleV8.prospects[1], competitorTouchpoints: ["Intercom trials"], sourceLabel: "S3" }],
    }, false);
    return !html.includes("Competitor touchpoints");
  })()],
  ["isLinkedInEnrichedProspect matched email", isLinkedInEnrichedProspect(
    { sourceLabel: "S6" },
    { linkedinMatchedEmails: ["pat@acme.com"], prospectEmails: ["pat@acme.com"] },
    0,
  )],
  ["resolveDisplayFacts fills company size", resolveDisplayFacts({
    facts: [{ key: "Company size", value: "unknown" }],
    businessContext: { users: "200 staff" },
  })[0].value === "200 staff"],
  ["discovery SE signal your notes badge", discoveryWithSeSignal.includes("prep-trust-notes") && discoveryWithSeSignal.includes("Your notes")],
  ["discovery empty signal not found", discoveryWithEmptySignal.includes("prep-signal-empty") && discoveryWithEmptySignal.includes("Not found")],
  ["discovery unverified signal not found", discoveryWithUnverifiedSignal.includes("prep-signal-empty") && !discoveryWithUnverifiedSignal.includes("Made Up CRM")],
  ["discovery linkedin competitor touchpoints shown", discoveryLinkedInProspect.includes("Zendesk admin")],
  ["discovery llm competitor touchpoints hidden", !discoveryLlmCompetitorHidden.includes("Hallucinated Vendor")],
  ["isSeNotesSource SE", isSeNotesSource("SE")],
  ["countPopulatedSignals", countPopulatedSignals(sampleV8.signals, sampleV8.sources) === 4],
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
  ["discovery kit reason without because prefix", !discovery.includes("prep-kit-because muted\">because ")],
  ["discovery prospect DISC inferred label fallback", discovery.includes("Inferred from LinkedIn, not a formal assessment")],
  ["discovery DISC confident label", discovery.includes("Confident - Medium")],
  ["discConfidenceLabel low", discConfidenceLabel("low") === "Confident - Low"],
  ["discInferredLabel linkedin_pdf", discInferredLabel("linkedin_pdf").includes("LinkedIn PDF")],
  ["discInferredLabel kaia", discInferredLabel("kaia").includes("Kaia meeting")],
  ["discInferredLabel merged", discInferredLabel("merged").includes("LinkedIn + Kaia")],
  ["discovery kaia DISC label", discoveryKaia.includes("Inferred from Kaia meeting")],
  ["discovery kaia source badge", discoveryKaia.includes('aria-label="Source Kaia"')],
  ["discovery kaia section note", discoveryKaia.includes("prep-kaia-result-note")],
  ["discovery merged DISC label", discoveryMerged.includes("Inferred from LinkedIn + Kaia")],
  ["discovery merged source badge", discoveryMerged.includes("LinkedIn + Kaia")],
  ["discovery prospect summary in profile details", discovery.includes("prep-prospect-details") && discovery.includes("Seasoned support leader")],
  ["discovery people tabs when 2 prospects", discoveryMulti.includes("prep-people-tabs")],
  ["discovery people tab persists prospect-1", discoveryMultiTab1.includes('active-tab-name="prospect-1"')],
  ["demo has checklist", demo.includes("Sandbox setup")],
  ["demo has script", demo.includes("Demo script")],
  ["demo rows match likely pains", (demo.match(/prep-script-row/g) || []).length === sampleV8.likelyPains.length],
  ["demo value bullets", demo.includes("prep-script-values")],
  ["demo no use cases", !demo.includes("prep-uc-grid")],
  ["demo deck title plain text", demo.includes("Deck and assets") && !demo.includes("Deck &amp; assets")],
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
