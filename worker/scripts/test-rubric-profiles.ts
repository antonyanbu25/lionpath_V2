#!/usr/bin/env -S npx tsx
/** Validate QIP v2.1 rubric profiles — credits, sub-parameters, drift vs spec YAML. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import {
  QIP_PROFILES,
  validateRubricProfiles,
  RUBRIC_VERSION,
} from "../src/rubric-profiles.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.resolve(__dirname, "../../docs/QIP_SCORING_V2_1.md");

const EXPECTED_TOTALS: Record<string, number> = {
  demo: 34,
  discovery: 33,
  technical_deep_dive: 32,
  reverse_demo: 28,
  use_case_discussion: 31,
  trial_setup: 33,
  troubleshooting: 33,
  qa_session: 25,
};

const CALL_TYPE_ALIASES: Record<string, string> = { qna_session: "qa_session" };

function parseYamlProfilesFromSpec(content: string) {
  const blocks = [...content.matchAll(/```yaml\s*\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const out: Record<string, { totalCredits: number; themes: unknown[] }> = {};
  for (const block of blocks) {
    const data = yaml.parse(block);
    if (!data?.profile) continue;
    const key = CALL_TYPE_ALIASES[data.profile.key] || data.profile.key;
    out[key] = {
      totalCredits: data.profile.total_credits,
      themes: data.profile.themes.map((t: { key: string; credit: number; sub_parameters: string[]; category: string; requires_video?: boolean }) => ({
        key: t.key,
        credit: t.credit,
        category: t.category,
        requiresVideo: !!t.requires_video,
        subParameters: t.sub_parameters,
      })),
    };
  }
  return out;
}

const errors = validateRubricProfiles(QIP_PROFILES);
if (errors.length) {
  console.error("test-rubric-profiles: FAIL — validation");
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

if (QIP_PROFILES.length !== 8) {
  console.error(`test-rubric-profiles: FAIL — expected 8 profiles, got ${QIP_PROFILES.length}`);
  process.exit(1);
}

if (RUBRIC_VERSION !== "2.1") {
  console.error(`test-rubric-profiles: FAIL — expected version 2.1, got ${RUBRIC_VERSION}`);
  process.exit(1);
}

const live = QIP_PROFILES.filter((p) => p.active && !p.provisional);
const shadow = QIP_PROFILES.filter((p) => p.active && p.provisional);
if (live.length !== 2 || shadow.length !== 6) {
  console.error(
    `test-rubric-profiles: FAIL — expected 2 live + 6 shadow, got ${live.length} live + ${shadow.length} shadow`,
  );
  process.exit(1);
}

for (const profile of QIP_PROFILES) {
  const expected = EXPECTED_TOTALS[profile.key];
  if (profile.totalCredits !== expected) {
    console.error(`test-rubric-profiles: FAIL — ${profile.key} totalCredits ${profile.totalCredits} !== ${expected}`);
    process.exit(1);
  }
}

// Drift test — encoded profiles must match spec YAML blocks
const specContent = fs.readFileSync(specPath, "utf8");
const specProfiles = parseYamlProfilesFromSpec(specContent);

for (const profile of QIP_PROFILES) {
  const spec = specProfiles[profile.key];
  if (!spec) {
    console.error(`test-rubric-profiles: FAIL — no YAML block for ${profile.key}`);
    process.exit(1);
  }
  if (spec.totalCredits !== profile.totalCredits) {
    console.error(`test-rubric-profiles: FAIL drift — ${profile.key} totalCredits`);
    process.exit(1);
  }
  if (spec.themes.length !== profile.themes.length) {
    console.error(`test-rubric-profiles: FAIL drift — ${profile.key} theme count`);
    process.exit(1);
  }
  for (let i = 0; i < profile.themes.length; i += 1) {
    const encoded = profile.themes[i];
    const fromSpec = spec.themes[i] as {
      key: string;
      credit: number;
      category: string;
      requiresVideo: boolean;
      subParameters: string[];
    };
    if (encoded.key !== fromSpec.key || encoded.credit !== fromSpec.credit || encoded.category !== fromSpec.category) {
      console.error(`test-rubric-profiles: FAIL drift — ${profile.key}/${encoded.key} metadata mismatch`);
      process.exit(1);
    }
    if (!!encoded.requiresVideo !== fromSpec.requiresVideo) {
      console.error(`test-rubric-profiles: FAIL drift — ${profile.key}/${encoded.key} requiresVideo`);
      process.exit(1);
    }
    if (JSON.stringify(encoded.subParameters) !== JSON.stringify(fromSpec.subParameters)) {
      console.error(`test-rubric-profiles: FAIL drift — ${profile.key}/${encoded.key} subParameters`);
      process.exit(1);
    }
  }
}

console.log("test-rubric-profiles: OK — 8 profiles v2.1, credits valid, YAML drift clean");
