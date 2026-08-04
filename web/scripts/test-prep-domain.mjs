import assert from "node:assert/strict";
import {
  domainFromFirstProspectEmail,
  resolveCompanyDomainForSubmit,
  applyAutoCompanyDomain,
  formatCompanyWebsiteDisplay,
  PERSONAL_EMAIL_DOMAINS,
  normalizeCompanyDomain,
  companyNameFromEmail,
  companyNameFromPrimaryEmail,
  companyNameFromDomain,
  isCompleteEmailForDomainInfer,
  isProgrammaticDomainUpdate,
} from "../prep-domain.js";

assert.equal(companyNameFromEmail("alex@acme.com"), "Acme");
assert.equal(companyNameFromEmail("x@gmail.com"), null);
assert.equal(companyNameFromPrimaryEmail("pat@einhell.com, other@gmail.com"), "Einhell");
assert.equal(companyNameFromDomain("einhell.com"), "Einhell");
assert.equal(companyNameFromDomain("mail.acme.co.uk"), "Acme");

assert.equal(domainFromFirstProspectEmail("diamelsys.villarroel@einhell.com"), "einhell.com");
assert.equal(domainFromFirstProspectEmail("a@gmail.com, b@einhell.com"), null, "first email personal → no infer");
assert.equal(domainFromFirstProspectEmail("a@einhell.com, b@gmail.com"), "einhell.com");

assert.equal(domainFromFirstProspectEmail("user@getgo.s"), null, "incomplete TLD while typing");
assert.equal(domainFromFirstProspectEmail("user@getgo.sg"), "getgo.sg");
assert.equal(isCompleteEmailForDomainInfer("user@getgo.s"), false);
assert.equal(isCompleteEmailForDomainInfer("user@getgo.sg"), true);
assert.equal(isCompleteEmailForDomainInfer("jesada.jir@ascendcorp.com"), true);

assert.equal(resolveCompanyDomainForSubmit("", "x@acme.com"), "acme.com");
assert.equal(resolveCompanyDomainForSubmit("custom.io", "x@acme.com"), "custom.io");
assert.equal(resolveCompanyDomainForSubmit("", "x@gmail.com"), "");
assert.equal(resolveCompanyDomainForSubmit("", "user@getgo.s"), "");

assert.equal(formatCompanyWebsiteDisplay("getgo.sg"), "https://www.getgo.sg");
assert.equal(formatCompanyWebsiteDisplay("https://www.acme.com"), "https://www.acme.com");

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
    events,
  };
}

const field = mockField("");
const r1 = applyAutoCompanyDomain(field, "user@corp.com", { userEdited: false });
assert.equal(r1.applied, "corp.com");
assert.equal(field.value, "https://www.corp.com");
assert.equal(r1.lastAutoValue, "corp.com");

const r2 = applyAutoCompanyDomain(field, "other@other.com", { userEdited: true, lastAutoValue: "corp.com" });
assert.equal(r2.applied, null);
assert.equal(field.value, "https://www.corp.com");

const cleared = mockField("");
applyAutoCompanyDomain(cleared, "user@corp.com", { userEdited: false });
assert.equal(normalizeCompanyDomain(cleared.value), "corp.com");

const sgField = mockField("");
const sgPartial = applyAutoCompanyDomain(sgField, "user@getgo.s", { userEdited: false });
assert.equal(sgPartial.applied, null, "no auto-fill for incomplete .s TLD");
assert.equal(sgField.value, "");

const sgComplete = applyAutoCompanyDomain(sgField, "user@getgo.sg", { userEdited: false, lastAutoValue: null });
assert.equal(sgComplete.applied, "getgo.sg");
assert.equal(normalizeCompanyDomain(sgField.value), "getgo.sg");

const typingField = mockField("https://www.getgo.s");
let state = { userEdited: false, lastAutoValue: "getgo.s" };
applyAutoCompanyDomain(typingField, "user@getgo.s", state);
state.lastAutoValue = "getgo.s";
const typingFixed = applyAutoCompanyDomain(typingField, "user@getgo.sg", {
  userEdited: false,
  lastAutoValue: "getgo.s",
});
assert.equal(typingFixed.applied, "getgo.sg");
assert.equal(normalizeCompanyDomain(typingField.value), "getgo.sg");

assert.equal(isProgrammaticDomainUpdate(), false);
const progField = mockField("");
applyAutoCompanyDomain(progField, "user@corp.com", { userEdited: false });
assert.equal(isProgrammaticDomainUpdate(), false);

console.log("test-prep-domain.mjs: ok");
