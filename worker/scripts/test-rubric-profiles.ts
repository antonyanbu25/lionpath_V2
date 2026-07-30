#!/usr/bin/env -S npx tsx
/** Validate QIP rubric profile seeds — weights, core-four, uniqueness. */

import { RUBRIC_PROFILES, validateRubricProfiles } from "../src/rubric-profiles.ts";

const errors = validateRubricProfiles(RUBRIC_PROFILES);
if (errors.length) {
  console.error("test-rubric-profiles: FAIL");
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

if (RUBRIC_PROFILES.length !== 8) {
  console.error(`test-rubric-profiles: FAIL — expected 8 profiles, got ${RUBRIC_PROFILES.length}`);
  process.exit(1);
}

const live = RUBRIC_PROFILES.filter((p) => p.active && !p.provisional);
const shadow = RUBRIC_PROFILES.filter((p) => p.active && p.provisional);
if (live.length !== 2 || shadow.length !== 6) {
  console.error(
    `test-rubric-profiles: FAIL — expected 2 live + 6 shadow, got ${live.length} live + ${shadow.length} shadow`
  );
  process.exit(1);
}

console.log("test-rubric-profiles: OK — 8 profiles, weights sum to 100, core-four present");
