/**
 * Sync test: worker input hash matches web prep-input-hash.js
 * Run: tsx scripts/test-prep-input-hash.ts
 */

import assert from "node:assert/strict";
import { buildInputHashPayload, hashInputPayload } from "../src/prep/input-hash.js";
import { PLAYBOOK_VERSION } from "../src/prep/types.js";
import {
  computePrepInputHash,
  computeKaiaRef,
  computeContextFp,
  PREP_PLAYBOOK_VERSION,
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
// Pinned to the constant, not a literal: this file is the only guard that the two
// no-bundler mirrors agree, and a literal turned a routine version bump into a failure
// here instead — which aborted the `&&` chain and hid every later worker test.
assert.equal(workerPayload.playbookVersion, PLAYBOOK_VERSION);
assert.equal(PLAYBOOK_VERSION, PREP_PLAYBOOK_VERSION, "worker and web playbook version must agree");
assert.ok(workerPayload.kaiaRef.includes("p_abc123"));
assert.ok(workerPayload.contextFp.length > 0);

assert.equal(computeKaiaRef(""), "");
assert.equal(computeContextFp(""), "");

console.log("test-prep-input-hash: ok");
