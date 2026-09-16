import assert from "node:assert/strict";
import { shouldRunProspectEnrich } from "../precall.js";

assert.equal(shouldRunProspectEnrich({}, 0), false);
assert.equal(shouldRunProspectEnrich({ additionalContext: "notes" }, 0), true);
assert.equal(shouldRunProspectEnrich({ kaiaMeetingUrl: "https://engage.freshworks.com/s/x" }, 0), true);
assert.equal(shouldRunProspectEnrich({ kaiaSummary: "summary text" }, 0), true);
assert.equal(shouldRunProspectEnrich({ meetingZoomUrl: "https://zoom.us/rec/share/x" }, 0), true);
assert.equal(shouldRunProspectEnrich({}, 1), true);

console.log("test-prep-enrich-gate.mjs: ok");
