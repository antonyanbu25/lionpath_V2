/**
 * Offline scenario matrix for "How big is this fish?" — INPUT vs grounded rivals fallback.
 * Usage: node web/scripts/test-fish-sizing-scenarios.mjs
 */

import { renderKnowTab } from "../precall-brief-v9.js";

const MINIMAL_PREP = {
  description: "B2B SaaS",
  about: "Synthetic test company for fish sizing scenarios.",
  fitSnapshot: [
    { label: "Channel coverage", thisCompany: "Email", industryNorm: "Omnichannel", gap: "large", gapVerdict: "Behind" },
    { label: "Routing", thisCompany: "Manual", industryNorm: "Skill-based", gap: "large", gapVerdict: "Behind" },
    { label: "Reporting & analytics", thisCompany: "Spreadsheets", industryNorm: "Dashboards", gap: "partial", gapVerdict: "Partial" },
    { label: "AI adoption", thisCompany: "None", industryNorm: "Copilot tools", gap: "parity", gapVerdict: "Aligned" },
  ],
  facts: [],
  signals: [],
  sources: [{ label: "S1", title: "Example", url: "https://example.com", confidence: 80 }],
};

const RIVALS_WEB = {
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
      prospect: { display: "500", numeric: 500, sourceLabel: "R1" },
      verdict: "within",
      sourcedCount: 2,
    },
    {
      id: "fundingRaised",
      label: "Funding raised",
      min: { numeric: 120_000_000, display: "$120M", rivalName: "Alpha Co" },
      max: { numeric: 450_000_000, display: "$450M", rivalName: "Beta Co" },
      prospect: { display: "$80M", numeric: 80_000_000, sourceLabel: "R2" },
      verdict: "within",
      sourcedCount: 2,
    },
  ],
  sources: [
    { label: "R1", domain: "reuters.com", url: "https://reuters.com/a", title: "Reuters" },
    { label: "R2", domain: "techcrunch.com", url: "https://techcrunch.com/b", title: "TechCrunch" },
  ],
  dropped: [],
};

const SCENARIOS = {
  contextOnly: {
    prep: {
      ...MINIMAL_PREP,
      rivals: undefined,
      fishContext: {
        source: "context",
        metrics: [
          { label: "Employees", value: "50" },
          { label: "Support agents", value: "3 agents" },
          { label: "Funding raised", value: "2 Million" },
        ],
      },
    },
    expect: {
      rowCount: 3,
      labels: ["Employee count", "Agent count", "Funding"],
      values: ["50", "3", "$2M"],
      inputCount: 3,
      webCount: 0,
      note: "not verified on the web",
      empty: false,
    },
  },
  rivalsOnly: {
    prep: {
      ...MINIMAL_PREP,
      rivals: RIVALS_WEB,
      fishContext: undefined,
    },
    expect: {
      rowCount: 2,
      labels: ["Agent count", "Funding"],
      values: ["500", "$80M"],
      inputCount: 0,
      webCount: 2,
      note: "Web-sourced rival ranges",
      empty: false,
    },
  },
  mixedPriority: {
    prep: {
      ...MINIMAL_PREP,
      rivals: RIVALS_WEB,
      fishContext: {
        source: "context",
        metrics: [
          { label: "Employees", value: "50" },
          { label: "Support agents", value: "120 agents" },
          { label: "Funding raised", value: "2 Million" },
        ],
      },
    },
    expect: {
      rowCount: 3,
      labels: ["Employee count", "Agent count", "Funding"],
      values: ["50", "500", "$80M"],
      inputCount: 1,
      webCount: 2,
      note: "Web-sourced rival ranges",
      empty: false,
      agentWebNotInput: true,
    },
  },
  empty: {
    prep: {
      ...MINIMAL_PREP,
      rivals: undefined,
      fishContext: undefined,
    },
    expect: {
      rowCount: 0,
      empty: true,
      emptyCopy: "We could not size this account",
    },
  },
};

function fishSection(html) {
  const title = "How big is this fish?";
  const start = html.indexOf(title);
  if (start < 0) return "";
  const markers = ["Their support stack", "What we could not find", "Recent news"];
  let end = html.length;
  for (const m of markers) {
    const i = html.indexOf(m, start + title.length);
    if (i >= 0 && i < end) end = i;
  }
  return html.slice(start, end);
}

function countMatches(html, re) {
  return (html.match(re) || []).length;
}

function assert(name, ok) {
  if (!ok) {
    console.error("FAIL:", name);
    process.exitCode = 1;
  } else {
    console.log("ok:", name);
  }
}

function runScenario(id, { prep, expect }) {
  const html = renderKnowTab(prep, false);
  const fish = fishSection(html);

  if (expect.empty) {
    assert(`${id}: empty state`, fish.includes(expect.emptyCopy));
    assert(`${id}: no bucket rows`, !fish.includes("prep-v9-benchmark-bucketed"));
    return {
      scenario: id,
      rows: 0,
      sources: "none",
      note: "empty",
    };
  }

  const bucketRows = countMatches(fish, /prep-v9-benchmark-bucketed/g);
  assert(`${id}: row count`, bucketRows === expect.rowCount);

  for (const label of expect.labels) {
    assert(`${id}: label ${label}`, fish.includes(label));
  }
  for (const value of expect.values) {
    assert(`${id}: value ${value}`, fish.includes(value));
  }

  const inputCount = countMatches(fish, /prep-v9-src-input/g);
  const webBadgeCount = countMatches(fish, /class="prep-v9-src" title=/g);

  assert(`${id}: INPUT badge count`, inputCount === expect.inputCount);
  assert(`${id}: web badge count`, webBadgeCount === expect.webCount);
  assert(`${id}: footer note`, fish.includes(expect.note));

  assert(`${id}: no Industry row`, !fish.includes("Software licenses") && !/Industry<\/span>/.test(fish));
  assert(`${id}: no millions USD footnote`, !fish.includes("millions USD"));
  assert(`${id}: funding buckets use $M`, !expect.labels.includes("Funding") || fish.includes("$0–1M"));

  if (expect.agentWebNotInput) {
    const agentBlock = fish.split("Agent count")[1]?.split("Funding")[0] || "";
    assert(`${id}: rivals win for agents`, agentBlock.includes(">500<") && agentBlock.includes('class="prep-v9-src"'));
    assert(`${id}: agents not INPUT when rivals present`, !agentBlock.includes("prep-v9-src-input"));
  }

  const sourceSummary =
    expect.inputCount && expect.webCount
      ? `INPUT×${expect.inputCount}+web×${expect.webCount}`
      : expect.inputCount
        ? `INPUT×${expect.inputCount}`
        : `web×${expect.webCount}`;

  return {
    scenario: id,
    rows: expect.rowCount,
    sources: sourceSummary,
    note: expect.note.includes("not verified") ? "context-only" : "mixed/web",
  };
}

const summary = [];
for (const [id, scenario] of Object.entries(SCENARIOS)) {
  summary.push(runScenario(id, scenario));
}

console.log("\nFish sizing scenario summary:");
console.log("scenario          | rows | sources              | note");
for (const row of summary) {
  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    `${pad(row.scenario, 17)} | ${pad(row.rows, 4)} | ${pad(row.sources, 20)} | ${row.note}`,
  );
}

if (process.exitCode) {
  console.error("\nFish sizing scenario tests failed.");
  process.exit(1);
}
console.log("\nFish sizing scenario tests passed.");
