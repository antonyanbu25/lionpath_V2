/** Technical commit rollup merges prior deal calls with the current call snapshot. */
import assert from "node:assert/strict";
import {
  rollupTechnicalCommitFromHistoryRecords,
} from "../domain/history-deal-enrichment.js";
import { mergeTechnicalCommit } from "../domain/technical-commit-service.js";

const records = [
  {
    id: "call_old",
    timestamp: 1,
    result: {
      technicalCommit: {
        incumbent: "Legacy CRM",
        competitor: "OldVendor",
        status: "pending",
      },
    },
  },
  {
    id: "call_new",
    timestamp: 2,
    result: {
      technicalCommit: {
        incumbent: "Zendesk",
        identifiedRisk: "Skepticism about demo accuracy",
        status: "pending",
      },
    },
  },
];

const rolled = rollupTechnicalCommitFromHistoryRecords(records);
assert.equal(rolled.incumbent, "Zendesk", "newer call overrides incumbent when surfaced");
assert.equal(rolled.competitor, "OldVendor", "prior deal field preserved when not re-mentioned");
assert.equal(rolled.identifiedRisk, "Skepticism about demo accuracy", "new field from latest call");

const display = mergeTechnicalCommit(rolled, records[1].result.technicalCommit);
assert.equal(display.competitor, "OldVendor", "merge keeps deal history alongside call snapshot");

console.log("test-call-tc-merge: ok");
