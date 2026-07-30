/** Theme SD suppression — render states and composite maths (display-only gate). */
import {
  __resetThemeSuppressionForTests,
  __setThemeSuppressionForTests,
  isThemeScoreSuppressed,
} from "../theme-score-suppression.js";
import { typeComposite } from "../quality-score.js";

const { renderQipScorecard } = await import("../postcall.js");

function assert(name, ok) {
  if (!ok) throw new Error(name);
}

try {
  __setThemeSuppressionForTests({
    runId: "test-run",
    runDir: "../worker/consistency-runs/sample-4-1",
    generatedAt: "2026-07-24T00:00:00.000Z",
    threshold: 15,
    suppressedThemes: ["storytelling"],
    themes: [{ themeKey: "storytelling", meanScoreSd: 18.03, maxScoreSd: 18.03, suppressed: true }],
  });

  assert("isThemeScoreSuppressed true", isThemeScoreSuppressed("storytelling"));
  assert("isThemeScoreSuppressed false", !isThemeScoreSuppressed("value"));

  const scorecard = {
    callType: "demo",
    rubricVersion: "1.0",
    provisional: false,
    confidence: 0.9,
    lines: [
      {
        themeKey: "storytelling",
        score: 70,
        maxScore: 100,
        applicable: true,
        weight: 5,
        evidence: [{ atS: 120, quote: "We follow Maya through her shift." }],
        coachingNote: "Name a persona in their industry.",
      },
      {
        themeKey: "value",
        score: 80,
        maxScore: 100,
        applicable: true,
        weight: 10,
        evidence: [{ atS: 200, quote: "Cuts handle time by thirty percent." }],
        coachingNote: "Quantify one ROI claim.",
      },
      {
        themeKey: "questions",
        score: 0,
        maxScore: 100,
        applicable: true,
        weight: 5,
        evidence: [{ atS: 30, quote: "Any questions?" }],
        coachingNote: "Ask one open discovery question.",
      },
      {
        themeKey: "camera_on",
        score: 0,
        maxScore: 100,
        applicable: false,
        notApplicableReason: "No video recording — requires Pass 2 video evidence.",
        weight: 5,
        evidence: [],
        coachingNote: null,
      },
    ],
  };

  const composite = typeComposite([scorecard], "demo", { includeIneligible: true });
  assert(
    "composite includes suppressed theme weight",
    composite.score === Math.round(((70 / 100) * 5 + (80 / 100) * 10 + 0) / 20 * 100 * 10) / 10,
  );
  assert("composite applicable weight unchanged", composite.applicableWeight === 20);

  const html = renderQipScorecard(scorecard, { callType: "demo", provisional: false });
  assert("suppressed message shown", html.includes("Not shown: this theme&#39;s scoring is still stabilising."));
  assert("suppressed keeps evidence", html.includes("Maya through her shift"));
  assert("suppressed keeps coaching", html.includes("Name a persona"));
  assert("suppressed css class", html.includes("qip-line-suppressed"));
  assert("zero score still numeric", html.includes('class="qip-line-score weak">0<span class="qip-line-max">/100</span>'));
  assert("NA still badge not zero", html.includes('class="qip-na-badge">N/A</span>'));
  assert("NA reason preserved", html.includes("No video recording"));
  assert(
    "suppressed line not NA",
    html.includes('class="qip-line qip-line-suppressed"') && html.includes("qip-line-na"),
  );
  assert("composite header unchanged", html.includes("(demo v1.0)"));

  __resetThemeSuppressionForTests();
  console.log("OK — theme score suppression tests passed");
} catch (err) {
  __resetThemeSuppressionForTests();
  console.error("FAILED:", err.message || err);
  process.exit(1);
}
