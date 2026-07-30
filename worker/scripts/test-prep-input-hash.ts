/**
 * Sync test: worker input hash matches web prep-input-hash.js
 * Run: tsx scripts/test-prep-input-hash.ts
 */

import assert from "node:assert/strict";
import { buildInputHashPayload, hashInputPayload } from "../src/prep/input-hash.js";
import {
  computePrepInputHash,
  computeKaiaRef,
  computeContextFp,
} from "../../web/prep-input-hash.js";

const sampleInput = {
  companyName: "Acme Corp",
  companyDomain: "acme.com",
  linkedinProfileExports: [],
  additionalContext: "Expansion opportunity Q3",
  kaiaMeetingUrl: "https://engage.freshworks.com/s/p_abc123",
};

const emails = ["a@acme.com", "b@acme.com"];

const workerPayload = buildInputHashPayload(sampleInput as import("../src/prep/types.js").PrepInput, emails);
const workerHash = hashInputPayload(workerPayload);

const webHash = computePrepInputHash(sampleInput.companyName, sampleInput.companyDomain, emails, "", {
  additionalContext: sampleInput.additionalContext,
  kaiaMeetingUrl: sampleInput.kaiaMeetingUrl,
});

assert.equal(workerHash, webHash, "worker and web hash must match");
assert.equal(workerPayload.playbookVersion, "2");
assert.ok(workerPayload.kaiaRef.includes("p_abc123"));
assert.ok(workerPayload.contextFp.length > 0);

assert.equal(computeKaiaRef(""), "");
assert.equal(computeContextFp(""), "");

console.log("test-prep-input-hash: ok");
