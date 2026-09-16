import assert from "node:assert/strict";
import {
  assignPdfsToEmails,
  extractNameFromPdfText,
  matchPdfToEmail,
} from "../src/contact/enrich.ts";

const saraPdf = `
Contact
www.linkedin.com/in/sara-cuervo-123 (LinkedIn)
Sara Cuervo
Director of Customer Service
Top skills
Leadership
`;

const luizPdf = `
Contact
www.linkedin.com/in/luiz-santos-456 (LinkedIn)
Luiz Santos
General Manager
Experiencia
Einhell AG
`;

assert.equal(extractNameFromPdfText(saraPdf), "Sara Cuervo");
assert.equal(extractNameFromPdfText(luizPdf), "Luiz Santos");

const emails = ["diamelsys.villarroel@einhell.com", "sara.cuervo@einhell.com"];

const map = assignPdfsToEmails(
  [
    { fileName: "Profile (1).pdf", text: saraPdf },
    { fileName: "Profile (2).pdf", text: luizPdf },
  ],
  emails,
);

assert.equal(map.get("sara.cuervo@einhell.com")?.fileName, "Profile (1).pdf");

const byName = matchPdfToEmail({ fileName: "x.pdf", text: luizPdf }, ["diamelsys.villarroel@einhell.com"], "Luiz Santos");
assert.equal(byName, "diamelsys.villarroel@einhell.com");

console.log("test-contact-enrich-match: ok");
