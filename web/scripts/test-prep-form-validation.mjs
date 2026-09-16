import assert from "node:assert/strict";
import {
  isPrepContextReady,
  isPrepFormReady,
  isProxySeReady,
  prepContextRequiredMessage,
  proxySeRequiredMessage,
  prepFormReadyHintMessage,
} from "../prep-form-validation.js";

assert.equal(isPrepContextReady("", []), false);
assert.equal(isPrepContextReady("  ", []), false);
assert.equal(isPrepContextReady("Notes from AE", []), true);
assert.equal(
  isPrepContextReady("", [{ fileName: "notes.txt", text: "Enough context text here for validation." }]),
  true,
);
assert.equal(isPrepContextReady("typed", [{ fileName: "notes.txt", text: "x".repeat(25) }]), true);

assert.equal(isPrepFormReady(["a@corp.com"], [], "AE notes", []), true);
assert.equal(isPrepFormReady(["a@corp.com"], ["a@corp.com"], "AE notes", []), false);
assert.equal(isPrepFormReady(["a@corp.com"], [], "", []), false);
assert.equal(isPrepFormReady([], [], "AE notes", []), false);
assert.equal(
  isPrepFormReady(
    ["a@corp.com", "b@corp.com"],
    ["b@corp.com"],
    "AE notes",
    [],
  ),
  false,
);
assert.equal(
  isPrepFormReady(
    ["a@corp.com"],
    [],
    "",
    [{ fileName: "brief.pdf", text: "File-only context with enough characters." }],
  ),
  true,
);

assert.match(prepContextRequiredMessage(), /context from the AE/i);

assert.equal(isProxySeReady(false, null), true);
assert.equal(isProxySeReady(true, null), false);
assert.equal(isProxySeReady(true, "usr_se_a"), true);
assert.match(proxySeRequiredMessage(), /Select which SE/i);
assert.equal(
  isPrepFormReady(["a@corp.com"], [], "AE notes", [], { isManager: true, proxySeUserId: null }),
  false,
);
assert.equal(
  isPrepFormReady(["a@corp.com"], [], "AE notes", [], { isManager: true, proxySeUserId: "usr_se_a" }),
  true,
);

// UAT-002 — Generate was correctly disabled while isPrepFormReady() was false, but
// explained nothing. prepFormReadyHintMessage must name what's missing using the exact
// same checks, and go empty once the form is actually ready.
assert.equal(
  prepFormReadyHintMessage([], [], "AE notes", []),
  "Add a prospect email to enable Generate brief.",
);
assert.equal(
  prepFormReadyHintMessage(["a@corp.com"], ["a@corp.com"], "AE notes", []),
  "Add a LinkedIn PDF for the attendee to enable Generate brief.",
);
assert.equal(
  prepFormReadyHintMessage(["a@corp.com", "b@corp.com"], ["a@corp.com", "b@corp.com"], "AE notes", []),
  "Add LinkedIn PDFs for 2 attendees to enable Generate brief.",
);
assert.equal(
  prepFormReadyHintMessage(["a@corp.com"], [], "", []),
  "Add context from the AE (notes or a file) to enable Generate brief.",
);
assert.equal(
  prepFormReadyHintMessage(["a@corp.com"], [], "AE notes", []),
  "",
  "empty once every required field is present",
);
assert.equal(
  prepFormReadyHintMessage(["a@corp.com"], [], "AE notes", [], { isManager: true, proxySeUserId: null }),
  "Add which SE you're running this for to enable Generate brief.",
);
assert.equal(
  prepFormReadyHintMessage([], ["a@corp.com"], "AE notes", []),
  "Add a prospect email to enable Generate brief.",
  "missing-email message takes priority over a stale missingLinkedIn list",
);

console.log("test-prep-form-validation.mjs: ok");
