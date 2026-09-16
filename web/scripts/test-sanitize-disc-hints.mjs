import assert from "node:assert/strict";
import { sanitizeIncompleteDiscHints } from "../prep-contact-enrich.js";

const stale = {
  prospects: [
    {
      name: "Rick",
      discHint: {
        primary: "D",
        dos: ["Focus on ROI", "Present data"],
        donts: [],
      },
    },
    {
      name: "Jane",
      discHint: {
        primary: "C",
        dos: ["Be precise"],
        donts: ["Avoid fluff", "Skip small talk", "No hype"],
      },
    },
  ],
};

const out = sanitizeIncompleteDiscHints(stale);
assert.deepEqual(out.prospects[0].discHint.dos, []);
assert.equal(out.prospects[0].discHint.donts.length, 0);
assert.equal(out.prospects[1].discHint.donts.length, 3);

console.log("test-sanitize-disc-hints: ok");
