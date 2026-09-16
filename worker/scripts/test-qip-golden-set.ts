#!/usr/bin/env tsx
/**
 * Golden-set store: example selection, human overall, band mapping, comparison metrics.
 */
import assert from "node:assert/strict";
import {
  GOLDEN_EXAMPLES,
  compareScorecardToGolden,
  formatGoldenCalibrationPrompt,
  goldenPassEnabled,
  humanOverallForExample,
  selectGoldenExamples,
  themeBandFromGrade,
} from "../src/postcall/golden-set/index.ts";
import { rulesFor } from "../src/postcall/golden-set/rules.ts";

function testSeedShape() {
  const hunting = GOLDEN_EXAMPLES.filter((e) => e.seMotion === "new_business");
  const expansion = GOLDEN_EXAMPLES.filter((e) => e.seMotion === "expansion");
  assert.equal(hunting.length, 2, "two hunting demos");
  assert.ok(expansion.length >= 2, "at least two expansion calls");
  assert.ok(
    hunting.every((e) => e.callType === "demo" && e.recordingUrl.includes("engage.freshworks.com")),
    "hunting examples keep Engage links",
  );
  assert.ok(
    GOLDEN_EXAMPLES.some((e) => e.id === "pradeep-exp-plan-upgrade" && e.callType === "demo_plan_upgrade"),
    "plan-upgrade expansion seed",
  );
  assert.ok(
    GOLDEN_EXAMPLES.some((e) => e.callType === "ai_vision_demo"),
    "ai vision expansion seed",
  );
}

function testSelection() {
  const huntingDemo = selectGoldenExamples({ seMotion: "new_business", callType: "demo" });
  assert.deepEqual(
    huntingDemo.map((e) => e.id).sort(),
    ["nitish-nb-demo", "shamron-nb-demo"],
  );
  const planUpgrade = selectGoldenExamples({ seMotion: "expansion", callType: "demo_plan_upgrade" });
  assert.deepEqual(planUpgrade.map((e) => e.id), ["pradeep-exp-plan-upgrade"]);
  const vision = selectGoldenExamples({ seMotion: "expansion", callType: "ai_vision_demo" });
  assert.ok(vision.every((e) => e.callType === "ai_vision_demo"));
  const expansionDiscovery = selectGoldenExamples({ seMotion: "expansion", callType: "discovery" });
  assert.deepEqual(expansionDiscovery, [], "expansion discovery does not fall back to other expansion examples");
  const nbDiscovery = selectGoldenExamples({ seMotion: "new_business", callType: "discovery" });
  assert.deepEqual(nbDiscovery, [], "NB discovery does not fall back to hunting demos");
}

function testHumanOverall() {
  const shamron = GOLDEN_EXAMPLES.find((e) => e.id === "shamron-nb-demo")!;
  const scored = humanOverallForExample(shamron);
  assert.ok(scored.overall > 5 && scored.overall < 8, `shamron overall in mid band, got ${scored.overall}`);
  assert.ok(!scored.missingThemes.includes("value"), "demo themes present on sheet");
}

function testBandMapping() {
  assert.equal(themeBandFromGrade(0), 0);
  assert.equal(themeBandFromGrade(2), 0);
  assert.equal(themeBandFromGrade(5), 1);
  assert.equal(themeBandFromGrade(8), 2);
  assert.equal(themeBandFromGrade(10), 2);
}

function testCourtesyOnesAreAMiss() {
  const shamron = GOLDEN_EXAMPLES.find((e) => e.id === "shamron-nb-demo")!;
  const courtesyOnes = Object.keys(shamron.themeBands)
    .filter((k) => k !== "camera_on")
    .map((themeKey) => ({ themeKey, grade: 5 }));
  const cmp = compareScorecardToGolden(shamron, courtesyOnes);
  assert.ok(cmp.exactMatchRate < 1, "five 1s (grade 5) do not match polarized human scores");
  const value = cmp.themes.find((t) => t.themeKey === "value")!;
  assert.equal(value.humanBand, 0);
  assert.equal(value.aiBand, 1);
  const questions = cmp.themes.find((t) => t.themeKey === "questions")!;
  assert.equal(questions.humanBand, 2);
  assert.equal(questions.aiBand, 1);
}

function testPolarizedMatch() {
  const shamron = GOLDEN_EXAMPLES.find((e) => e.id === "shamron-nb-demo")!;
  const lines = Object.entries(shamron.themeBands).map(([themeKey, band]) => ({
    themeKey,
    grade: band * 5,
  }));
  const cmp = compareScorecardToGolden(shamron, lines);
  assert.equal(cmp.exactMatchRate, 1);
  assert.equal(cmp.bandMae, 0);
}

function testPromptContainsMatchingExamples() {
  const hunting = formatGoldenCalibrationPrompt({ seMotion: "new_business", callType: "demo" });
  assert.match(hunting, /Shamron/);
  assert.match(hunting, /Nitish/);
  assert.match(hunting, /value=0/);
  assert.doesNotMatch(hunting, /Pradeep/);
  const expansion = formatGoldenCalibrationPrompt({ seMotion: "expansion", callType: "demo_plan_upgrade" });
  assert.match(expansion, /Pradeep/);
  assert.doesNotMatch(expansion, /Shamron/);
  const visionRules = rulesFor("expansion", "ai_vision_demo").map((r) => r.id);
  assert.ok(visionRules.includes("ai-vision-discovery-is-zero-unless-done"));
  assert.ok(!visionRules.includes("hunting-execution-earns-twos"));

  const discoveryPrompt = formatGoldenCalibrationPrompt({ seMotion: "new_business", callType: "discovery" });
  assert.doesNotMatch(discoveryPrompt, /Shamron/);
  assert.doesNotMatch(discoveryPrompt, /Nitish/);
  assert.match(discoveryPrompt, /No worked examples for this profile/);
  const discoveryRules = rulesFor("new_business", "discovery").map((r) => r.id);
  assert.ok(!discoveryRules.includes("absent-proof-points-are-zero"));
  assert.ok(!discoveryRules.includes("value-requires-numbers"));
  assert.ok(discoveryRules.includes("discovery-habits-earn-twos"));
  assert.ok(discoveryRules.includes("discovery-incidents-na-when-absent"));
  assert.ok(discoveryRules.includes("discovery-value-is-hypothesis"));
  const demoRules = rulesFor("new_business", "demo").map((r) => r.id);
  assert.ok(demoRules.includes("absent-proof-points-are-zero"));
  assert.ok(demoRules.includes("value-requires-numbers"));
  assert.ok(!demoRules.includes("discovery-incidents-na-when-absent"));
}

function testEnvGate() {
  assert.equal(goldenPassEnabled({}), true);
  assert.equal(goldenPassEnabled({ SCORECARD_GOLDEN_PASS: "1" }), true);
  assert.equal(goldenPassEnabled({ SCORECARD_GOLDEN_PASS: "0" }), false);
  assert.equal(goldenPassEnabled({ SCORECARD_GOLDEN_PASS: "false" }), false);
}

testSeedShape();
testSelection();
testHumanOverall();
testBandMapping();
testCourtesyOnesAreAMiss();
testPolarizedMatch();
testPromptContainsMatchingExamples();
testEnvGate();
console.log("test-qip-golden-set: ok");
