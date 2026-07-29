#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  assignPdfsToEmails,
  extractNameFromPdfText,
  matchPdfToEmail,
  matchPdfToProspect,
  mergeEnrichmentsIntoPrep,
} from "../prep-contact-enrich.js";

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

const singleMap = assignPdfsToEmails([{ fileName: "profile.pdf", text: luizPdf }], [
  "diamelsys.villarroel@einhell.com",
]);
assert.equal(singleMap.get("diamelsys.villarroel@einhell.com")?.fileName, "profile.pdf");

const byName = matchPdfToEmail({ fileName: "x.pdf", text: luizPdf }, ["diamelsys.villarroel@einhell.com"], "Luiz Santos");
assert.equal(byName, "diamelsys.villarroel@einhell.com");

assert.equal(matchPdfToProspect(saraPdf, ["sara.cuervo@einhell.com"]), "sara.cuervo@einhell.com");

const merged = mergeEnrichmentsIntoPrep(
  {
    prospects: [{ name: "unknown", role: "unknown", sourceLabel: "S1" }],
    sources: [{ label: "LinkedIn PDF", title: "PDF", url: "linkedin-pdf:upload", confidence: 90 }],
  },
  ["pat@acme.com"],
  [
    {
      email: "pat@acme.com",
      profile: {
        name: "Pat Lee",
        role: "VP Support",
        summary: "20 years in CX",
        priorEmployers: ["Globex"],
        skills: ["Leadership"],
      },
      disc: { primary: "D", confidence: "medium", evidence: ["Direct tone"], source: "linkedin_pdf" },
    },
  ],
);

assert.equal(merged.prospects[0].name, "Pat Lee");
assert.equal(merged.prospects[0].role, "VP Support");
assert.equal(merged.prospects[0].summary, "20 years in CX");
assert.equal(merged.prospects[0].sourceLabel, "LinkedIn PDF");

const mergedCompetitors = mergeEnrichmentsIntoPrep(
  {
    prospects: [{ name: "Pat", competitorTouchpoints: ["Hallucinated CRM"], sourceLabel: "S1" }],
    sources: [{ label: "LinkedIn PDF", title: "PDF", url: "linkedin-pdf:upload", confidence: 90 }],
  },
  ["pat@acme.com"],
  [
    {
      email: "pat@acme.com",
      profile: { name: "Pat Lee", role: "VP", competitorTouchpoints: [] },
      disc: { primary: "D", confidence: "medium", evidence: [], source: "linkedin_pdf" },
    },
  ],
);
assert.deepEqual(mergedCompetitors.prospects[0].competitorTouchpoints, [], "enrichment clears synthesis competitors");

console.log("test-prep-contact-enrich.mjs: ok");
