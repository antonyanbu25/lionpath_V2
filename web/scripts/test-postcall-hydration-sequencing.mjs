#!/usr/bin/env node
/**
 * Regression: qualify/summarise must resolve independently, and the video
 * pass must not gate commit/arr/gaps (and therefore timeline).
 *
 * runPostcallParallelHydration() (web/postcall.js) used to `await qualifyP`
 * then `await summariseP` sequentially even though they're independent LLM
 * calls — summarise's tile couldn't render until qualify's had fully
 * resolved, regardless of which one actually finished first (this is why
 * MEDDPICC felt slow: it sat first in line with nothing able to overlap it).
 *
 * Separately, Call timeline is derived from gaps/objections/scorecard data
 * only, but used to be gated behind a single Promise.all that also included
 * commitP and videoP — the video pass (ffmpeg + vision model) is typically
 * the single slowest step in the whole pipeline, so timeline silently waited
 * on something it never needed.
 *
 * postcall.js can't be unit-imported directly (deep module state, assumes a
 * live app/DOM), so this is a structural source check — same technique as
 * test-dashboard-subscribe-fb-db-gate.mjs / test-sso-popup-no-async-gap.mjs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const postcallJs = readFileSync(join(webDir, "postcall.js"), "utf8");

// qualify/summarise must NOT be two sequential top-level awaits with nothing
// running concurrently — each must be its own closure joined by Promise.all.
assert.ok(
  /const\s+handleQualify\s*=\s*\(async\s*\(\)\s*=>\s*\{/.test(postcallJs),
  "qualify handling must be its own async closure (handleQualify), not a bare top-level `await qualifyP`",
);
assert.ok(
  /const\s+handleSummarise\s*=\s*\(async\s*\(\)\s*=>\s*\{/.test(postcallJs),
  "summarise handling must be its own async closure (handleSummarise), not a bare top-level `await summariseP`",
);
assert.ok(
  /await\s+Promise\.all\(\s*\[\s*handleQualify\s*,\s*handleSummarise\s*\]\s*\)/.test(postcallJs),
  "handleQualify and handleSummarise must be joined with Promise.all so whichever resolves first " +
    "updates its own tile immediately, instead of summarise waiting behind qualify",
);

// videoP must not be in the same Promise.all as commitP/arrWorkP/gapsP —
// timeline (derived from gaps) has no reason to wait on the video pass.
const barrierMatch = postcallJs.match(/await\s+Promise\.all\(\s*\[([^\]]+)\]\s*\)/g) || [];
const commitArrGapsBarrier = barrierMatch.find((b) => b.includes("commitP") && b.includes("gapsP"));
assert.ok(commitArrGapsBarrier, "expected a Promise.all barrier joining commitP and gapsP");
assert.ok(
  !commitArrGapsBarrier.includes("videoP"),
  "videoP must not share a Promise.all with commitP/arrWorkP/gapsP — timeline only needs gaps/objections/" +
    "scorecard data and shouldn't wait on the video pass (typically the slowest step in the pipeline)",
);
assert.ok(
  /void\s+videoP\s*\n?\s*\.then\(/.test(postcallJs),
  "videoP must be handled independently via its own .then() so it persists videoFacts whenever it " +
    "resolves without gating anything else",
);

console.log("test-postcall-hydration-sequencing.mjs: ok");
