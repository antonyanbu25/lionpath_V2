import assert from "node:assert/strict";
import { normalizeAccountSlug } from "../domain/types.js";
import { isFreeMailDomain, FREE_MAIL_DOMAINS } from "../domain/constants.js";

assert.ok(isFreeMailDomain("gmail.com"));
assert.ok(isFreeMailDomain("www.Gmail.com"));
assert.ok(!isFreeMailDomain("acme.com"));
assert.equal(FREE_MAIL_DOMAINS.size, 18);

assert.equal(
  normalizeAccountSlug("Acme Corp", "gmail.com"),
  "acme-corp",
  "free-mail domain ignored — slug from company name",
);

assert.equal(
  normalizeAccountSlug("Acme Corp", "acme.com"),
  "acme.com",
  "corporate domain wins over name",
);

assert.equal(
  normalizeAccountSlug("Beta Industries", ""),
  "beta-industries",
  "empty domain falls back to slugified name",
);

assert.equal(
  normalizeAccountSlug("Gamma LLC", null),
  "gamma-llc",
  "null domain falls back to slugified name",
);

console.log("test-account-slug.mjs: ok");
