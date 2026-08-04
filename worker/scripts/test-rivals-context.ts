/**
 * Fish sizing from SE additional context — company metrics only, not deal requirements.
 *
 * Usage: tsx worker/scripts/test-rivals-context.ts
 */

import assert from "node:assert/strict";

import { filterFishContextMetrics } from "../src/prep/rivals-context.ts";

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
    { label: "Employees", value: "500 globally", aboutCompany: true },
    { label: "Employees", value: "500 globally", aboutCompany: true },
  ]);
  eq(out.length, 1, "duplicate metrics collapsed");
}

console.log(`test-rivals-context.ts: ok (${checks} checks)`);
