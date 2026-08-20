/**
 * Precall bug-fix eval — multiple regression cases for the 2.1.4 UX/data fixes.
 *
 * Plan items covered:
 *   1. Truncation UX (expand + tooltips)
 *   2. Generate CTA (darker brand button)
 *   3. Fish agent count guard (no billion/trillion on headcount)
 *   4. Recent news publishedAt (schema + render)
 *   5. Discovery kit / pain points tiles (no false hover lift)
 *
 * Usage: node web/scripts/test-precall-bug-fixes-eval.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseFishMetricValue,
  formatFishSizingDisplay,
  normalizeFishSizingMetrics,
  fishBucketFromMetric,
  FISH_METRIC_BOUNDS,
} from "../fish-sizing-buckets.js";
import { renderResultHeader } from "../precall-render.js";
import { renderKnowTab, renderDemoPrepTab } from "../precall-brief-v9.js";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(webDir, "precall.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const briefsListSrc = readFileSync(join(webDir, "briefs-list-view.js"), "utf8");
const accountPreviewSrc = readFileSync(join(webDir, "account-deal-preview.js"), "utf8");

let passed = 0;
let failed = 0;
const sections = [];

function caseOk(section, name, cond) {
  if (cond) {
    passed++;
    sections.push({ section, name, status: "pass" });
  } else {
    failed++;
    sections.push({ section, name, status: "fail" });
    console.error(`FAIL [${section}] ${name}`);
  }
}

function decl(source, selector, prop) {
  const re = new RegExp(
    `(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "m",
  );
  const m = source.match(re);
  assert.ok(m, `missing CSS rule: ${selector}`);
  const body = m[1];
  const dm = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "m"));
  assert.ok(dm, `${selector} missing "${prop}"`);
  return dm[1].trim();
}

const sampleV8 = {
  description: "B2B SaaS customer support platform for enterprise teams worldwide",
  about: "Endurance Doors manufactures commercial door systems.",
  fitSnapshot: [],
  facts: [],
  signals: [],
  likelyPains: ["Slow ticket routing"],
  discoveryKit: [{ question: "How do you route urgent tickets?", because: "Routing gaps" }],
  painCapabilityValue: [],
  attendees: [],
  prospects: [
    {
      name: "Jane Doe",
      role: "Support Director",
      sourceLabel: "LinkedIn PDF",
      summary: "Seasoned support leader with multi-site operations experience.",
      discHint: { primary: "D", confidence: "medium", source: "linkedin_pdf", dos: ["Lead with outcomes"], donts: ["Overwhelm with features"] },
    },
  ],
  sources: [{ label: "S1", title: "Website", url: "https://example.com", confidence: 85 }],
  recentNews: [],
  assets: [{ label: "Very long demo asset label that should truncate in the UI with ellipsis", ext: "PPT", url: "https://example.com/slides" }],
};

const meta = { company: "Endurance Doors", domain: "endurancedoors.com" };

// ---------------------------------------------------------------------------
// 3. Fish agent count guard
// ---------------------------------------------------------------------------
const FISH = "Fish agent count guard";

const fishParseCases = [
  ["8 agents literal", "8 agents", "supportAgents", 8],
  ["8 billion agents strips suffix", "8 billion agents", "supportAgents", 8],
  ["8B on supportAgents", "8B", "supportAgents", 8],
  ["8 bn on supportAgents", "8 bn", "supportAgents", 8],
  ["4 trillion on supportAgents", "4 trillion", "supportAgents", 4],
  ["raw 4e12 rejected", "4000000000000", "supportAgents", null],
  ["50 employees plain", "50", "employees", 50],
  ["500 globally employees", "500 globally", "employees", 500],
  ["2 Million funding", "2 Million", "funding", 2_000_000],
  ["$1.2B still parses on funding", "$1.2B", "funding", 1.2e9],
  ["8 billion rejected on employees", "8 billion", "employees", 8],
];

for (const [name, raw, type, expected] of fishParseCases) {
  caseOk(FISH, name, parseFishMetricValue(raw, type) === expected);
}

caseOk(FISH, "format absurd agents shows dash", formatFishSizingDisplay("supportAgents", "4000000000000") === "—");
caseOk(FISH, "format 8 billion agents shows 8", formatFishSizingDisplay("supportAgents", "8 billion agents") === "8");
caseOk(
  FISH,
  "normalize drops trillion agent row",
  normalizeFishSizingMetrics([{ label: "Support agents", value: "4000000000000" }]).length === 0,
);
caseOk(
  FISH,
  "normalize keeps valid agent row",
  normalizeFishSizingMetrics([{ label: "Support agents", value: "8 agents" }]).length === 1,
);
caseOk(FISH, "120 agents bucket index 2", fishBucketFromMetric("Support agents", "120 agents").bucketIndex === 2);
caseOk(FISH, "bounds supportAgents max 50k", FISH_METRIC_BOUNDS.supportAgents === 50_000);

const fishAbsurdHtml = renderKnowTab(
  {
    ...sampleV8,
    fishContext: {
      source: "context",
      metrics: [
        { label: "Employees", value: "11" },
        { label: "Support agents", value: "4000000000000" },
        { label: "Support agents", value: "8 billion agents" },
      ],
    },
  },
  false,
);
caseOk(FISH, "render hides absurd agent count", !fishAbsurdHtml.includes("4000000000000"));
caseOk(FISH, "render shows sane employee count", fishAbsurdHtml.includes("Employee count"));
caseOk(
  FISH,
  "render 8 billion agents displays as 8 not 8B",
  fishAbsurdHtml.includes(">8<") && !fishAbsurdHtml.includes("8 billion"),
);

// ---------------------------------------------------------------------------
// 2. Generate CTA
// ---------------------------------------------------------------------------
const CTA = "Generate CTA";

caseOk(CTA, "background uses dew-brand", decl(css, ".nb-generate-btn", "background") === "var(--dew-brand)");
caseOk(
  CTA,
  "hover uses dew-brand-hover",
  decl(css, ".nb-generate-btn:hover:not(:disabled)", "background") === "var(--dew-brand-hover)",
);
caseOk(
  CTA,
  "box-shadow uses brand tint",
  decl(css, ".nb-generate-btn", "box-shadow") === "0 2px 8px color-mix(in srgb, var(--dew-brand) 35%, transparent)",
);
caseOk(CTA, "height 50px", decl(css, ".nb-generate-btn", "height") === "50px");
caseOk(CTA, "not using dew-primary for background", decl(css, ".nb-generate-btn", "background") !== "var(--dew-primary)");

// ---------------------------------------------------------------------------
// 1. Truncation UX
// ---------------------------------------------------------------------------
const TRUNC = "Truncation UX";

const headerHtml = renderResultHeader(sampleV8, meta);
caseOk(
  TRUNC,
  "prep-desc title has full description",
  headerHtml.includes('class="prep-desc muted" title="B2B SaaS customer support platform for enterprise teams worldwide"'),
);

const longSummary = `${"Experienced operator. ".repeat(20).trim()}`;
caseOk(TRUNC, "long summary fixture exceeds 220 chars", longSummary.length > 220);

const attendeeExpandHtml = renderKnowTab(
  {
    ...sampleV8,
    prospects: [{ ...sampleV8.prospects[0], summary: longSummary, email: "jane@endurancedoors.com" }],
  },
  false,
  { linkedinMatchedEmails: ["jane@endurancedoors.com"], prospectEmails: ["jane@endurancedoors.com"] },
);
caseOk(TRUNC, "long attendee summary uses details", attendeeExpandHtml.includes('class="prep-prospect-details prep-v9-attendee-summary-details"'));
caseOk(TRUNC, "long attendee summary has full text in body", attendeeExpandHtml.includes("prep-v9-attendee-summary-full") && attendeeExpandHtml.includes(longSummary.slice(0, 40)));

const shortAttendeeHtml = renderKnowTab(sampleV8, false, {
  linkedinMatchedEmails: ["jane@endurancedoors.com"],
  prospectEmails: ["jane@endurancedoors.com"],
});
caseOk(
  TRUNC,
  "short summary renders plain paragraph not details",
  shortAttendeeHtml.includes('class="prep-v9-attendee-summary"') && !shortAttendeeHtml.includes("prep-v9-attendee-summary-details"),
);

const demoHtml = renderDemoPrepTab({ ...sampleV8, painCapabilityValue: sampleV8.painCapabilityValue }, false);
caseOk(
  TRUNC,
  "demo asset label has title tooltip",
  demoHtml.includes('class="prep-v9-asset-label" title="Very long demo asset label'),
);

caseOk(TRUNC, "brief list row title has tooltip attr", /brief-list-row-title" title="\$\{esc\(row\.company\)\}"/.test(briefsListSrc));
caseOk(TRUNC, "account card name has tooltip attr", /nb-account-card-name" title="\$\{esc\(displayName\)\}"/.test(accountPreviewSrc));
caseOk(TRUNC, "deal card title has tooltip attr", /nb-deal-card-title" title="\$\{esc\(titleCaseDisplayName/.test(accountPreviewSrc));

// ---------------------------------------------------------------------------
// 4. Recent news publishedAt
// ---------------------------------------------------------------------------
const NEWS = "Recent news publishedAt";

const newsIsoHtml = renderKnowTab(
  {
    ...sampleV8,
    recentNews: [
      {
        headline: "Series B funding",
        detail: "Raised $45M",
        sourceLabel: "N1",
        articleUrl: "https://techcrunch.com/acme",
        publishedAt: "2026-03-12",
      },
    ],
    newsSources: [{ label: "N1", domain: "techcrunch.com", url: "https://techcrunch.com/acme", title: "TechCrunch" }],
  },
  false,
);
caseOk(NEWS, "ISO date renders prep-v9-news-date", newsIsoHtml.includes("prep-v9-news-date"));
caseOk(NEWS, "ISO date formats as 12 Mar 2026", newsIsoHtml.includes("12 Mar 2026"));

const newsHumanHtml = renderKnowTab(
  {
    ...sampleV8,
    recentNews: [{ headline: "Office opening", detail: "Berlin site", sourceLabel: "N1", publishedAt: "H2 2026" }],
    newsSources: [{ label: "N1", domain: "reuters.com", url: "https://reuters.com", title: "Reuters" }],
  },
  false,
);
caseOk(NEWS, "human publishedAt passthrough when unparseable", newsHumanHtml.includes("H2 2026"));

const newsLegacyHtml = renderKnowTab(
  {
    ...sampleV8,
    recentNews: [{ headline: "Legacy item", detail: "No date field", sourceLabel: "N1" }],
    newsSources: [{ label: "N1", domain: "reuters.com", url: "https://reuters.com", title: "Reuters" }],
  },
  false,
);
caseOk(NEWS, "missing publishedAt omits date span", !newsLegacyHtml.includes("prep-v9-news-date"));

caseOk(NEWS, "css defines prep-v9-news-date", css.includes(".prep-v9-news-date"));

// ---------------------------------------------------------------------------
// 5. Tile interactivity (Discovery kit + Likely pain points)
// ---------------------------------------------------------------------------
const TILES = "Tile interactivity";

const knowHtml = renderKnowTab(sampleV8, false);
caseOk(TILES, "know tab has prep-grid-kit", knowHtml.includes("prep-grid-kit"));
caseOk(TILES, "know tab has Discovery kit", knowHtml.includes("Discovery kit"));
caseOk(TILES, "know tab has Likely pain points", knowHtml.includes("Likely pain points"));
caseOk(TILES, "grid kit uses fw-card prep-card", knowHtml.includes('<fw-card class="prep-card">') || knowHtml.includes('fw-card class="prep-card"'));

caseOk(TILES, "css disables hover transform on grid kit cards", decl(css, "#prep-result-view .prep-grid-kit fw-card.prep-card:hover", "transform") === "none");
caseOk(TILES, "css disables hover box-shadow on grid kit cards", decl(css, "#prep-result-view .prep-grid-kit fw-card.prep-card:hover", "box-shadow") === "none");
caseOk(
  TILES,
  "css sets surface-hover on grid kit hover",
  decl(css, "#prep-result-view .prep-grid-kit fw-card.prep-card:hover", "background") === "var(--surface-hover)",
);
caseOk(TILES, "css cursor default on grid kit cards", decl(css, "#prep-result-view .prep-grid-kit fw-card.prep-card", "cursor") === "default");
caseOk(TILES, "dead unknown-add button CSS removed", !/\.prep-v9-unknown-add[^a-z-]/.test(css));

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const sectionCounts = {};
for (const s of sections) {
  sectionCounts[s.section] ??= { pass: 0, fail: 0 };
  if (s.status === "pass") sectionCounts[s.section].pass++;
  else sectionCounts[s.section].fail++;
}

console.log("\nPrecall bug-fix eval summary");
console.log("=".repeat(40));
for (const [name, counts] of Object.entries(sectionCounts)) {
  console.log(`${name}: ${counts.pass} passed${counts.fail ? `, ${counts.fail} FAILED` : ""}`);
}
console.log("-".repeat(40));
console.log(`Total: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}

console.log("\nPrecall bug-fix eval: ok");
