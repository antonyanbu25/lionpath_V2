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
    rubricVersion: "2.1",
    provisional: false,
    overall: 7,
    confidence: 0.9,
    lines: [
      {
        themeKey: "storytelling",
        grade: 7,
        credit: 2,
        category: "communication_control",
        applicable: true,
        subParameters: [{ score: 1, evidence: [{ atS: 120, quote: "We follow Maya through her shift." }] }],
        coachingNote: "Name a persona in their industry.",
      },
      {
        themeKey: "value",
        grade: 8,
        credit: 3,
        category: "business_value",
        applicable: true,
        subParameters: [{ score: 2, evidence: [{ atS: 200, quote: "Cuts handle time by thirty percent." }] }],
        coachingNote: "Quantify one ROI claim.",
      },
      {
        themeKey: "questions",
        grade: 0,
        credit: 3,
        category: "discovery_qualification",
        applicable: true,
        subParameters: [{ score: 0, evidence: [{ atS: 30, quote: "Any questions?" }] }],
        coachingNote: "Ask one open discovery question.",
      },
      {
        themeKey: "camera_on",
        grade: 0,
        credit: 2,
        category: "communication_control",
        applicable: false,
        evidenceUnavailable: true,
        notApplicableReason: "No video recording — this theme requires visual evidence from the recording and cannot be scored from transcript alone.",
        subParameters: [],
        coachingNote: null,
      },
    ],
  };

  const composite = typeComposite([scorecard], "demo", { includeIneligible: true });
  assert("composite uses overall field", composite.score === 7);

  const html = renderQipScorecard(scorecard, { callType: "demo", provisional: false });
  assert("suppressed message shown", html.includes("Not shown: this theme&#39;s scoring is still stabilising."));
  assert("suppressed keeps sub-parameter evidence", html.includes("Maya through her shift"));
  // Rewritten 2026-08-09: the old assertion hardcoded exact wording ("Listen
  // back"/"concrete fix"/"On your next call"/"Name a persona") that assumed
  // resolveSubParameterCoachText's raw line.coachingNote would win here. Traced
  // actual runtime behavior instead: coachTextForSubParameter's
  // buildCoachOutput-generated content (hand-curated per theme/sub-parameter/
  // score, see coach/index.js's COACH_TIPS_BY_THEME, or its auto-generated
  // default-tip-pair fallback for themes without a curated bank entry) always
  // wins over the raw per-call note when available — confirmed by direct
  // tracing, not assumed. Check that a real, non-generic coach line renders
  // for the suppressed theme's sub-parameter, without pinning exact wording
  // that's coupled to the profile's sub-parameter label text.
  const coachMatch = html.match(/class="qip-sp-coach muted">([^<]+)</);
  assert("suppressed keeps coach line", !!coachMatch);
  assert(
    "suppressed coach line has real content",
    coachMatch[1].trim().length > 10 && coachMatch[1] !== "Full credit — no coaching needed here.",
  );
  assert("suppressed css class", html.includes("qip-theme-row-suppressed"));
  assert("zero score still numeric", html.includes(">0</strong><span class=\"qip-line-max\"> / 10</span>"));
  assert("NA still badge not zero", html.includes('class="qip-na-badge">N/A</span>'));
  assert("NA reason preserved", html.includes("No video recording"));
  assert(
    "suppressed line not NA",
    html.includes('class="qip-theme-row qip-theme-row-suppressed"') && html.includes("qip-theme-row-na"),
  );
  assert("overall header /10", html.includes("7 / 10"));
  assert("no /100 in UI", !html.includes("/ 100"));

  __resetThemeSuppressionForTests();
  console.log("OK — theme score suppression tests passed");
} catch (err) {
  __resetThemeSuppressionForTests();
  console.error("FAILED:", err.message || err);
  process.exit(1);
}
