#!/usr/bin/env node
/**
 * Regression: a CRM-matched account's domain must actually reach the
 * Company website field (not just the in-memory account state), and must
 * respect a manual edit instead of silently clobbering it.
 *
 * applyAccount() in prep-crm-resolve.js used to write via a bare
 * `field.value = display` assignment — a no-op on this fw-input build (see
 * prep-domain.js setDomainValue and test-prep-domain.mjs for the same class
 * of bug). It also never updated prepDomainUiState.lastAutoValue, which
 * permanently blocked the email-based auto-fill (test-prep-domain.mjs) from
 * ever overwriting the field again for the rest of the session, and it
 * never checked prepDomainUiState.userEdited before overwriting a manual
 * edit. This test exercises all three.
 */
import assert from "node:assert/strict";

// applyAccount() reaches $("companyDomain") and $("prep-account-deal-preview")
// via web/shared.js's `document.getElementById` — stub a minimal document
// before importing anything that touches it.
const shadowInput = { value: "", dispatchEvent: () => {} };
const hiddenInput = { value: "", dispatchEvent: () => {} }; // decoy — must never be the write target
const companyDomainField = {
  get value() {
    return shadowInput.value;
  },
  set value(_v) {
    /* no-op, matching the real Crayons build */
  },
  // crayons-ui.js's setFieldValue/readFieldValue query "input, textarea";
  // prep-domain.js's own helpers query plain "input" — match both.
  shadowRoot: { querySelector: (sel) => (sel.includes("input") ? shadowInput : null) },
  querySelector: (sel) => (sel.includes("input") ? hiddenInput : null),
  dispatchEvent: () => {},
};

globalThis.document = {
  getElementById: (id) => (id === "companyDomain" ? companyDomainField : null),
};

const { applyAccount, resetPrepCrmSelection } = await import("../prep-crm-resolve.js");
const { prepDomainUiState, resetPrepDomainState } = await import("../prep-domain.js");

function resetAll() {
  resetPrepCrmSelection();
  resetPrepDomainState();
  shadowInput.value = "";
  hiddenInput.value = "";
}

// 1. A CRM match's domain must actually render — on the shadow-DOM input,
//    never the light-DOM decoy — and must mark itself as an "auto" value.
resetAll();
await applyAccount({ id: null, name: "Acme", domain: "acme.com" }, []);
assert.equal(
  shadowInput.value,
  "https://www.acme.com",
  "CRM-matched domain must write the shadow-DOM input, not just field.value",
);
assert.notEqual(hiddenInput.value, "https://www.acme.com", "must not write the light-DOM decoy input");
assert.equal(
  prepDomainUiState.lastAutoValue,
  "acme.com",
  "CRM-matched write must update lastAutoValue so email-based auto-fill isn't blocked afterward",
);

// 2. Once written by CRM match, the email-domain inferer must still be able
//    to freely re-fill for a *different* subsequent match — the exact
//    lockout bug this fix closes.
await applyAccount({ id: null, name: "Globex", domain: "globex.com" }, []);
assert.equal(shadowInput.value, "https://www.globex.com", "a later CRM match must still be able to update the field");

// 3. A genuine manual edit must not be silently overwritten by a CRM match.
resetAll();
shadowInput.value = "https://www.mycustom.io";
prepDomainUiState.userEdited = true;
await applyAccount({ id: null, name: "Acme", domain: "acme.com" }, []);
assert.equal(shadowInput.value, "https://www.mycustom.io", "a manual edit must not be overwritten by a CRM match");

console.log("test-prep-crm-domain-writeback.mjs: ok");
