/** Smoke test for resolveProspectEmails and company name derivation. */

import assert from "node:assert/strict";
import { resolveProspectEmails, normalizePrepInput, deriveCompanyNameFromEmail } from "../src/prep.ts";

assert.equal(deriveCompanyNameFromEmail("alex@acme.com"), "Acme");
assert.equal(deriveCompanyNameFromEmail("x@gmail.com"), null);

const normalized = normalizePrepInput({
  companyDomain: "acme.com",
  prospectEmail: "alex@acme.com",
});
assert.equal(normalized.companyName, "Acme");

const cases: [string, Parameters<typeof resolveProspectEmails>[0], number][] = [
  ["single", { companyName: "Acme", prospectEmail: "a@x.com" }, 1],
  ["comma string", { companyName: "Acme", prospectEmail: "a@x.com, b@y.com" }, 2],
  ["array", { companyName: "Acme", prospectEmail: "a@x.com", prospectEmails: ["c@z.com"] }, 2],
  ["empty", { companyName: "Acme", prospectEmail: "" }, 0],
];

let failed = 0;
for (const [name, input, expected] of cases) {
  const got = resolveProspectEmails(input);
  if (got.length !== expected) {
    console.error(`FAIL ${name}: expected ${expected}, got ${got.length}`, got);
    failed++;
  } else {
    console.log(`ok: ${name}`);
  }
}

if (failed) process.exit(1);
console.log("OK — resolveProspectEmails smoke test passed");
