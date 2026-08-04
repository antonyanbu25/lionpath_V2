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
  // The four fixed axes, in FIT_LABELS order. thisCompany is still in the payload (other
  // consumers keyword-match on it) but must never reach the chart as a sublabel.
  fitSnapshot: [
    { label: "Channel coverage", thisCompany: "Email only", industryNorm: "Omnichannel", gap: "large", gapVerdict: "Behind" },
    { label: "Routing", thisCompany: "Manual triage", industryNorm: "Skill-based", gap: "large", gapVerdict: "Behind" },
    { label: "Reporting & analytics", thisCompany: "Spreadsheets", industryNorm: "Dashboards", gap: "partial", gapVerdict: "Partial" },
    { label: "AI adoption", thisCompany: "None", industryNorm: "Copilot tools", gap: "parity", gapVerdict: "Aligned" },
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
      sourceLabel: "LinkedIn PDF",
      summary: "Seasoned support leader with multi-site operations experience.",
      skills: ["Leadership", "Zendesk"],
      discHint: {
        primary: "D",
        confidence: "medium",
        evidence: ["Led regional turnaround"],
        inferred: true,
        source: "linkedin_pdf",
        dos: ["Lead with outcomes, not process"],
        donts: ["Overwhelm with feature lists"],
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
  recentNews: [
    { headline: "Series B funding", detail: "Raised $45M led by Accel", sourceLabel: "N1", articleUrl: "https://techcrunch.com/acme-series-b" },
    { headline: "Plant expansion", detail: "Opened a second Midwest facility", sourceLabel: "N2" },
  ],
  newsSources: [
    { label: "N1", domain: "techcrunch.com", url: "https://techcrunch.com/acme-series-b", title: "TechCrunch" },
    { label: "N2", domain: "reuters.com", url: "https://reuters.com/acme-plant", title: "Reuters" },
  ],
  rivals: {
    rivals: [
      { name: "Alpha Co", why: "same segment", sourceLabel: "R1", values: {} },
      { name: "Beta Co", why: "same segment", sourceLabel: "R2", values: {} },
    ],
    axes: [
      {
        id: "supportAgents",
        label: "Support agents",
        min: { numeric: 300, display: "300", rivalName: "Alpha Co" },
        max: { numeric: 900, display: "900", rivalName: "Beta Co" },
        prospect: { display: "500", numeric: 500, sourceLabel: "S1" },
        verdict: "within",
        sourcedCount: 2,
      },
      {
        id: "fundingRaised",
        label: "Funding raised",
        min: { numeric: 120, display: "$120M", rivalName: "Alpha Co" },
        max: { numeric: 450, display: "$450M", rivalName: "Beta Co" },
        sourcedCount: 2,
      },
    ],
    sources: [{ label: "R1", domain: "reuters.com", url: "https://reuters.com", title: "Reuters" }],
    dropped: [],
  },
  assets: [
    { label: "Demo script", ext: "SHEET", url: "https://example.com/sheet" },
    { label: "Customer reference", ext: "PPT", url: "https://example.com/old-customer-ref" },
    { label: "Slide pack", ext: "PPT", url: "https://example.com/slides" },
  ],
};

const meta = { company: "Endurance Doors", domain: "endurancedoors.com" };

const discovery = renderKnowTab(sampleV8, false);
const discoveryFishContext = renderKnowTab(
  {
    ...sampleV8,
    rivals: undefined,
    fishContext: {
      source: "context",
      metrics: [
        { label: "Support agents", value: "120 agents" },
        { label: "Funding raised", value: "$80M Series C" },
      ],
    },
  },
  false,
);
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
const discoveryLinkedInSource = renderKnowTab(
  {
    ...sampleV8,
    sources: [
      { label: "S1", title: "Company website", url: "https://example.com", confidence: 85 },
      { label: "LinkedIn PDF", title: "LinkedIn PDF export", url: "linkedin-pdf:upload", confidence: 90 },
      { label: "S2", title: "LinkedIn company", url: "https://linkedin.com", confidence: 72 },
    ],
  },
  true,
);
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
  ["know tab has no signals accordion", !discovery.includes("prep-signals-details") && !discovery.includes("Tech stack &amp; signals")],
  ["know tab 2-column grid", discovery.includes("prep-v9-grid-2")],
  [
    "know tab section order stack unknowns attendees",
    discovery.indexOf("Their support stack") >= 0 &&
      discovery.indexOf("What we could not find") >= 0 &&
      discovery.indexOf("Who is in the room") >= 0 &&
      discovery.indexOf("Their support stack") < discovery.indexOf("Who is in the room") &&
      discovery.indexOf("What we could not find") < discovery.indexOf("Who is in the room"),
  ],
  [
    "know tab three paired grid rows",
    (discovery.match(/prep-v9-grid-2/g) || []).length === 3,
  ],
  [
    "know tab fish before support stack",
    discovery.indexOf("How big is this fish?") >= 0 &&
      discovery.indexOf("Their support stack") > discovery.indexOf("How big is this fish?"),
  ],
  [
    "know tab maturity before discovery kit",
    discovery.indexOf("Where they sit versus their industry") >= 0 &&
      discovery.indexOf("Discovery kit") >= 0 &&
      discovery.indexOf("Where they sit versus their industry") < discovery.indexOf("Discovery kit"),
  ],
  ["know tab renders Do/Dont for linkedin prospect", discovery.includes("prep-v9-beh-do") && discovery.includes("prep-v9-beh-dont")],
  ["know tab thin attendee without linkedin", discovery.includes("prep-v9-attendee-thin")],
  ["know tab kaia-only prospect has no disc grid", !discoveryKaia.includes("prep-v9-disc") && discoveryKaia.includes("prep-v9-attendee-thin")],
  [
    "know tab section order jd kit extras",
    discovery.indexOf("prep-jd-full") < discovery.indexOf("Discovery kit") &&
      discovery.indexOf("Discovery kit") < discovery.indexOf("prep-research-extras") &&
      discovery.indexOf("Their support stack") < discovery.indexOf("prep-jd-full"),
  ],
  ["know tab support JD present", discovery.includes("prep-jd-full")],
  ["know tab research extras collapsed", discovery.includes("prep-research-extras") && !discovery.includes('class="prep-research-extras" open')],
  ["know tab research extras open when requested", discoverySourcesOpen.includes('class="prep-research-extras" open')],
  [
    "know tab research extras linkedin pdf row",
    discoveryLinkedInSource.includes('class="prep-source-label">LinkedIn PDF</span>') &&
      discoveryLinkedInSource.includes('class="prep-source-title">LinkedIn PDF export</span>'),
  ],
  ["know tab no verbatim notes card", !renderKnowTab(sampleV8, false, { additionalContext: "AE says Zendesk incumbent" }).includes("prep-se-notes-card")],
  ["know tab no standalone sources accordion", !discovery.includes("prep-sources-card")],
  ["know tab about text", discovery.includes("prep-v9-about")],
  ["know tab recent news from research", discovery.includes("Series B funding") && discovery.includes("Plant expansion")],
  ["know tab recent news article link", discovery.includes('class="prep-v9-news-link"') && discovery.includes("techcrunch.com/acme-series-b")],
  ["know tab fish context from ae notes", discoveryFishContext.includes("120 agents") && discoveryFishContext.includes("prep-v9-benchmark-bar") && discoveryFishContext.includes("prep-v9-src-input")],
  ["know tab recent news not signals", !discovery.includes("Incumbent tool:") || !discovery.match(/Recent news[\s\S]*Incumbent tool:/i)],
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
  ["know tab maturity chart animate hook", discovery.includes('data-prep-v9-animate="maturity-chart"')],
  // Fixed axes: all four render, every brief, so two briefs compare like for like.
  ["know tab renders all four fixed axes", ["Channel coverage", "Routing", "Reporting &amp; analytics", "AI adoption"].every((a) => discovery.includes(a))],
  // The GAP column is gone. Asserting its absence, because nothing asserted its presence and its
  // removal was therefore invisible to this suite.
  ["know tab has no GAP column", !discovery.includes("prep-v9-gap-pill") && !discovery.includes("prep-v9-maturity-gap-label")],
  // No free-text sublabel under an axis — that is what drifted to "Digital banking".
  ["know tab axis has no prose sublabel", !discovery.includes("prep-v9-maturity-them ")],
  ["know tab axis sublabel text absent", !discovery.includes("Manual triage") && !discovery.includes("Spreadsheets")],
  // Fixed channel vocabulary: the six always render, and nothing that is not a channel does.
  ["support stack renders the six fixed channels", ["Email", "Chat", "Voice", "Social", "WhatsApp", "Self-serve"].every((c) => discovery.includes(`>${c}</div>`))],
  // Scoped to stack-box chips. These signal VALUES legitimately appear in the tech-stack
  // accordion as <div class="prep-signal-val">, so a bare `>text</div>` check would match there
  // too — the point is only that they must never become channel chips, as "Live chat active" did.
  ["support stack invents no channel chips", !/prep-v9-stack-box[^>]*>Live chat enabled</.test(discovery) && !/prep-v9-stack-box[^>]*>Zendesk Help Center</.test(discovery)],
  // The fixed Freshworks pitch is gone; only the actionable thin-incumbent prompt may remain.
  ["support stack drops the consolidation pitch", !discovery.includes("a consolidation story, not an add-on")],
  ["demo hero animate hook", demo.includes('data-prep-v9-animate="hero-panel"')],
  ["demo call plan animate hook", demo.includes('data-prep-v9-animate="call-plan"')],
  ["know tab disc animate hook", discovery.includes('data-prep-v9-animate="disc-chart"')],
  ["demo has demo moments", demo.includes("prep-v9-moment")],
  ["demo has sixty second hero", demo.includes("Sixty seconds before the call")],
  ["demo rows match pcv count", (demo.match(/class="prep-v9-moment"/g) || []).length === sampleV8.painCapabilityValue.length],
  ["demo value bullets", demo.includes("prep-v9-value-row")],
  ["demo no use cases", !demo.includes("prep-uc-grid")],
  ["demo assets title", demo.includes("Assets")],
  ["isLinkedInEnrichedProspect matched email", isLinkedInEnrichedProspect(
    { sourceLabel: "S6" },
    { linkedinMatchedEmails: ["pat@acme.com"], prospectEmails: ["pat@acme.com"] },
    0,
  )],
  ["resolveDisplayFacts fills company size", resolveDisplayFacts({
    facts: [{ key: "Company size", value: "unknown" }],
    businessContext: { users: "200 staff" },
  })[0].value === "200 staff"],
  ["know tab linkedin-only disc count", (discovery.match(/class="prep-v9-disc"/g) || []).length === 1 && (discovery.match(/prep-v9-attendee-thin/g) || []).length === 1],
  ["know tab linkedin competitor touchpoints shown", discoveryLinkedInProspect.includes("Zendesk admin")],
  ["know tab llm competitor touchpoints hidden", !discoveryLlmCompetitorHidden.includes("Hallucinated Vendor")],
  ["isSeNotesSource SE", isSeNotesSource("SE")],
  ["countPopulatedSignals", countPopulatedSignals(sampleV8.signals, sampleV8.sources) === 4],
  ["know tab AI banner absent", !discovery.includes("prep-ai-banner")],
  ["know tab ICP fitment absent", !discovery.includes("ICP fitment") && !discovery.includes("prep-v9-icp-card")],
  ["know tab maturity pastel band color", discovery.includes("#e8c4bd") || discovery.includes("#eddcbb")],
  ["know tab fish benchmark bar", discovery.includes("prep-v9-benchmark-bar")],
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
