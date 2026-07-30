/** Unit tests for quality score normalization (Node). */
import {
  computeOverallScore,
  overallLabelFromScore,
  normalizeQualityCoach,
  typeComposite,
  spineComposite,
  themeAverage,
  formatTypeComposite,
  isEligibleForAggregate,
} from "../quality-score.js";

const dims = [
  { name: "Discovery", score: 4, maxScore: 5 },
  { name: "Demo alignment", score: 5, maxScore: 5 },
  { name: "Objections", score: 4, maxScore: 5 },
  { name: "Value articulation", score: 5, maxScore: 5 },
  { name: "Next-step clarity", score: 5, maxScore: 5 },
  { name: "Talk balance", score: 4, maxScore: 5 },
];

const demoCard = {
  callType: "demo",
  rubricVersion: "1.0",
  lines: [
    { themeKey: "call_flow", score: 80, maxScore: 100, applicable: true, weight: 10 },
    { themeKey: "camera_on", score: 100, maxScore: 100, applicable: false, weight: 5 },
  ],
};

const checks = [
  ["avg 4.5/5 → 9.0", computeOverallScore(dims) === 9],
  ["9.0 → Excellent", overallLabelFromScore(9) === "Excellent"],
  ["8.0 → Strong", overallLabelFromScore(8) === "Strong"],
  ["7.0 → Strong", overallLabelFromScore(7) === "Strong"],
  ["6.0 → Good", overallLabelFromScore(6) === "Good"],
  ["5.0 → Developing", overallLabelFromScore(5) === "Developing"],
  ["3.0 → Needs focus", overallLabelFromScore(3) === "Needs focus"],
  [
    "normalize fixes model mismatch",
    (() => {
      const n = normalizeQualityCoach({ overallScore: 4.5, overallLabel: "Strong", dimensions: dims });
      return n.overallScore === 9 && n.overallLabel === "Excellent";
    })(),
  ],
  [
    "typeComposite weighted single call",
    (() => {
      const r = typeComposite([demoCard], "demo", { includeIneligible: true });
      return r.score === 80 && r.applicableWeight === 10;
    })(),
  ],
  [
    "typeComposite aggregates lines across calls",
    (() => {
      const r = typeComposite(
        [
          demoCard,
          {
            callType: "demo",
            rubricVersion: "1.0",
            lines: [
              { themeKey: "call_flow", score: 60, maxScore: 100, applicable: true, weight: 10 },
            ],
          },
        ],
        "demo",
        { includeIneligible: true },
      );
      return r.score === 70 && r.applicableWeight === 20;
    })(),
  ],
  [
    "formatTypeComposite",
    formatTypeComposite({
      score: 86,
      applicableWeight: 100,
      totalWeight: 100,
      applicableCount: 10,
      rubricVersion: "1.0",
      callType: "demo",
    }) === "86 / 100 (demo v1.0)",
  ],
  [
    "spineComposite unweighted",
    spineComposite([
      {
        lines: [
          { themeKey: "call_flow", score: 80, maxScore: 100, applicable: true },
          { themeKey: "customer_engagement", score: 60, maxScore: 100, applicable: true },
          { themeKey: "objections", score: 40, maxScore: 100, applicable: true },
          { themeKey: "camera_on", score: 20, maxScore: 100, applicable: true },
        ],
      },
    ]).score === 50,
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
    "themeAverage cross-type",
    themeAverage(
      [
        {
          callType: "demo",
          lines: [{ themeKey: "questions", score: 80, maxScore: 100, applicable: true }],
        },
        {
          callType: "discovery",
          lines: [{ themeKey: "questions", score: 60, maxScore: 100, applicable: true }],
        },
      ],
      "questions",
      null,
      { includeIneligible: true },
    ).score === 70,
  ],
  [
    "themeAverage callType filter",
    themeAverage(
      [
        {
          callType: "demo",
          lines: [{ themeKey: "questions", score: 80, maxScore: 100, applicable: true }],
        },
        {
          callType: "discovery",
          lines: [{ themeKey: "questions", score: 60, maxScore: 100, applicable: true }],
        },
      ],
      "questions",
      "demo",
      { includeIneligible: true },
    ).score === 80,
  ],
  [
    "isEligibleForAggregate blocks shadow",
    isEligibleForAggregate({ provisional: true, confidence: 0.99 }) === false,
  ],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}
console.log("OK — quality score tests passed");
