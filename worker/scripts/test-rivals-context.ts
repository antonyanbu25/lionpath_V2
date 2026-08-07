/**
 * Fish sizing from SE additional context — company metrics only, not deal requirements.
 *
 * Usage: tsx worker/scripts/test-rivals-context.ts
 */

import assert from "node:assert/strict";

import {
  filterFishContextMetrics,
  fishContextSupplementMetrics,
  fishSizingFromResearchFacts,
  fishSizingFromPrepResult,
  buildFishSizingPromptContext,
  mergeFishContextSizing,
} from "../src/prep/rivals-context.ts";

let checks = 0;
const ok = (c: unknown, m: string) => {
  assert.ok(c, m);
  checks++;
};
const eq = (a: unknown, b: unknown, m: string) => {
  assert.deepEqual(a, b, m);
  checks++;
};

{
  const out = filterFishContextMetrics([
    { label: "Support agents", value: "120 agents", aboutCompany: true },
    { label: "Incumbent tool", value: "Zendesk", aboutCompany: false },
    { label: "Funding raised", value: "$80M Series C", aboutCompany: true },
  ]);
  eq(out.length, 2, "requirement rows dropped");
  eq(out[0].label, "Support agents", "company sizing kept");
}

{
  const out = filterFishContextMetrics([
    { label: "Integrations needed", value: "Salesforce CRM", aboutCompany: true },
    { label: "Timeline", value: "Q3 decision", aboutCompany: true },
  ]);
  eq(out.length, 0, "requirement phrasing rejected even when aboutCompany true");
}

{
  const out = filterFishContextMetrics([
    { label: "Support agents", value: "40-50", aboutCompany: true },
    { label: "Employees", value: "500 globally", aboutCompany: true },
  ]);
  eq(out.length, 2, "support agents and employees both kept when distinct");
  eq(out[0].label, "Support agents", "support agents label for support users count");
  ok(!out.some((m) => m.label === "Employees" && m.value === "40-50"), "support users not labeled Employees");
}

{
  const out = filterFishContextMetrics([
    { label: "Employees", value: "500 globally", aboutCompany: true },
    { label: "Employees", value: "500 globally", aboutCompany: true },
  ]);
  eq(out.length, 1, "duplicate metrics collapsed");
}

{
  const sup = fishContextSupplementMetrics(
    [
      { label: "Support agents", value: "500" },
      { label: "Customer base", value: "2M users" },
    ],
    [{ label: "Support agents", prospect: { display: "120", numeric: 120 } }],
  );
  eq(sup.length, 1, "drops axis with web prospect value");
  eq(sup[0].label, "Customer base", "keeps non-overlapping context metric");
}

{
  const sup = fishContextSupplementMetrics(
    [{ label: "Employees", value: "50" }],
    [{ label: "Employees", prospect: null }],
  );
  eq(sup.length, 1, "keeps INPUT when rival axis has no prospect value");
}

{
  const fromPrep = fishSizingFromPrepResult({
    facts: [
      { key: "Company size", value: "50", category: "signal", sourceLabel: "SE" },
      { key: "Support team", value: "unknown", category: "signal", sourceLabel: "SE" },
    ],
    companySizeAgents: { agents: "3 agents" },
    businessContext: { users: "50" },
  });
  ok(fromPrep?.metrics.length === 2, "post-synthesis prep yields partial fish metrics");
  eq(fromPrep?.metrics[0].label, "Employees", "company size from facts/context");
  eq(fromPrep?.metrics[1].label, "Support agents", "support from companySizeAgents");
}

{
  const merged = mergeFishContextSizing(
    { metrics: [{ label: "Support agents", value: "120" }], source: "context" },
    fishSizingFromPrepResult({
      facts: [{ key: "Company size", value: "500", category: "signal", sourceLabel: "S1" }],
      businessContext: { users: "500" },
    }),
  );
  eq(merged?.metrics.length, 2, "merge parallel fish with post-synthesis prep");
}

{
  const fromFacts = fishSizingFromResearchFacts([
    { key: "Company size", value: "500", category: "signal", sourceLabel: "S1" },
    { key: "Support team", value: "40 agents", category: "signal", sourceLabel: "S1" },
    { key: "Industry", value: "SaaS", category: "signal", sourceLabel: "S1" },
  ]);
  ok(fromFacts?.metrics.length === 3, "research facts map to fish metrics");
  eq(fromFacts?.metrics[0].label, "Employees", "company size maps to employees");
}

{
  const prompt = buildFishSizingPromptContext({
    companyName: "Acme",
    companyDomain: "acme.com",
    emails: ["buyer@acme.com"],
    facts: [{ key: "Company size", value: "500", category: "signal", sourceLabel: "S1" }],
    aeContext: "They have 120 support agents globally.",
  });
  ok(prompt.includes("Company: Acme"), "prompt includes company");
  ok(prompt.includes("Domain: acme.com"), "prompt includes domain");
  ok(prompt.includes("Employees: 500"), "prompt includes fact sizing");
  ok(prompt.includes("120 support agents"), "prompt includes AE notes");
}

{
  const merged = mergeFishContextSizing(
    fishSizingFromResearchFacts([
      { key: "Company size", value: "500", category: "signal", sourceLabel: "S1" },
    ]),
    { metrics: [{ label: "Support agents", value: "120" }], source: "context" },
  );
  eq(merged?.metrics.length, 2, "merge keeps distinct labels");
}

console.log(`test-rivals-context.ts: ok (${checks} checks)`);
