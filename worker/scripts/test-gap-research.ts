import assert from "node:assert/strict";
import { buildGapQueries } from "../src/prep/gap-research.ts";

const queries = buildGapQueries({
  companyName: "Acme",
  companyDomain: "acme.com",
  emails: ["alex@acme.com"],
  facts: [{ key: "Industry", value: "Retail", sourceLabel: "S1", category: "account" }],
});

assert.ok(queries.length >= 1);
assert.ok(queries.some((q) => q.includes("acme.com")));
assert.ok(queries.length <= 3);

const withProspect = buildGapQueries({
  companyName: "Acme",
  companyDomain: "acme.com",
  emails: ["alex@acme.com"],
  facts: [
    {
      key: "prospect:alex@acme.com:name",
      value: "Alex Smith",
      sourceLabel: "S1",
      category: "prospect",
    },
    { key: "Incumbent tool", value: "Zendesk", sourceLabel: "SE", category: "signal" },
  ],
});

assert.ok(withProspect.length <= 3);

console.log(`${withProspect.length + queries.length} gap-research checks passed.`);
