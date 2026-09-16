#!/usr/bin/env tsx
/**
 * Compare AI QIP scorecards against the human golden set.
 *
 * Usage:
 *   npx tsx scripts/eval-qip-golden.ts
 *   npx tsx scripts/eval-qip-golden.ts --ai path/to/ai-scorecards.json
 *
 * --ai JSON shape: { "<exampleId>": { "lines": [{ "themeKey", "grade", "subParameters"? }] } }
 * Prints per-theme human vs AI bands and MAE. camera_on is excluded by default
 * (display layer currently N/As it).
 */
import { readFile } from "node:fs/promises";
import {
  GOLDEN_EXAMPLES,
  compareScorecardToGolden,
  humanOverallForExample,
} from "../src/postcall/golden-set/index.ts";

const args = process.argv.slice(2);
const aiPath = args.includes("--ai") ? args[args.indexOf("--ai") + 1] : null;
const includeCamera = args.includes("--include-camera");

function printHumanSummary() {
  console.log("QIP golden set — human theme bands (0/1/2) and reconstructed overall\n");
  for (const example of GOLDEN_EXAMPLES) {
    const { overall, includedCredits, missingThemes } = humanOverallForExample(example, {
      includeCameraOn: includeCamera,
    });
    const motion = example.seMotion === "new_business" ? "hunting" : "expansion";
    console.log(`${example.id}  ${example.seName}  ${motion}/${example.callType}  QIP≈${overall}  credits=${includedCredits}`);
    console.log(`  recording: ${example.recordingUrl}`);
    if (example.notes) console.log(`  ${example.notes}`);
    if (missingThemes.length) console.log(`  profile themes not on sheet: ${missingThemes.join(", ")}`);
    const bands = Object.entries(example.themeBands)
      .filter(([k]) => includeCamera || k !== "camera_on")
      .map(([k, v]) => `${k}:${v}`)
      .join("  ");
    console.log(`  ${bands}\n`);
  }
}

async function compareAi(path: string) {
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<
    string,
    { lines?: Array<{ themeKey: string; grade?: number | null; evidenceUnavailable?: boolean; modelOmitted?: boolean }> }
  >;
  console.log(`\nAI vs human (${path})\n`);
  for (const example of GOLDEN_EXAMPLES) {
    const ai = raw[example.id];
    if (!ai?.lines?.length) {
      console.log(`${example.id}: no AI scorecard in file\n`);
      continue;
    }
    const cmp = compareScorecardToGolden(example, ai.lines, { includeCameraOn: includeCamera });
    console.log(
      `${example.id}: exact-band ${cmp.exactBandMatch}/${cmp.themeCount} (${Math.round(cmp.exactMatchRate * 100)}%)  band MAE ${cmp.bandMae}  grade MAE ${cmp.gradeMae}`,
    );
    for (const t of cmp.themes) {
      const mark = t.aiBand === t.humanBand ? " " : "!";
      console.log(
        `  ${mark} ${t.themeKey.padEnd(22)} human ${t.humanBand}  ai ${t.aiBand ?? "n/a"} (grade ${t.aiGrade ?? "n/a"})`,
      );
    }
    console.log("");
  }
}

printHumanSummary();
if (aiPath) await compareAi(aiPath);
