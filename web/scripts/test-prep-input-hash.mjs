import assert from "node:assert/strict";
import { computePrepInputHash } from "../prep-input-hash.js";
import { seNotesForEnrich } from "../prep-contact-enrich.js";

const h1 = computePrepInputHash("Acme", "acme.com", ["a@acme.com"], "", {
  additionalContext: "notes",
  kaiaMeetingUrl: "https://engage.freshworks.com/s/p_x",
});
const h2 = computePrepInputHash("Acme", "acme.com", ["a@acme.com"], "", {
  additionalContext: "notes",
  kaiaMeetingUrl: "https://engage.freshworks.com/s/p_y",
});
assert.notEqual(h1, h2, "kaia ref should affect hash");

const notes = seNotesForEnrich({
  additionalContext: "SE notes only\n\nKaia meeting summary:\nlong kaia block",
});
assert.equal(notes, "SE notes only");

console.log("test-prep-input-hash.mjs: ok");
