/** QIP insight bullets and theme N/A copy — no HTML leaks, correct reasons per theme. */
import { renderQipScorecard } from "../postcall.js";
import {
  resolveThemeNaReason,
  VIDEO_THEME_UNAVAILABLE_REASON,
  GENERIC_EVIDENCE_UNAVAILABLE_REASON,
} from "../user-facing-copy.js";
import {
  MODEL_OMITTED_THEME_REASON,
  RESEARCH_NOT_EVIDENCED_REASON,
} from "../shared/qip-scorecard-normalize.js";
import { profileFor } from "../rubric-profiles.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const demoProfile = profileFor("demo");

assert(
  resolveThemeNaReason({ themeKey: "research", evidenceUnavailable: true, modelOmitted: true }, demoProfile) ===
    RESEARCH_NOT_EVIDENCED_REASON,
  "legacy research row uses not-evidenced reason, not model omitted",
);

assert(
  resolveThemeNaReason({ themeKey: "camera_on", applicable: false }, demoProfile) ===
    VIDEO_THEME_UNAVAILABLE_REASON,
  "camera_on without video uses video reason",
);

assert(
  resolveThemeNaReason({ themeKey: "research", evidenceUnavailable: true }, demoProfile) ===
    GENERIC_EVIDENCE_UNAVAILABLE_REASON,
  "research evidence gap uses generic reason",
);

const longNote =
  "The SE introduced AI, but it was quickly dismissed; focus on demonstrating AI value before asking if they want to enable it on day one with their ticket volume patterns.";

const html = renderQipScorecard(
  {
    callType: "demo",
    overall: 6.9,
    categoryScores: {
      discovery_qualification: 7,
      solution_technical_fit: 6,
      business_value: 7,
      credibility_objections: 6.8,
      communication_control: 7.4,
    },
    lines: [
      {
        themeKey: "ai",
        grade: 4,
        credit: 2,
        category: "solution_technical_fit",
        coachingNote: longNote,
        confidence: 0.7,
        subParameters: Array.from({ length: 5 }, () => ({ score: 1, evidence: [] })),
      },
      {
        themeKey: "research",
        grade: 0,
        credit: 2,
        category: "discovery_qualification",
        evidenceUnavailable: true,
        modelOmitted: true,
        confidence: 0.25,
        coachingNote: RESEARCH_NOT_EVIDENCED_REASON,
        subParameters: [],
      },
    ],
  },
  { callType: "demo", rubricVersion: "2.1" },
  { context: "call-record" },
);

assert(!html.includes("&lt;span"), "insight tile must not show escaped span tags");
assert(!html.includes('<span class="trunc-ellipsis">'), "insight tile must not leak trunc HTML");
assert(html.includes("What didn"), "renders what didn't column");
assert(html.includes(RESEARCH_NOT_EVIDENCED_REASON), "research shows not-evidenced reason");
const researchRow = html.match(/data-theme-key="research"[\s\S]*?<\/details>/);
assert(
  researchRow && !researchRow[0].includes(MODEL_OMITTED_THEME_REASON),
  "research row must not show model-omitted copy",
);
assert(!html.includes("requires visual evidence") || html.includes("camera_on") === false, "research row avoids video copy");

console.log("test-qip-insight-na: ok");
