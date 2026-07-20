import assert from "node:assert/strict";
import {
  domainFromFirstProspectEmail,
  resolveCompanyDomainForSubmit,
  applyAutoCompanyDomain,
  PERSONAL_EMAIL_DOMAINS,
  normalizeCompanyDomain,
} from "../prep-domain.js";

assert.equal(domainFromFirstProspectEmail("diamelsys.villarroel@einhell.com"), "einhell.com");
assert.equal(domainFromFirstProspectEmail("a@gmail.com, b@einhell.com"), null, "first email personal → no infer");
assert.equal(domainFromFirstProspectEmail("a@einhell.com, b@gmail.com"), "einhell.com");

assert.equal(resolveCompanyDomainForSubmit("", "x@acme.com"), "acme.com");
assert.equal(resolveCompanyDomainForSubmit("custom.io", "x@acme.com"), "custom.io");
assert.equal(resolveCompanyDomainForSubmit("", "x@gmail.com"), "");

assert.ok(PERSONAL_EMAIL_DOMAINS.has("gmail.com"));

function mockField(initial = "") {
  let value = initial;
  const events = [];
  return {
    get value() {
      return value;
    },
    set value(v) {
      value = v;
    },
    querySelector: () => null,
    dispatchEvent: (ev) => events.push(ev.type),
  };
}

const field = mockField("");
const r1 = applyAutoCompanyDomain(field, "user@corp.com", { userEdited: false });
assert.equal(r1.applied, "corp.com");
assert.equal(field.value, "corp.com");
assert.equal(r1.lastAutoValue, "corp.com");

const r2 = applyAutoCompanyDomain(field, "other@other.com", { userEdited: true, lastAutoValue: "corp.com" });
assert.equal(r2.applied, null);
assert.equal(field.value, "corp.com");

const cleared = mockField("");
applyAutoCompanyDomain(cleared, "user@corp.com", { userEdited: false });
assert.equal(normalizeCompanyDomain(cleared.value), "corp.com");

console.log("test-prep-domain.mjs: ok");
