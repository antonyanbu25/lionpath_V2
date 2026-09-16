/**
 * Unit tests for Pass 9 summary normalize helpers (no LLM).
 */
import { normalizeSummaryDraft } from "../src/postcall/summaries.ts";

const checks: [string, boolean][] = [];

const deal = normalizeSummaryDraft(
  {
    summary: "Acme is evaluating Freshdesk for ITSM after two discovery calls confirmed pain on routing.",
    sourceCallIds: ["call_abc", "call_def", ""],
  },
  320,
);
checks.push(
  ["deal summary extracted", deal.summary.includes("Freshdesk")],
  ["sourceCallIds trimmed", deal.sourceCallIds.length === 2],
  ["empty call id dropped", !deal.sourceCallIds.includes("")],
);

const account = normalizeSummaryDraft(
  {
    summary: "Cross-sell: Freshservice mentioned on one call with no follow-up. FD Omni remains primary pursuit.",
    sourceCallIds: ["call_abc"],
  },
  400,
);
checks.push(
  ["account summary extracted", account.summary.includes("Cross-sell")],
  ["account sourceCallIds", account.sourceCallIds[0] === "call_abc"],
);

const empty = normalizeSummaryDraft(null, 100);
checks.push(
  ["null input → empty summary", empty.summary === ""],
  ["null input → empty ids", empty.sourceCallIds.length === 0],
);

let failed = 0;
for (const [label, ok] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

if (failed) {
  console.error(`\n${failed}/${checks.length} failed`);
  process.exit(1);
}
console.log(`\n${checks.length} checks passed`);
