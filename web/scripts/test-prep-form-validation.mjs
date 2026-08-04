import assert from "node:assert/strict";
import {
  isPrepContextReady,
  isPrepFormReady,
  prepContextRequiredMessage,
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

console.log("test-prep-form-validation.mjs: ok");
