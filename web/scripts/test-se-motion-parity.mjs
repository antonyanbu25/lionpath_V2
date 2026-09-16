#!/usr/bin/env node
/**
 * Mirror-drift guard for SE motion resolution (finding J-025, dead-code
 * inventory §10.3.2). The team/segment ids that decide motion live in TWO
 * places that must agree but were never checked against each other:
 *
 *   web/domain/se-motion.js            — imports them from web/domain/constants.js
 *   worker/src/domain-model/se-motion.ts — re-declares the same eight literals
 *
 * If those drift, the browser and the worker disagree about one SE's motion,
 * and motion picks the rubric: an Expansion SE graded on the New Business
 * catalog is scored out of 32 credits instead of 27. web/scripts/test-se-motion.mjs
 * and worker/scripts/test-se-motion.ts each pin their OWN side's table, so
 * they both keep passing while the two tables say different things. This file
 * is the only thing that compares the two sources.
 *
 * It is deliberately differential, not expectational: it asserts the two
 * implementations answer identically, and that the worker's hardcoded literals
 * still equal web/domain/constants.js (the intended single source of truth).
 * It does NOT pin which team maps to which motion — that table is allowed to
 * change, as long as it changes in both places (roadmap 2.2).
 *
 * The worker side is TypeScript and the web test lane runs plain `node`, so the
 * worker module is type-stripped in-process with esbuild (already a web
 * devDependency) and imported as a data: URL. Its extensionless
 * `../rubric-profiles` import is repointed at the web copy, which is only sound
 * because canonicalizeSeMotion is asserted identical in both — see below.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

import * as web from "../domain/se-motion.js";
import * as constants from "../domain/constants.js";

const here = dirname(fileURLToPath(import.meta.url));
const WEB_SE_MOTION = join(here, "../domain/se-motion.js");
const WORKER_SE_MOTION = join(here, "../../worker/src/domain-model/se-motion.ts");
const WEB_RUBRIC_PROFILES = join(here, "../rubric-profiles.js");
const WORKER_RUBRIC_PROFILES = join(here, "../../worker/src/rubric-profiles.ts");

const webSource = readFileSync(WEB_SE_MOTION, "utf8");
const workerSource = readFileSync(WORKER_SE_MOTION, "utf8");

let checks = 0;

// ---------------------------------------------------------------------------
// 0. Load the worker implementation for real, so this compares behaviour and
//    not just text. A failed import rewrite would silently make everything
//    below vacuous, so assert the rewrite landed.
// ---------------------------------------------------------------------------
const rubricImport = /from\s+"\.\.\/rubric-profiles"/;
assert.match(
  workerSource,
  rubricImport,
  "worker se-motion.ts no longer imports ../rubric-profiles — update this loader instead of deleting the guard",
);
const loadable = workerSource.replace(
  rubricImport,
  `from ${JSON.stringify(pathToFileURL(WEB_RUBRIC_PROFILES).href)}`,
);
assert.notEqual(loadable, workerSource, "worker source rewrite for import resolution did not apply");
const workerJs = transformSync(loadable, {
  loader: "ts",
  format: "esm",
  sourcefile: "worker/src/domain-model/se-motion.ts",
}).code;
const worker = await import(`data:text/javascript,${encodeURIComponent(workerJs)}`);

for (const name of ["defaultSeMotion", "seMotionFromPostCallDoc", "SE_MOTION_LABELS", "canonicalizeSeMotion"]) {
  assert.equal(typeof web[name] !== "undefined", true, `web se-motion exports ${name}`);
  assert.equal(typeof worker[name] !== "undefined", true, `worker se-motion exports ${name}`);
  checks += 2;
}

// The worker module is executed with the WEB canonicalizeSeMotion substituted
// in. That substitution is only honest while both copies agree, so check it.
function canonicalizeBody(source, file) {
  const match = source.match(/function canonicalizeSeMotion\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  assert.ok(match, `${file} defines canonicalizeSeMotion`);
  return match[1].replace(/\s+/g, " ").trim();
}
assert.equal(
  canonicalizeBody(readFileSync(WORKER_RUBRIC_PROFILES, "utf8"), "worker/src/rubric-profiles.ts"),
  canonicalizeBody(readFileSync(WEB_RUBRIC_PROFILES, "utf8"), "web/rubric-profiles.js"),
  "canonicalizeSeMotion bodies differ between web and worker — the motion canonicalizer is a THIRD copy and has drifted",
);
checks += 1;

// ---------------------------------------------------------------------------
// 1. The eight literals. web/domain/se-motion.js imports them; the worker
//    re-declares them. Same names, same values, no extras on either side.
// ---------------------------------------------------------------------------
const webImported = (() => {
  const match = webSource.match(/import\s*\{([\s\S]*?)\}\s*from\s*"\.\/constants\.js"/);
  assert.ok(match, "web se-motion.js still imports its ids from ./constants.js");
  return match[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
})();
const workerDeclared = [...workerSource.matchAll(/^const\s+((?:TEAM|SEG)_[A-Z0-9_]*_ID)\s*=\s*"([^"]*)";$/gm)].map(
  ([, name, value]) => ({ name, value }),
);

assert.deepEqual(
  [...workerDeclared.map((d) => d.name)].sort(),
  [...webImported].sort(),
  "the id set diverged: web/domain/se-motion.js imports a different list of team/segment ids than worker/src/domain-model/se-motion.ts declares",
);
checks += 1;

for (const { name, value } of workerDeclared) {
  assert.equal(
    value,
    constants[name],
    `worker se-motion.ts hardcodes ${name} = ${JSON.stringify(value)} but web/domain/constants.js says ${JSON.stringify(constants[name])}`,
  );
  checks += 1;
}
assert.equal(workerDeclared.length, 8, "expected 8 duplicated ids (5 teams + 3 segments); add the new one to both sides");
checks += 1;

// ---------------------------------------------------------------------------
// 2. Which ids sit in which bucket. Value parity alone would not catch an id
//    moving from the NB set to the expansion set on one side only.
// ---------------------------------------------------------------------------
function setMembers(source, setName, file) {
  const match = source.match(new RegExp(`${setName}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  assert.ok(match, `${file} declares ${setName} as a Set literal`);
  return match[1]
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}
for (const setName of ["NB_TEAM_IDS", "EXPANSION_TEAM_IDS"]) {
  assert.deepEqual(
    setMembers(workerSource, setName, "worker/src/domain-model/se-motion.ts"),
    setMembers(webSource, setName, "web/domain/se-motion.js"),
    `${setName} membership differs between web and worker se-motion`,
  );
  checks += 1;
}

// ---------------------------------------------------------------------------
// 3. Motion names and labels — also duplicated in both files.
// ---------------------------------------------------------------------------
assert.deepEqual(worker.SE_MOTION_LABELS, web.SE_MOTION_LABELS, "SE_MOTION_LABELS differ between web and worker");
checks += 1;

// ---------------------------------------------------------------------------
// 4. Behavioural parity: every id, both buckets, the conflict cases, the
//    fallbacks, and the post-call precedence chain, through both modules.
// ---------------------------------------------------------------------------
const ids = Object.fromEntries(workerDeclared.map((d) => [d.name, d.value]));
const teamIds = workerDeclared.filter((d) => d.name.startsWith("TEAM_")).map((d) => d.value);
const segmentIds = workerDeclared.filter((d) => d.name.startsWith("SEG_")).map((d) => d.value);

const motionCtxs = [
  undefined,
  {},
  { teamId: null, segmentId: null },
  { teamId: "", segmentId: "" },
  { teamId: "team_does_not_exist" },
  { segmentId: "seg_does_not_exist" },
  { isSegmentLeader: true },
  ...teamIds.map((teamId) => ({ teamId })),
  ...segmentIds.map((segmentId) => ({ segmentId })),
  // team must win over segment, identically on both sides
  { teamId: ids.TEAM_AJAY_ID, segmentId: ids.SEG_NURTURE_ID },
  { teamId: ids.TEAM_MARY_ID, segmentId: ids.SEG_NEW_BUSINESS_ID },
  { teamId: "team_does_not_exist", segmentId: ids.SEG_DIGITAL_ID },
  { teamId: ids.TEAM_AKSHITA_ID, segmentId: "seg_does_not_exist" },
  { teamId: ids.TEAM_NIKIL_ID, isSegmentLeader: true },
  { teamId: ids.TEAM_VARUN_ID, segmentId: ids.SEG_NURTURE_ID, isSegmentLeader: true },
];

for (const ctx of motionCtxs) {
  const webMotion = ctx === undefined ? web.defaultSeMotion() : web.defaultSeMotion(ctx);
  const workerMotion = ctx === undefined ? worker.defaultSeMotion() : worker.defaultSeMotion(ctx);
  assert.equal(
    webMotion,
    workerMotion,
    `defaultSeMotion(${JSON.stringify(ctx)}): web says ${webMotion}, worker says ${workerMotion} — the browser and the server would grade this SE on different rubrics`,
  );
  checks += 1;
}

const postCallDocs = [
  null,
  undefined,
  {},
  { seMotion: "expansion" },
  { seMotion: "new_business" },
  { seMotion: "nope" },
  { seMotion: null },
  { analysisMeta: { seMotion: "expansion" } },
  { confirmed: { seMotion: "expansion" } },
  { scorecard: { seMotion: "expansion" } },
  { detail: { analysisMeta: { seMotion: "expansion" } } },
  { detail: { confirmed: { seMotion: "expansion" } } },
  { detail: { scorecard: { seMotion: "expansion" } } },
  // analysis JSONB v1 cannot gain keys — both sides must ignore it
  { analysis: { seMotion: "expansion" } },
  // precedence: top level beats analysisMeta beats confirmed beats scorecard
  { seMotion: "new_business", analysisMeta: { seMotion: "expansion" } },
  { analysisMeta: { seMotion: "new_business" }, confirmed: { seMotion: "expansion" } },
  { confirmed: { seMotion: "new_business" }, scorecard: { seMotion: "expansion" } },
  // own key beats the same key nested under detail
  { confirmed: { seMotion: "new_business" }, detail: { confirmed: { seMotion: "expansion" } } },
  // non-records must not be read as records
  { analysisMeta: [{ seMotion: "expansion" }] },
  { analysisMeta: "expansion" },
  { detail: [{ confirmed: { seMotion: "expansion" } }] },
];

for (const doc of postCallDocs) {
  const webMotion = web.seMotionFromPostCallDoc(doc);
  const workerMotion = worker.seMotionFromPostCallDoc(doc);
  assert.equal(
    webMotion,
    workerMotion,
    `seMotionFromPostCallDoc(${JSON.stringify(doc)}): web says ${webMotion}, worker says ${workerMotion} — post_call.se_motion would be stamped differently than the browser shows`,
  );
  checks += 1;
}

console.log(`test-se-motion-parity.mjs: ok (${checks} checks across web/worker se-motion)`);
