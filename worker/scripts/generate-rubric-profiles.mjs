#!/usr/bin/env node
/**
 * Parse docs/QIP_SCORING_V2_1.md YAML blocks → rubric-profiles.generated.ts/js
 * Run: node worker/scripts/generate-rubric-profiles.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const specPath = path.join(repoRoot, "docs/QIP_SCORING_V2_1.md");

/** Spec profile key → legacy CallType where they differ. */
const CALL_TYPE_ALIASES = {
  qna_session: "qa_session",
};

/** Live (non-provisional) profiles per v2.1 §8 header — new-business demo + discovery only. */
const LIVE_PROFILES = new Set(["new_business:demo", "new_business:discovery"]);

const VOCABULARY_KEYS = new Set([
  "research",
  "questions",
  "pain_qualification",
  "incumbent_competition",
  "stakeholder_mapping",
  "observation_note_capture",
  "problem_diagnosis",
  "solutioning",
  "cde_build",
  "ai",
  "slide_deck",
  "technical_accuracy",
  "architecture_fitment",
  "task_design",
  "setup_framing",
  "exit_criteria_defined",
  "success_metrics_agreed",
  "admin_access_enablement",
  "value",
  "case_study",
  "microstory",
  "ai_readiness_fit",
  "ai_solutioning",
  "objections",
  "comp_pitch",
  "question_handling",
  "expectation_setting",
  "escalation_handling",
  "risk_identification",
  "coaching_without_taking_over",
  "call_flow",
  "customer_engagement",
  "storytelling",
  "summarise",
  "cta",
  "camera_on",
  "handover_discipline",
  "customer_reassurance",
  "documentation_followup",
  "cadence_checkpoints",
  "resolution_or_clear_path",
]);

function parseProfilesFromSpec(content) {
  const blocks = [...content.matchAll(/```yaml\s*\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  const profiles = [];
  for (const block of blocks) {
    let data;
    try {
      data = yaml.parse(block);
    } catch {
      continue;
    }
    if (!data?.profile) continue;
    const p = data.profile;
    const key = CALL_TYPE_ALIASES[p.key] || p.key;
    const motion = p.motion === "expansion" ? "expansion" : "new_business";
    const label = `${motion}:${key}`;
    const creditSum = p.themes.reduce((acc, t) => acc + t.credit, 0);
    if (creditSum !== p.total_credits) {
      throw new Error(`${label}: credits sum ${creditSum} !== total_credits ${p.total_credits}`);
    }
    for (const theme of p.themes) {
      if (theme.sub_parameters.length !== 5) {
        throw new Error(`${label}/${theme.key}: expected 5 sub_parameters, got ${theme.sub_parameters.length}`);
      }
      if (![1, 2, 3].includes(theme.credit)) {
        throw new Error(`${label}/${theme.key}: credit must be 1|2|3`);
      }
      if (!VOCABULARY_KEYS.has(theme.key)) {
        throw new Error(`${label}/${theme.key}: not in §9 vocabulary`);
      }
    }
    profiles.push({
      key,
      motion,
      name: p.name,
      version: String(p.version),
      totalCredits: p.total_credits,
      provisional: !LIVE_PROFILES.has(label),
      active: true,
      themes: p.themes.map((t) => ({
        key: t.key,
        credit: t.credit,
        category: t.category,
        ...(t.requires_video ? { requiresVideo: true } : {}),
        subParameters: t.sub_parameters,
      })),
    });
  }
  const seen = new Set();
  for (const p of profiles) {
    const id = `${p.motion}:${p.key}`;
    if (seen.has(id)) throw new Error(`Duplicate profile ${id}`);
    seen.add(id);
  }
  const nb = profiles.filter((p) => p.motion === "new_business").length;
  const exp = profiles.filter((p) => p.motion === "expansion").length;
  if (nb !== 8 || exp !== 11) {
    throw new Error(`Expected 8 new_business + 11 expansion profiles, got ${nb} + ${exp}`);
  }
  return profiles;
}

function emitTs(profiles) {
  return `/** AUTO-GENERATED — do not edit. Run: node worker/scripts/generate-rubric-profiles.mjs */

export const GENERATED_QIP_PROFILES = ${JSON.stringify(profiles, null, 2)};
`;
}

function emitJs(profiles) {
  return `/** AUTO-GENERATED — do not edit. Run: node worker/scripts/generate-rubric-profiles.mjs */

export const GENERATED_QIP_PROFILES = ${JSON.stringify(profiles, null, 2)};
`;
}

const content = fs.readFileSync(specPath, "utf8");
const profiles = parseProfilesFromSpec(content);

const tsOut = path.join(repoRoot, "worker/src/rubric-profiles.generated.ts");
const jsOut = path.join(repoRoot, "web/rubric-profiles.generated.js");

fs.writeFileSync(tsOut, emitTs(profiles));
fs.writeFileSync(jsOut, emitJs(profiles));

console.log(`Generated ${profiles.length} profiles →`);
console.log(`  ${path.relative(repoRoot, tsOut)}`);
console.log(`  ${path.relative(repoRoot, jsOut)}`);
for (const p of profiles) {
  console.log(`  ${p.motion}:${p.key}: ${p.totalCredits} credits, ${p.themes.length} themes${p.provisional ? " (provisional)" : ""}`);
}
