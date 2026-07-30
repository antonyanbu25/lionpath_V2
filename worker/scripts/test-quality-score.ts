/** Unit tests for QIP composite functions — mirrors web/scripts/test-quality-score.mjs. */
import {
  typeComposite,
  spineComposite,
  themeAverage,
  formatTypeComposite,
  isEligibleForAggregate,
} from "../src/quality-score.ts";

const demoLines = [
  { themeKey: "call_flow", score: 80, maxScore: 100, applicable: true, weight: 10 },
  { themeKey: "customer_engagement", score: 90, maxScore: 100, applicable: true, weight: 10 },
  { themeKey: "objections", score: 70, maxScore: 100, applicable: true, weight: 5 },
  { themeKey: "camera_on", score: 100, maxScore: 100, applicable: false, weight: 5 },
  { themeKey: "cde_build", score: 60, maxScore: 100, applicable: true, weight: 10 },
];

const typeResult = typeComposite(
  [{ callType: "demo", rubricVersion: "1.0", lines: demoLines }],
  "demo",
  { includeIneligible: true },
);

// applicable weight = 10+10+5+10 = 35; earned = 8+9+3.5+6 = 26.5; score = 26.5/35*100 = 75.7
const checks: [string, boolean][] = [
  ["typeComposite score", typeResult.score === 75.7],
  ["typeComposite applicableWeight", typeResult.applicableWeight === 35],
  ["typeComposite totalWeight", typeResult.totalWeight === 40],
  ["typeComposite applicableCount", typeResult.applicableCount === 4],
  ["typeComposite callType", typeResult.callType === "demo"],
  [
    "formatTypeComposite",
    formatTypeComposite(typeResult) === "75.7 / 100 (demo v1.0)",
  ],
  [
    "spineComposite mean",
    spineComposite([
      {
        lines: [
          { themeKey: "call_flow", score: 80, maxScore: 100, applicable: true },
          { themeKey: "customer_engagement", score: 60, maxScore: 100, applicable: true },
          { themeKey: "objections", score: 40, maxScore: 100, applicable: true },
          { themeKey: "camera_on", score: 100, maxScore: 100, applicable: true },
        ],
      },
      {
        lines: [
          { themeKey: "call_flow", score: 60, maxScore: 100, applicable: true },
          { themeKey: "customer_engagement", score: 80, maxScore: 100, applicable: true },
          { themeKey: "objections", score: 20, maxScore: 100, applicable: false },
          { themeKey: "camera_on", score: 0, maxScore: 100, applicable: true },
        ],
      },
    ]).score === 60,
  ],
  [
    "spineComposite coverage",
    spineComposite([
      {
        lines: [
          { themeKey: "call_flow", score: 80, maxScore: 100, applicable: true },
          { themeKey: "customer_engagement", score: 60, maxScore: 100, applicable: true },
          { themeKey: "objections", score: 40, maxScore: 100, applicable: true },
          { themeKey: "camera_on", score: 100, maxScore: 100, applicable: true },
        ],
      },
      {
        lines: [
          { themeKey: "call_flow", score: 60, maxScore: 100, applicable: true },
          { themeKey: "customer_engagement", score: 80, maxScore: 100, applicable: true },
          { themeKey: "objections", score: 20, maxScore: 100, applicable: false },
          { themeKey: "camera_on", score: 0, maxScore: 100, applicable: true },
        ],
      },
    ]).coverage === 0.5,
  ],
  [
    "spineComposite themeCount",
    spineComposite([
      {
        lines: [
          { themeKey: "call_flow", score: 80, maxScore: 100, applicable: true },
          { themeKey: "customer_engagement", score: 60, maxScore: 100, applicable: true },
          { themeKey: "objections", score: 40, maxScore: 100, applicable: true },
          { themeKey: "camera_on", score: 100, maxScore: 100, applicable: true },
        ],
      },
    ]).themeCount === 4,
  ],
  [
    "spineComposite excludes provisional",
    spineComposite([
      {
        provisional: true,
        lines: [
          { themeKey: "call_flow", score: 100, maxScore: 100, applicable: true },
          { themeKey: "customer_engagement", score: 100, maxScore: 100, applicable: true },
          { themeKey: "objections", score: 100, maxScore: 100, applicable: true },
          { themeKey: "camera_on", score: 100, maxScore: 100, applicable: true },
        ],
      },
      {
        provisional: false,
        lines: [
          { themeKey: "call_flow", score: 40, maxScore: 100, applicable: true },
          { themeKey: "customer_engagement", score: 40, maxScore: 100, applicable: true },
          { themeKey: "objections", score: 40, maxScore: 100, applicable: true },
          { themeKey: "camera_on", score: 40, maxScore: 100, applicable: true },
        ],
      },
    ]).score === 40,
  ],
  [
    "themeAverage",
    themeAverage(
      [
        {
          callType: "demo",
          lines: [{ themeKey: "call_flow", score: 70, maxScore: 100, applicable: true }],
        },
        {
          callType: "discovery",
          lines: [{ themeKey: "call_flow", score: 50, maxScore: 100, applicable: true }],
        },
      ],
      "call_flow",
      null,
      { includeIneligible: true },
    ).score === 60,
  ],
  [
    "isEligibleForAggregate blocks provisional",
    isEligibleForAggregate({ provisional: true, confidence: 0.9 }) === false,
  ],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}
console.log("OK — QIP composite tests passed");
