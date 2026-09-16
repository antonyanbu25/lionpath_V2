import assert from "node:assert/strict";
import {
  truncateLinkedInText,
  linkedinProfileExportsForPayload,
  clearLinkedInAttachments,
  MAX_LINKEDIN_TEXT_CHARS,
} from "../prep-linkedin-pdf.js";

clearLinkedInAttachments();
assert.equal(linkedinProfileExportsForPayload(), undefined);

const long = "x".repeat(MAX_LINKEDIN_TEXT_CHARS + 100);
const { text, truncated } = truncateLinkedInText(long);
assert.equal(truncated, true);
assert.equal(text.length, MAX_LINKEDIN_TEXT_CHARS);

console.log("test-prep-linkedin-pdf.mjs: ok");
