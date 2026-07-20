import assert from "node:assert/strict";
import { matchPdfToProspect, normalizeLinkedInExports, findEmailsInText } from "../src/prep/linkedin-pdf.js";

const sampleExcerpt = `
Contact
karthikmuthiah.sk@gmail.com
www.linkedin.com/in/karthik-muthiah-869384167 (LinkedIn)
Karthik Muthiah
Solution Engineering @ Freshworks Inc.
`;

assert.ok(findEmailsInText(sampleExcerpt).includes("karthikmuthiah.sk@gmail.com"));

const matched = matchPdfToProspect(sampleExcerpt, [
  "diamelsys.villarroel@einhell.com",
  "karthikmuthiah.sk@gmail.com",
]);
assert.equal(matched, "karthikmuthiah.sk@gmail.com");

const noMatch = matchPdfToProspect(sampleExcerpt, ["other@acme.com"]);
assert.equal(noMatch, null);

const normalized = normalizeLinkedInExports([
  { fileName: "Profile.pdf", text: sampleExcerpt },
  { fileName: "empty.pdf", text: "short" },
]);
assert.equal(normalized.length, 1);
assert.equal(normalized[0].fileName, "Profile.pdf");

console.log("test-linkedin-pdf-match: ok");
