import {
  synthesizeExperienceSummary,
  validateProspectResearch,
  validateResearchContext,
} from "../src/research/validate.ts";
import type { PersonResearchFragment } from "../src/research/types.ts";

// --- synthesizeExperienceSummary ---
{
  const summary = synthesizeExperienceSummary({
    totalExperience: "12 years",
    role: "Director of Support",
    priorEmployers: ["Globex", "Initech"],
  });
  if (summary === "unknown") {
    console.error("FAIL: synthesize from years+role+employers");
    process.exit(1);
  }
  console.log("ok: synthesizeExperienceSummary from partial fields");
}

// --- validateProspectResearch: LinkedIn primary, ZoomInfo fallback merge ---
{
  const email = "alex@example.com";
  const fragments: PersonResearchFragment[] = [
    {
      source: "linkedin_search",
      email,
      name: "Alex Chen",
      role: "Director of Customer Support",
      totalExperience: "12 years",
      priorEmployers: ["Globex"],
      confidence: 72,
    },
    {
      source: "zoominfo",
      email,
      experienceSummary: "18 years enterprise SaaS support leadership",
      priorEmployers: ["Globex", "Umbrella Corp"],
      competitorTouchpoints: ["Zendesk"],
      confidence: 85,
    },
  ];
  const validated = validateProspectResearch(email, fragments, "R1");
  const checks: [string, boolean][] = [
    ["has name", validated.name !== "unknown"],
    ["has experienceSummary", validated.experienceSummary !== "unknown"],
    ["merged employers", validated.priorEmployers.length >= 2],
    ["competitor touchpoints", validated.competitorTouchpoints.includes("Zendesk")],
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
}

// --- validateResearchContext: prompt block includes experienceSummary ---
{
  const ctx = validateResearchContext(
    ["pat@acme.com"],
    [
      {
        source: "web_search",
        email: "pat@acme.com",
        role: "VP Support",
        totalExperience: "15 years",
        experienceSummary: "15 years B2B support leadership",
        confidence: 60,
      },
    ],
    [{ source: "company_web", snippets: ["Acme Corp support team"], confidence: 65 }],
  );
  if (!ctx.promptBlock.includes("experienceSummary")) {
    console.error("FAIL: prompt block missing experienceSummary");
    process.exit(1);
  }
  if (ctx.prospects[0]?.experienceSummary === "unknown") {
    console.error("FAIL: validated prospect missing experienceSummary");
    process.exit(1);
  }
  console.log("ok: validateResearchContext prompt block");
}

console.log("\nResearch orchestrator unit checks passed.");
