/**
 * Context field routing — support users vs employee headcount.
 *
 * Usage: tsx worker/scripts/test-context-field-router.ts
 */

import assert from "node:assert/strict";

import {
  applySeContextToFacts,
  classifyContextSnippet,
  extractSupportTeamValue,
  looksLikeSupportTeam,
  resolveCompanySizeValue,
  routeContextFields,
} from "../src/prep/context-field-router.ts";
import type { Prep } from "../src/schema.ts";

let checks = 0;
const eq = (a: unknown, b: unknown, m: string) => {
  assert.deepEqual(a, b, m);
  checks++;
};
const ok = (c: unknown, m: string) => {
  assert.ok(c, m);
  checks++;
};

function emptyPrep(overrides: Partial<Prep> = {}): Prep {
  return {
    description: "test",
    about: "test",
    incumbent: { incumbent_name: "unknown", displacement: "unknown" },
    fitSnapshot: [],
    facts: [],
    signals: [],
    supportJD: { title: "unknown", sourceLabel: "S1", bullets: [] },
    likelyPains: [],
    industryUseCases: [],
    checklist: [],
    companySizeAgents: { agents: "unknown", estimated: false },
    businessContext: {
      market: "unknown",
      model: "unknown",
      users: "unknown",
      uptimeNeed: "unknown",
      fundingParent: "unknown",
      headOffice: "unknown",
      languages: "unknown",
    },
    discoveryKit: [],
    painCapabilityValue: [],
    attendees: [],
    prospects: [],
    icpFit: { product: "Freshdesk", verdict: "unknown", score: 0, highlights: [], gaps: [], frameworkRefs: [] },
    sources: [{ label: "S1", title: "Web", url: "https://example.com", confidence: 80 }],
    ...overrides,
  };
}

{
  eq(classifyContextSnippet("support users 40-50"), "supportTeam", "support users phrase");
  eq(classifyContextSnippet("220 employees globally"), "companySize", "employee headcount");
  eq(classifyContextSnippet("customer volume 2M"), "endUserVolume", "end-user scale");
  eq(classifyContextSnippet("support team 12 agents"), "supportTeam", "support team phrase");
}

{
  eq(extractSupportTeamValue("They have support users 40-50 on Zendesk."), "40-50", "extract support range");
  ok(looksLikeSupportTeam("40-50 support users"), "detect misfiled support value");
}

{
  const notes = "Evaluating Freshdesk. support users 40-50. Zendesk incumbent.";
  const out = applySeContextToFacts(emptyPrep(), notes);
  eq(out.companySizeAgents?.agents, "40-50", "routes to companySizeAgents");
  eq(out.facts.find((f) => f.key === "Support team")?.value, "40-50", "Support team fact filled");
  ok(
    !resolveCompanySizeValue(out),
    "Company size not populated from support users",
  );
}

{
  const misfiled = emptyPrep({
    facts: [{ key: "Company size", value: "40-50 support users", sourceLabel: "SE" }],
    businessContext: {
      market: "unknown",
      model: "unknown",
      users: "40-50 support users",
      uptimeNeed: "unknown",
      fundingParent: "unknown",
      headOffice: "unknown",
      languages: "unknown",
    },
  });
  const out = routeContextFields(misfiled, "support users 40-50");
  eq(out.companySizeAgents?.agents, "40-50", "corrects misfiled agents");
  eq(out.facts.find((f) => f.key === "Company size")?.value, "unknown", "clears wrong Company size");
  eq(out.businessContext?.users, "unknown", "clears users field misused for support");
}

{
  const both = emptyPrep();
  const notes = "500 employees total. support users 40-50.";
  const out = applySeContextToFacts(both, notes);
  eq(out.facts.find((f) => f.key === "Company size")?.value, "500 employees", "employee count preserved");
  eq(out.facts.find((f) => f.key === "Support team")?.value, "40-50", "support count separate");
}

console.log(`test-context-field-router.ts: ok (${checks} checks)`);
