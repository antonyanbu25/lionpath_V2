/**
 * Run: tsx scripts/test-kaia-prospect-match.ts
 */

import assert from "node:assert/strict";
import { matchProspectKaiaExcerpt, prospectMatchesSpeaker } from "../src/kaia/matchProspectExcerpt.js";

const summaryJson = JSON.stringify([
  {
    type: "STRING",
    name: "Outcome",
    result: { stringOutput: "Discussed analytics upgrade options." },
  },
  {
    type: "LIST_KEY_POINTS",
    name: "Key points",
    result: {
      listKeyPoints: [
        {
          title: "Pricing",
          points: [
            {
              text: "Client asked for add-on pricing only.",
              sources: [{ speaker: { name: "eva.virgin" } }],
            },
            {
              text: "Rep offered to check with management.",
              sources: [{ speaker: { name: "Suresh Krishnan" } }],
            },
          ],
        },
      ],
    },
  },
]);

const bundle = {
  summary: "Full meeting summary fallback text.",
  title: "Acme Demo",
  startTime: "2026-07-21T10:00:00Z",
  participants: [{ displayName: "eva.virgin" }, { displayName: "Suresh Krishnan", isHost: true }],
  summaryJson,
};

assert.ok(prospectMatchesSpeaker("eva.virgin@acme.com", undefined, "eva.virgin"));
assert.ok(!prospectMatchesSpeaker("other@acme.com", undefined, "eva.virgin"));

const evaExcerpt = matchProspectKaiaExcerpt({ email: "eva.virgin@acme.com", bundle });
assert.ok(evaExcerpt.includes("Speaker-specific segments"));
assert.ok(evaExcerpt.includes("add-on pricing"));
assert.ok(!evaExcerpt.includes("check with management"));

const otherExcerpt = matchProspectKaiaExcerpt({ email: "unknown@acme.com", bundle });
assert.ok(otherExcerpt.includes("meeting-level summary"));

console.log("test-kaia-prospect-match: ok");
