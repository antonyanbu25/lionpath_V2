/** Smoke test for manager team dashboard sections (no browser). */

import { themeAverage } from "../quality-score.js";
import { heatmapThemeKeys, CORE_FOUR_THEME_KEYS } from "../rubric-profiles.js";
import { renderManagerHeatmap, renderManagerFilterBanner } from "../dashboard.js";
import { esc } from "../shared.js";

const scorecardsA = [
  {
    callType: "demo",
    rubricVersion: "1.0",
    provisional: false,
    confidence: 0.9,
    lines: [
      { themeKey: "call_flow", score: 80, maxScore: 100, applicable: true, weight: 10 },
      { themeKey: "customer_engagement", score: 70, maxScore: 100, applicable: true, weight: 10 },
      { themeKey: "objections", score: 60, maxScore: 100, applicable: true, weight: 5 },
      { themeKey: "camera_on", score: 90, maxScore: 100, applicable: true, weight: 5 },
      { themeKey: "comp_pitch", score: 48, maxScore: 100, applicable: true, weight: 5 },
    ],
  },
];

const scorecardsB = [
  {
    callType: "demo",
    rubricVersion: "1.0",
    provisional: false,
    confidence: 0.85,
    lines: [
      { themeKey: "call_flow", score: 75, maxScore: 100, applicable: true, weight: 10 },
      { themeKey: "customer_engagement", score: 72, maxScore: 100, applicable: true, weight: 10 },
      { themeKey: "objections", score: 55, maxScore: 100, applicable: true, weight: 5 },
      { themeKey: "camera_on", score: 88, maxScore: 100, applicable: true, weight: 5 },
      { themeKey: "comp_pitch", score: 44, maxScore: 100, applicable: true, weight: 5 },
    ],
  },
];

const view = {
  seRows: [
    { email: "a@test.com", name: "SE Alpha" },
    { email: "b@test.com", name: "SE Beta" },
  ],
  seScorecardsByEmail: new Map([
    ["a@test.com", scorecardsA],
    ["b@test.com", scorecardsB],
  ]),
  allEligibleScorecards: [...scorecardsA, ...scorecardsB],
};

const spineHtml = renderManagerHeatmap(view, "spine");
const demoHtml = renderManagerHeatmap(view, "demo");
const bannerHtml = renderManagerFilterBanner("demo");

const compColAvg = themeAverage(
  view.allEligibleScorecards,
  "comp_pitch",
  "demo",
  { requireHighConfidence: true },
).score;

const checks = [
  ["spine filter uses core four only", heatmapThemeKeys("spine").join() === CORE_FOUR_THEME_KEYS.join()],
  ["demo filter includes comp_pitch", heatmapThemeKeys("demo").includes("comp_pitch")],
  ["column summary row present", spineHtml.includes("team-heatmap-col-summary")],
  ["column summary more prominent", spineHtml.includes("team-heatmap-cell--col-summary")],
  ["demo profile columns in heatmap", demoHtml.includes("Comp pitch")],
  ["filter banner names call type", bannerHtml.includes("Demo only")],
  ["comp pitch team avg computed", compColAvg != null && compColAvg < 50],
  ["esc helper wired", esc("<test>") === "&lt;test&gt;"],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}

console.log("OK — manager dashboard smoke test passed");
