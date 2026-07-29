#!/usr/bin/env node
/**
 * Pre-call brief localStorage — compact payloads + quota retry.
 * Run: node web/scripts/test-precall-brief-storage.mjs
 */

import assert from "node:assert/strict";
import { compactBriefForStorage, loadLocalBriefs } from "../precall.js";

const BRIEFS_KEY = "lionpath_briefs";

function makeQuotaStorage(maxBytes) {
  const mem = new Map();
  return {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => {
      if (Buffer.byteLength(String(v), "utf8") > maxBytes) {
        const err = new Error("Setting the value exceeded the quota.");
        err.name = "QuotaExceededError";
        throw err;
      }
      mem.set(k, v);
    },
    removeItem: (k) => mem.delete(k),
  };
}

function sampleBrief(id, blobSize = 0) {
  return {
    id,
    company: "Acme",
    kind: "Discovery",
    when: "7/29/2026",
    prep: { version: 8, headline: "Test", blob: "x".repeat(blobSize) },
    meta: {
      company: "Acme",
      domain: "acme.com",
      researchBundle: { facts: [{ key: "industry", value: "SaaS" }] },
      contactEnrichmentsByEmail: { "ceo@acme.com": { raw: "y".repeat(blobSize) } },
      researchMeta: { kaiaFetched: true, linkedinMatchedEmails: ["ceo@acme.com"] },
    },
    input: {
      companyName: "Acme",
      companyDomain: "acme.com",
      prospectEmails: ["ceo@acme.com"],
      linkedinProfileExports: [{ fileName: "a.pdf", text: "z".repeat(blobSize) }],
      cachedResearch: { facts: [{ key: "size", value: "w".repeat(blobSize) }] },
    },
  };
}

function minimalV8Prep(extra = {}) {
  return {
    about: "About the account",
    facts: [{ key: "industry", value: "SaaS", sourceLabel: "web" }],
    signals: [{ label: "Growth", value: "High" }],
    prospects: [{ name: "Pat", email: "pat@example.com" }],
    ...extra,
  };
}

const compact = compactBriefForStorage(sampleBrief("b1", 5000));
assert.equal(compact.meta.researchBundle, undefined, "strip researchBundle");
assert.equal(compact.meta.contactEnrichmentsByEmail, undefined, "strip enrichments");
assert.equal(compact.input.linkedinProfileExports, undefined, "strip linkedin exports");
assert.equal(compact.input.cachedResearch, undefined, "strip cachedResearch");
assert.equal(compact.meta.kaiaFetched, true, "keep kaia flag");
assert.deepEqual(compact.meta.linkedinMatchedEmails, ["ceo@acme.com"], "keep linkedin matches");

globalThis.localStorage = makeQuotaStorage(2800);
localStorage.setItem(
  BRIEFS_KEY,
  JSON.stringify([
    compactBriefForStorage(sampleBrief("old", 900)),
    compactBriefForStorage(sampleBrief("older", 900)),
  ]),
);

const { saveBriefToSidebar } = await import("../precall.js");
saveBriefToSidebar(
  { companyName: "Beta", companyDomain: "beta.com", prospectEmails: ["a@beta.com"] },
  minimalV8Prep({ blob: "n".repeat(900) }),
  { company: "Beta", domain: "beta.com" },
  null,
);

const stored = loadLocalBriefs();
assert.ok(stored.length >= 1, "at least one brief saved after quota retry");
assert.equal(stored[0].company, "Beta", "newest brief retained");
assert.ok(Buffer.byteLength(JSON.stringify(stored), "utf8") <= 2800, "stored payload fits quota");

console.log("OK — precall brief storage smoke test passed");
