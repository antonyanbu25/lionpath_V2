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
  profileFor,
  rubricIdFor,
} from "../src/rubric-profiles.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.resolve(__dirname, "../../docs/QIP_SCORING_V2_1.md");

const EXPECTED_TOTALS: Record<string, number> = {
  "new_business:demo": 34,
  "new_business:discovery": 32,
  "new_business:technical_deep_dive": 32,
  "new_business:reverse_demo": 28,
  "new_business:use_case_discussion": 31,
  "new_business:trial_setup": 33,
  "new_business:troubleshooting": 33,
  "new_business:qa_session": 25,
  "expansion:demo_plan_upgrade": 24,
  "expansion:discovery": 27,
  "expansion:technical_deep_dive": 26,
  "expansion:reverse_demo": 17,
  "expansion:use_case_discussion": 24,
  "expansion:trial_setup": 24,
  "expansion:troubleshooting": 25,
  "expansion:qa_session": 20,
  "expansion:churn_mitigation": 24,
  "expansion:ai_vision_demo": 29,
  "expansion:demo_cross_sell": 26,
};

const CALL_TYPE_ALIASES: Record<string, string> = { qna_session: "qa_session" };

function parseYamlProfilesFromSpec(content: string) {
  const blocks = [...content.matchAll(/```yaml\s*\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const out: Record<string, { totalCredits: number; themes: unknown[] }> = {};
  for (const block of blocks) {
    const data = yaml.parse(block);
    if (!data?.profile) continue;
    const key = CALL_TYPE_ALIASES[data.profile.key] || data.profile.key;
    const motion = data.profile.motion === "expansion" ? "expansion" : "new_business";
    out[`${motion}:${key}`] = {
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

if (QIP_PROFILES.length !== 19) {
  console.error(`test-rubric-profiles: FAIL — expected 19 profiles, got ${QIP_PROFILES.length}`);
  process.exit(1);
}

const nb = QIP_PROFILES.filter((p) => p.motion === "new_business");
const exp = QIP_PROFILES.filter((p) => p.motion === "expansion");
if (nb.length !== 8 || exp.length !== 11) {
  console.error(`test-rubric-profiles: FAIL — expected 8 NB + 11 expansion, got ${nb.length} + ${exp.length}`);
  process.exit(1);
}

if (RUBRIC_VERSION !== "2.1") {
  console.error(`test-rubric-profiles: FAIL — expected version 2.1, got ${RUBRIC_VERSION}`);
  process.exit(1);
}

const live = QIP_PROFILES.filter((p) => p.active && !p.provisional);
const shadow = QIP_PROFILES.filter((p) => p.active && p.provisional);
if (live.length !== 2 || shadow.length !== 17) {
  console.error(
    `test-rubric-profiles: FAIL — expected 2 live + 17 shadow, got ${live.length} live + ${shadow.length} shadow`,
  );
  process.exit(1);
}

for (const profile of QIP_PROFILES) {
  const id = `${profile.motion}:${profile.key}`;
  const expected = EXPECTED_TOTALS[id];
  if (profile.totalCredits !== expected) {
    console.error(`test-rubric-profiles: FAIL — ${id} totalCredits ${profile.totalCredits} !== ${expected}`);
    process.exit(1);
  }
}

if (rubricIdFor("discovery", "2.1", "new_business") !== "rub_discovery_2_1") {
  console.error("test-rubric-profiles: FAIL — NB discovery rubric id");
  process.exit(1);
}
if (rubricIdFor("discovery", "2.1", "expansion") !== "rub_discovery_expansion_2_1") {
  console.error("test-rubric-profiles: FAIL — expansion discovery rubric id");
  process.exit(1);
}
if (profileFor("discovery", "expansion").totalCredits !== 27) {
  console.error("test-rubric-profiles: FAIL — expansion discovery lookup");
  process.exit(1);
}
if (profileFor("discovery", "new_business").totalCredits !== 32) {
  console.error("test-rubric-profiles: FAIL — NB discovery lookup");
  process.exit(1);
}

const specContent = fs.readFileSync(specPath, "utf8");
const specProfiles = parseYamlProfilesFromSpec(specContent);

for (const profile of QIP_PROFILES) {
  const id = `${profile.motion}:${profile.key}`;
  const spec = specProfiles[id];
  if (!spec) {
    console.error(`test-rubric-profiles: FAIL — no YAML block for ${id}`);
    process.exit(1);
  }
  if (spec.totalCredits !== profile.totalCredits) {
    console.error(`test-rubric-profiles: FAIL drift — ${id} totalCredits`);
    process.exit(1);
  }
  if (spec.themes.length !== profile.themes.length) {
    console.error(`test-rubric-profiles: FAIL drift — ${id} theme count`);
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
      console.error(`test-rubric-profiles: FAIL drift — ${id}/${encoded.key} metadata mismatch`);
      process.exit(1);
    }
    if (!!encoded.requiresVideo !== fromSpec.requiresVideo) {
      console.error(`test-rubric-profiles: FAIL drift — ${id}/${encoded.key} requiresVideo`);
      process.exit(1);
    }
    if (JSON.stringify(encoded.subParameters) !== JSON.stringify(fromSpec.subParameters)) {
      console.error(`test-rubric-profiles: FAIL drift — ${id}/${encoded.key} subParameters`);
      process.exit(1);
    }
  }
}

console.log("test-rubric-profiles: OK — 8 NB + 11 expansion v2.1, credits valid, YAML drift clean");
