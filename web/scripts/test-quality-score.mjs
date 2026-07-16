/** Unit tests for quality score normalization (Node). */
import { computeOverallScore, overallLabelFromScore, normalizeQualityCoach } from "../quality-score.js";

const dims = [
  { name: "Discovery", score: 4, maxScore: 5 },
  { name: "Demo alignment", score: 5, maxScore: 5 },
  { name: "Objections", score: 4, maxScore: 5 },
  { name: "Value articulation", score: 5, maxScore: 5 },
  { name: "Next-step clarity", score: 5, maxScore: 5 },
  { name: "Talk balance", score: 4, maxScore: 5 },
];

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
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error("FAILED:", failed.map(([n]) => n).join(", "));
  process.exit(1);
}
console.log("OK — quality score tests passed");
