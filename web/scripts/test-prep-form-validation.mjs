import assert from "node:assert/strict";
import {
  isPrepContextReady,
  isPrepFormReady,
  isProxySeReady,
  prepContextRequiredMessage,
  proxySeRequiredMessage,
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

console.log("test-prep-form-validation.mjs: ok");
