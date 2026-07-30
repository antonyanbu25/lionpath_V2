import assert from "node:assert/strict";
import { formatCallNotesBullets } from "../call-view.js";

const prefixed = formatCallNotesBullets(
  "- Ran the agenda from the brief.\n- Copilot was the moment the room changed.\n- No customer-owned next step.",
);
assert.equal(prefixed.length, 3);

const paras = formatCallNotesBullets("First paragraph about the demo.\n\nSecond about risks.");
assert.equal(paras.length, 2);

const long = formatCallNotesBullets(
  "One. Two. Three. Four. Five. Six. Seven. Eight. Nine.",
);
assert.ok(long.length >= 5 && long.length <= 7);

const stacked = formatCallNotesBullets("- - Alpha thing.\n- - Beta thing.\n- - Gamma thing.");
assert.ok(stacked.every((b) => !/^[-*•]/.test(b)), "no residual markers");
assert.equal(stacked.length, 3);

const inlineOne = formatCallNotesBullets(
  "- Managing support via SharePoint. - Needs a 360 view. - Asked for the wrong product (Freshdesk vs. Freshservice), showing confusion.",
);
assert.equal(inlineOne.length, 3, "inline markers split, not periods");
assert.ok(inlineOne[2].includes("Freshservice"), "vs. must not split");

console.log("test-call-notes-bullets: ok");
