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

console.log("test-call-notes-bullets: ok");
